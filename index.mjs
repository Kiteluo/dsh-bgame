import { readFile } from 'node:fs/promises';
import z from '@deepseek-ai/schemastery';
import { GAMES, legalActions, observation, validateGame, chooseLocal } from './games.mjs';

export const name = 'dsh-bgame';
export const inject = ['webServer', 'connection', 'llm'];
export const Config = z.object({});
const response = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
const assets = { 'client.mjs': 'text/javascript', 'games.mjs': 'text/javascript', 'bgame.css': 'text/css', 'play': 'text/html' };

export const MODEL_TIMEOUT_MS = 60000;
export class ModelMoveError extends Error {
  constructor(code, message, status) { super(message); this.name='ModelMoveError'; this.code=code; this.status=status; }
}
/** Provider bodies can contain credentials; expose classified facts rather than raw error text. */
export function modelFailure(error, signal) {
  const code = signal?.reason?.name === 'TimeoutError' || error?.name === 'TimeoutError' ? 'TIMEOUT' : String(error?.code ?? error?.failure?.code ?? 'MODEL_ERROR');
  const status = error?.status ?? error?.failure?.status;
  const descriptions = {
    TIMEOUT:'模型等待超过 60 秒', MAX_TOKENS:'模型耗尽输出额度，尚未完成走法',
    INVALID_RESPONSE:'模型回复不是有效的走法 JSON', INVALID_ACTION:'模型选择了不合法的动作',
    RESPONSE_TOO_LONG:'模型回复超出长度限制', STREAM_CLOSED:'模型回复中途断开',
    EMPTY_RESPONSE:'模型没有返回走法', TOOL_CALLS:'模型返回了工具调用，未给出走法',
    NO_ADAPTER:'所选模型服务尚未启用', INVALID_PREPARED_CALL:'模型调用配置不一致',
    AUTH:'模型身份验证失败，请检查登录或 API Key', INVALID_CREDENTIAL:'模型凭据无效，请检查登录或 API Key',
    RATE_LIMIT:'模型服务限制了请求频率', QUOTA_EXCEEDED:'模型额度不足', ACCOUNT_QUOTA_EXCEEDED:'模型账户额度不足',
    NETWORK:'无法连接模型服务', UNSUPPORTED_REASONING_EFFORT:'所选模型不支持该思考强度',
  };
  const message = descriptions[code] ?? (status===401||status===403 ? descriptions.AUTH : status===402 ? descriptions.QUOTA_EXCEEDED : status===429 ? descriptions.RATE_LIMIT : '模型调用失败，请检查模型服务');
  return {code:/^[A-Z][A-Z0-9_-]{0,63}$/.test(code)?code:'MODEL_ERROR',message};
}

/** A model sees only its own cards and public facts. Its reply selects one legal action. */
export async function modelMove(llm, state, selection, signal) {
  validateGame(state);
  if (state.status !== 'playing' || state.turn !== 1) throw new Error('当前不是对手回合');
  const actions = legalActions(state);
  const info = await llm.resolveModelInfo(selection.provider, selection.model, signal);
  const efforts = info.reasoning?.efforts ?? [];
  const effort = ['off','minimal','low'].map(id=>efforts.find(e=>e.id===id)).find(Boolean) ?? efforts[0];
  const prepared = await llm.prepareCall({ provider: selection.provider, model: selection.model, maxTokens: 8192, ...(effort?{reasoningEffort:effort.id}:{}) }, signal);
  const view = observation(state, 1);
  const prompt = {
    rules: GAMES[state.kind].rules,
    state: state.kind === 'gomoku' ? {
      ...view,
      board: Array.from({length:15}, (_,row) => state.board.slice(row*15,row*15+15).map(cell => ['.','X','O'][cell]).join('')),
      legend: '.=空位，X=对方黑子，O=你的白子；行列从 1 开始，棋盘从上到下、从左到右',
    } : view,
    choices: actions.map((action, choice) => state.kind === 'gomoku'
      ? {choice, row: Math.floor(action.at/15)+1, col: action.at%15+1}
      : {choice, action}),
  };
  let text = '';
  let usage;
  let completed = false;
  let truncated = false;
  for await (const chunk of prepared.stream({
    ...prepared.config,
    system: '你是 DSH 小游戏对手。你只能看到自己的手牌和公开信息。按规则认真对战。从 choices 中直接选择一个动作；先返回 choice 再返回 say。简短判断即可，不要穷举候选或模拟多步对局。只输出 JSON：{"choice":整数,"say":"一句简短中文互动话语"}。不得猜测或要求提供对方暗牌，不使用工具。',
    messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(prompt) }] }],
    signal,
  })) {
    signal?.throwIfAborted();
    if (chunk.type === 'text-delta') text += chunk.text;
    if (text.length > 12000) throw new ModelMoveError('RESPONSE_TOO_LONG','模型回复过长');
    if (chunk.type === 'usage') usage = chunk.usage;
    if (chunk.type === 'finish') {
      if (chunk.reason.kind === 'max-tokens') truncated = true;
      else if (chunk.reason.kind !== 'stop') {
        const failure = chunk.reason.failure;
        const code = failure?.code ?? ({'max-tokens':'MAX_TOKENS','tool-calls':'TOOL_CALLS','aborted':'ABORTED'}[chunk.reason.kind] ?? 'MODEL_ERROR');
        throw new ModelMoveError(code,'模型未完成回复',failure?.status);
      }
      completed = true;
    }
  }
  if (!completed) throw new ModelMoveError('STREAM_CLOSED','模型回复中断');
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const match = clean.match(/\{[\s\S]*\}/);
  let result;
  try { result = JSON.parse(match?.[0] ?? clean); }
  catch { throw new ModelMoveError(truncated?'MAX_TOKENS':text.trim()?'INVALID_RESPONSE':'EMPTY_RESPONSE','模型回复不是有效 JSON'); }
  if (!result || !Number.isInteger(result.choice) || !actions[result.choice]) throw new ModelMoveError(truncated?'MAX_TOKENS':'INVALID_ACTION','模型选择了无效动作');
  return { action: actions[result.choice], say: typeof result.say === 'string' ? result.say.slice(0, 120) : '', usage };
}

export function apply(ctx) {
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort());
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/bgame',
    handler: async (req, res) => {
      const reject = ctx.connection.requestRejection(req);
      if (reject) { res.writeHead(reject); res.end(); return; }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      const file = new URL(req.url, 'http://local').pathname.slice('/bgame/'.length);
      if (!Object.hasOwn(assets, file)) { res.writeHead(404); res.end(); return; }
      const content = file === 'play' ? Buffer.from('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="../"><title>dsh-bgame · 游戏大厅</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#101826}</style></head><body><script type="module" src="./bgame/client.mjs?embedded=1"></script></body></html>') : await readFile(new URL(file, import.meta.url));
      res.writeHead(200, { 'content-type': `${assets[file]}; charset=utf-8`, 'cache-control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : content);
    },
  }));
  const models = async () => {
    const providers = ctx.llm.listProviders();
    const catalogs = await Promise.allSettled(providers.map(p => ctx.llm.listModels(p.id)));
    const list = catalogs.flatMap(result => result.status === 'fulfilled' ? result.value.map(m => ({ provider: m.provider, id: m.id, name: m.name })) : []);
    return { models: list, default: ctx.get('agentDefaultModel')?.currentSelection() ?? null };
  };
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/bgame/models', methods: ['GET'], requestBody: 'buffered',
    fetch: async () => { try { return response(await models()); } catch { return response({ error: '无法读取模型列表，请检查 dsh 模型设置。' }, 503); } },
  }));
  let pending = 0;
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/bgame/move', methods: ['POST'], requestBody: 'buffered',
    fetch: async request => {
      if (pending >= 2) return response({ error: '对手正在思考，请稍后重试。' }, 429);
      pending++;
      let state;
      try {
        const body = await request.text();
        if (body.length > 24000) return response({ error: '牌局数据过大。' }, 413);
        const input = JSON.parse(body);
        state = validateGame(input.state);
        if (state.turn !== 1 || state.status !== 'playing') return response({ error: '当前不是对手回合。' }, 400);
        const catalog = await models();
        const selected = input.selection ?? catalog.default;
        if (!selected || !catalog.models.some(m => m.provider === selected.provider && m.id === selected.model)) return response({ error: '请先在 dsh 设置中配置并选择模型。' }, 400);
        const signal = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)]);
        try { return response(await modelMove(ctx.llm, state, selected, signal)); }
        catch (error) {
          if (request.signal.aborted || lifetime.signal.aborted) return response({ error: '已取消。' }, 499);
          const failure = modelFailure(error,signal);
          return response({ action: chooseLocal(state), say: '', fallback: true, reason:failure.code, notice: failure.message+'，电脑对手接手了这一步。' });
        }
      } catch { return response({ error: '牌局或请求无效，请重新开局。' }, 400); }
      finally { pending--; }
    },
  }));
}
