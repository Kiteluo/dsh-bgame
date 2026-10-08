import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, legalActions, points, rank5, bestHand, compareRank, five, chooseLocal, observation, validateGame, deck52, deckUno, shuffle, actionLabel } from '../games.mjs';
import { modelMove, apply } from '../index.mjs';
function random(seed=7) { return ()=>{ seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; }; }
const cards = (ranks,suit='♠') => ranks.map(rank=>({rank,suit}));
function fixture21(a,b) {
  const state=createGame('blackjack',{},random(4));
  state.hands=[a,b]; const used=new Set([...a,...b].map(c=>c.suit+c.rank)); state.deck=deck52().filter(c=>!used.has(c.suit+c.rank));
  state.status='playing'; state.turn=0; state.balance=1000; state.message=''; return state;
}
function fixtureUno(hands,top) {
  const s=createGame('uno',{},random(3)); s.hands=hands; s.discard=[top]; s.color=top.color;
  const used=new Set([...hands.flat(),top].map(c=>c.id)); s.deck=deckUno().filter(c=>!used.has(c.id)); return s;
}
const findUno=(color,value,n=0)=>deckUno().filter(c=>c.color===color&&c.value===value)[n];
test('21 点：多张 A、天然牌与庄家规则',()=> {
  assert.equal(points(cards([14,14,9])),21); assert.equal(points(cards([14,14,10,9])),21);
  let s=fixture21(cards([14,13]),cards([14,12],'♥')); s.turn=1;
  s=applyAction(s,{type:'stand'}); assert.equal(s.winner,null);
  s=fixture21(cards([14,13]),cards([10,8],'♥')); s.turn=1;
  s=applyAction(s,{type:'stand'}); assert.equal(s.winner,0); assert.equal(s.balance,1030);
  s=fixture21(cards([10,9]),cards([14,6],'♥')); s.turn=1;
  assert.deepEqual(legalActions(s),[{type:'stand'}]);
  assert.throws(()=>applyAction(s,{type:'hit'}));
});
test('21 点：加倍只摸一张后转交庄家，爆牌立即结算',()=> {
  let s=fixture21(cards([5,6]),cards([10,8],'♥')); s.deck.push({rank:9,suit:'♦'});
  s=applyAction(s,{type:'double'}); assert.equal(s.bet,40); assert.equal(s.hands[0].length,3); assert.equal(s.turn,1);
  s=applyAction(s,{type:'stand'}); assert.equal(s.balance,1040);
  s=fixture21(cards([13,12]),cards([10,8],'♥')); s.deck.push({rank:5,suit:'♦'});
  s=applyAction(s,{type:'hit'}); assert.equal(s.winner,1); assert.equal(s.status,'done');
});
test('五子棋：四种方向、边界和禁用重复落子',()=> {
  for(const [start,step] of [[0,1],[0,15],[0,16],[4,14]]) {
    const board=Array(225).fill(0); for(let i=0;i<5;i++) board[start+i*step]=1; assert.equal(five(board,start),true);
  }
  const board=Array(225).fill(0); [13,14,15,16,17].forEach(i=>board[i]=1); assert.equal(five(board,15),false);
  let s=createGame('gomoku'); s=applyAction(s,{type:'place',at:112}); assert.throws(()=>applyAction(s,{type:'place',at:112}));
  s=createGame('gomoku'); [0,1,2,3].forEach(i=>s.board[i]=1); s.turn=1;
  assert.deepEqual(chooseLocal(s),{type:'place',at:4});
  [30,31,32,33].forEach(i=>s.board[i]=2); assert.deepEqual(chooseLocal(s),{type:'place',at:34});
});
test('德扑：九类牌型、A 小顺子及最佳五张牌',()=> {
  assert.deepEqual(rank5(cards([14,5,4,3,2])),[8,5]);
  assert.deepEqual(rank5([{rank:14,suit:'♥'},...cards([5,4,3,2])]),[4,5]);
  const royal=cards([14,13,12,11,10]); assert.deepEqual(bestHand([...royal,...cards([2,3],'♥')]),[8,14]);
  assert(compareRank([1,14,13,9,7],[1,14,12,11,10])>0);
  assert(compareRank([6,3,14],[5,14,13,12,11,9])>0);
  assert(compareRank([2,13,2,14],[2,12,11,14])>0);
});
test('德扑：盲注选项、完整四轮下注及平分公共牌底池',()=> {
  let s=createGame('poker',{},random(9));
  assert.equal(s.turn,0); assert.equal(s.pot,30);
  s=applyAction(s,{type:'call'}); assert.equal(s.stage,0); assert.equal(s.turn,1);
  s=applyAction(s,{type:'check'}); assert.equal(s.stage,1); assert.equal(s.board.length,3); assert.equal(s.turn,1);
  for(let i=0;i<6;i++) s=applyAction(s,{type:'check'});
  assert.equal(s.status,'done'); assert.equal(s.board.length,5); assert.equal(s.chips.reduce((a,b)=>a+b),2000);
  s=createGame('poker',{},random(9)); s=applyAction(s,{type:'raise',to:1000}); s=applyAction(s,{type:'call'});
  assert.equal(s.status,'done'); assert.equal(s.board.length,5); assert.equal(s.chips.reduce((a,b)=>a+b),2000);
  s=createGame('poker'); s=applyAction(s,{type:'fold'}); assert.deepEqual(s.chips,[990,1010]);
});
test('UNO：108 张牌、+4 限制、双人反转和最后一张罚牌',()=> {
  assert.equal(deckUno().length,108);
  const top=findUno('red',3), red=findUno('red',2), wild=findUno('wild','+4');
  let s=fixtureUno([[red,wild],[findUno('blue',5)]],top);
  assert(!legalActions(s).some(a=>a.type==='play'&&a.index===1));
  s=fixtureUno([[findUno('red','reverse'),red],[findUno('blue',5)]],top);
  s=applyAction(s,{type:'play',index:0}); assert.equal(s.turn,0); assert(s.log.some(x=>x.includes('UNO')));
  s=fixtureUno([[findUno('red','+2')],[findUno('blue',5)]],top);
  s=applyAction(s,{type:'play',index:0}); assert.equal(s.status,'done'); assert.equal(s.winner,0); assert.equal(s.hands[1].length,3);
});
test('UNO：摸牌后只能出新牌，重洗时保留最上方弃牌',()=> {
  let s=fixtureUno([[findUno('red',2)],[findUno('blue',5)]],findUno('red',3));
  s.deck.push(s.deck.splice(s.deck.findIndex(c=>c.color==='red'&&c.value===4),1)[0]);
  s=applyAction(s,{type:'draw'}); assert.equal(s.drawn,1);
  assert(!legalActions(s).some(a=>a.type==='play'&&a.index===0)); assert(legalActions(s).some(a=>a.type==='pass'));
  s.deck=[]; s.discard=[findUno('green',5),findUno('red',3)]; s=applyAction(s,{type:'pass'}); s=applyAction(s,{type:'draw'},random(9));
  assert.equal(s.discard.length,1); assert.equal(s.discard[0].value,3);
});
test('随机完整对局：筹码守恒、牌数守恒和有限回合',()=> {
  const rng=random(81);
  for(const kind of ['poker','blackjack','uno']) for(let n=0;n<100;n++) {
    let s=createGame(kind,{dealer:n%2},rng), count=0;
    while(s.status==='playing' && count++<2000) {
      validateGame(s); const actions=legalActions(s); assert(actions.length>0);
      s=applyAction(s,kind==='uno'?chooseLocal(s,rng):actions[Math.floor(rng()*actions.length)],rng);
      validateGame(s);
      if(kind==='poker') { assert(s.chips.every(n=>n>=0)); assert.equal(s.pot+s.chips[0]+s.chips[1],2000); }
    }
    assert.equal(s.status,'done',`${kind} 对局未结束`);
  }
});
test('模型视图不包含对方暗牌或未来牌序',()=> {
  for(const kind of ['poker','uno']) {
    const s=createGame(kind); s.turn=1; const v=observation(s,1);
    assert.equal(v.deck,undefined); assert.equal(v.hands,undefined); assert.deepEqual(v.hand,s.hands[1]); assert.equal(v.opponent,undefined);
  }
});
test('模型请求只允许合法动作，支持流式文本及正常完成',async()=> {
  const s=createGame('poker',{dealer:1},random(9)); let request;
  const llm={resolveModelInfo:async()=>({reasoning:{efforts:[{id:"low"},{id:"off"}]}}),prepareCall:async config=>({config,stream:async function*(options){request=options;yield {type:'text-delta',text:'```json\n{"choice":1,"say":"我跟！"}\n```'};yield {type:'finish',reason:{kind:'stop'}};}})};
  const out=await modelMove(llm,s,{provider:'test',model:'mock'},new AbortController().signal);
  assert.deepEqual(out.action,legalActions(s)[1]); assert.equal(out.say,'我跟！');
  const prompt=JSON.parse(request.messages[0].content[0].text); assert.equal(prompt.state.deck,undefined); assert.equal(prompt.state.hands,undefined); assert.equal(request.tools,undefined);
  assert.equal(request.maxTokens,8192);assert.equal(request.reasoningEffort,"off");
  const bad={resolveModelInfo:async()=>({reasoning:{efforts:[{id:"low"},{id:"off"}]}}),prepareCall:async config=>({config,stream:async function*(){yield {type:'text-delta',text:'{"choice":999}'};yield {type:'finish',reason:{kind:'stop'}};}})};
  await assert.rejects(modelMove(bad,s,{provider:'test',model:'mock'}));
});
test('模型中断或失败不能当作正常行动',async()=> {
  const s=createGame('gomoku'); s.turn=1;
  for(const reason of [{kind:'error'},{kind:'aborted'}]) {
    const llm={resolveModelInfo:async()=>({reasoning:{efforts:[{id:"low"},{id:"off"}]}}),prepareCall:async config=>({config,stream:async function*(){yield {type:'text-delta',text:'{"choice":0}'};yield {type:'finish',reason};}})};
    await assert.rejects(modelMove(llm,s,{provider:'test',model:'mock'}));
  }
});
test('插件挂载认证路由并在卸载时释放资源',async()=> {
  const effects=[],routes=[],fetchRoutes=[]; let tap;
  const ctx={effect:fn=>effects.push(fn()),get:()=>undefined,webServer:{tapIndex:fn=>{tap=fn;return()=>{};},register:route=>{routes.push(route);return()=>{};}},connection:{requestRejection:()=>401,fetch:{register:route=>{fetchRoutes.push(route);return async()=>{};}}},llm:{listProviders:()=>[]}};
  apply(ctx); assert.equal(tap,undefined); assert.equal(fetchRoutes.length,2);
  let status; await routes[0].handler({method:'GET',url:'/bgame/client.mjs'},{writeHead:s=>status=s,end:()=>{}}); assert.equal(status,401);
  const models=await fetchRoutes[0].fetch(new Request('http://localhost/api/bgame/models')); assert.deepEqual(await models.json(),{models:[],default:null});
  for(const dispose of effects.reverse()) await dispose();
});

test('所有游戏动作标签可独立渲染',()=>{for(const kind of ['poker','blackjack','gomoku','uno']){const state=createGame(kind,{},random(5));for(const action of legalActions(state))assert.equal(typeof actionLabel(action,state),'string');}});

test('德扑：公共同花顺平局，筹码完整归还',()=>{
  let s=createGame('poker',{},random(19));
  s.board=cards([14,13,12,11,10]);s.stage=3;
  const rest=deck52().filter(c=>!(c.suit==='♠'&&c.rank>=10));
  s.hands=[rest.splice(0,2),rest.splice(0,2)];s.deck=rest;
  validateGame(s);s=applyAction(s,{type:'call'});s=applyAction(s,{type:'check'});
  assert.equal(s.winner,null);assert.deepEqual(s.chips,[1000,1000]);assert.deepEqual(s.handRanks,[[8,14],[8,14]]);
});

test('Plugin manifest passes the real DSH startup preflight', async()=>{
  const {readFileSync}=await import('node:fs');
  const {fileURLToPath}=await import('node:url');
  const {prepareProfileEntries}=await import('@deepseek-ai/dsh-app-boot');
  const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(manifest.name,'dsh-bgame');
  const {mkdir,symlink,lstat}=await import('node:fs/promises');
  const profile=new URL('./preflight-home/',import.meta.url);
  await mkdir(new URL('node_modules/',profile),{recursive:true});
  const linked=new URL('node_modules/dsh-bgame',profile);
  if(!await lstat(linked).catch(()=>null))await symlink(fileURLToPath(new URL('../',import.meta.url)),fileURLToPath(linked),'junction');
  const rows=prepareProfileEntries({get:key=>key==='profileContext'?{dir:fileURLToPath(profile)}:undefined},[{id:'dsh-bgame',name:new URL('../index.mjs',import.meta.url).href}],new URL('cordis.yml',profile).href);
  assert.notEqual(rows[0].disabled,true);
});
test('推理模型截断保留 MAX_TOKENS 原因，服务拒绝保留错误分类',async()=>{
  const s=applyAction(createGame('gomoku'),{type:'place',at:112});
  for(const [reason,code] of [
    [{kind:'max-tokens'},'MAX_TOKENS'],
    [{kind:'error',failure:{code:'AUTH',status:401,message:'Bearer sk-secret'}},'AUTH'],
    [{kind:'error',failure:{code:'RATE_LIMIT',status:429,message:'too many requests'}},'RATE_LIMIT'],
  ]){
    const llm={resolveModelInfo:async()=>({reasoning:{efforts:[{id:'off'},{id:'low'},{id:'high'}]}}),prepareCall:async config=>({config,stream:async function*(){yield {type:'reasoning-delta',text:'思考中'};yield {type:'finish',reason};}})};
    await assert.rejects(modelMove(llm,s,{provider:'test',model:'reasoner'}),error=>error.code===code&&!error.message.includes('sk-secret'));
  }
});

test('无思考档位的模型不发送未知 reasoningEffort',async()=>{
  const s=applyAction(createGame('gomoku'),{type:'place',at:112});let proposed;
  const llm={resolveModelInfo:async()=>({}),prepareCall:async config=>{proposed=config;return {config,stream:async function*(){yield {type:'text-delta',text:'{"choice":0,"say":"落子"}'};yield {type:'finish',reason:{kind:'stop'}};}};}};
  const result=await modelMove(llm,s,{provider:'test',model:'plain'});
  assert.equal(Object.hasOwn(proposed,'reasoningEffort'),false);assert.equal(result.action.type,'place');
});

test('模型失败 API 明确报告输出截断，且电脑接手动作合法',async()=>{
  const effects=[],routes=[];
  const ctx={effect:fn=>effects.push(fn()),get:()=>undefined,webServer:{register:()=>()=>{}},connection:{fetch:{register:r=>{routes.push(r);return()=>{};}}},llm:{
    listProviders:()=>[{id:'test'}],listModels:async()=>[{provider:'test',id:'reasoner',name:'Reasoner'}],
    resolveModelInfo:async()=>({reasoning:{efforts:[{id:'low'}]}}),prepareCall:async config=>({config,stream:async function*(){yield {type:'finish',reason:{kind:'max-tokens'}};}}),
  }};
  apply(ctx);
  const state=applyAction(createGame('gomoku'),{type:'place',at:112});
  const response=await routes.find(r=>r.path==='/api/bgame/move').fetch(new Request('http://localhost/api/bgame/move',{method:'POST',body:JSON.stringify({state,selection:{provider:'test',model:'reasoner'}})}));
  const result=await response.json();assert.equal(result.reason,'MAX_TOKENS');assert.equal(result.fallback,true);assert.match(result.notice,/输出额度/);assert.doesNotThrow(()=>applyAction(state,result.action));
  for(const dispose of effects.reverse())await dispose();
});
test('模型支持关闭思考时优先关闭，五子棋坐标完整映射合法动作',async()=>{
  const state=applyAction(createGame('gomoku'),{type:'place',at:112});let request;
  const llm={resolveModelInfo:async()=>({reasoning:{efforts:[{id:'high'},{id:'low'},{id:'off'}]}}),prepareCall:async config=>({config,stream:async function*(options){request=options;yield {type:'text-delta',text:'{"choice":112,"say":"先占这一点。"}'};yield {type:'finish',reason:{kind:'stop'}};}})};
  const out=await modelMove(llm,state,{provider:'test',model:'mock'});
  assert.equal(request.reasoningEffort,'off');
  const prompt=JSON.parse(request.messages[0].content[0].text);
  assert.equal(prompt.state.board.length,15);assert.equal(prompt.state.board[7],'.......X.......');
  assert.equal(prompt.state.deck,undefined);assert.equal(prompt.choices.length,224);
  for(const item of prompt.choices)assert.equal((item.row-1)*15+item.col-1,legalActions(state)[item.choice].at);
  assert.deepEqual(out.action,legalActions(state)[112]);
});

test('强制推理模型使用支持的最低档位',async()=>{
  const state=applyAction(createGame('gomoku'),{type:'place',at:112});let selected;
  const llm={resolveModelInfo:async()=>({reasoning:{efforts:[{id:'high'},{id:'low'},{id:'minimal'}]}}),prepareCall:async config=>{selected=config;return {config,stream:async function*(){yield {type:'text-delta',text:'{"choice":0}'};yield {type:'finish',reason:{kind:'stop'}};}};}};
  await modelMove(llm,state,{provider:'test',model:'reasoner'});assert.equal(selected.reasoningEffort,'minimal');
});

test('输出额度用尽但完整合法 JSON 已返回时保留模型走法',async()=>{
  const state=applyAction(createGame('gomoku'),{type:'place',at:112});
  const llm={resolveModelInfo:async()=>({}),prepareCall:async config=>({config,stream:async function*(){yield {type:'text-delta',text:'{"choice":'};yield {type:'text-delta',text:'112,"say":"落子"}'};yield {type:'finish',reason:{kind:'max-tokens'}};}})};
  const result=await modelMove(llm,state,{provider:'test',model:'plain'});
  assert.deepEqual(result.action,legalActions(state)[112]);assert.equal(result.say,'落子');
});

test('输出截断时不执行半个 JSON 或非法选择',async()=>{
  const state=applyAction(createGame('gomoku'),{type:'place',at:112});
  for(const text of ['', '{"choice":112', '{"choice":112,"say":"未完成', '{"choice":999}']){
    const llm={resolveModelInfo:async()=>({}),prepareCall:async config=>({config,stream:async function*(){yield {type:'text-delta',text};yield {type:'finish',reason:{kind:'max-tokens'}};}})};
    await assert.rejects(modelMove(llm,state,{provider:'test',model:'plain'}),error=>error.code==='MAX_TOKENS');
  }
});
