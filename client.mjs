import { GAMES, VERSION, createGame, legalActions, applyAction, points, cardLabel, unoLabel, COLORS, COLOR_NAMES, actionLabel, validateGame } from './games.mjs';
import {DIFFICULTIES,MODEL_PROFILES,opponentOptions,chooseOpponent,matchInfo} from './opponents.mjs';

if (!document.getElementById('dsh-bgame-host')) mount();
function mount() {
  const embedded = new URL(import.meta.url).searchParams.get('embedded') === '1';
  const host = document.createElement('div'); host.id = 'dsh-bgame-host'; document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('./bgame.css', import.meta.url); shadow.append(css);
  const launcher = document.createElement('button'); launcher.className = 'launcher'; launcher.title = '打开小游戏厅（Ctrl + Shift + G）'; launcher.innerHTML = '<span>♠</span> dsh-bgame';
  launcher.setAttribute('aria-expanded','false'); shadow.append(launcher);
  const panel = document.createElement('section'); panel.className = 'panel hidden'; panel.setAttribute('role','dialog'); panel.setAttribute('aria-label','DSH 小游戏厅');
  shadow.append(panel);
  if(embedded) panel.classList.add('embedded');
  const STORE = 'dsh.bgame.v1';
  let saved = {}, stats = { played: 0, wins: 0 }, mode = 'local', selection = null, kind = null, game = null, say = '', notice = '', paused = false, busy = false, open = false, confirm = false, color = 'red', choices = [], request = null, epoch = 0, timer = null, catalog = [], storageOK = true;
  let difficulty='normal',thinking='fast',failure='ask',recovery=null,clock=null,thinkingStarted=0,modelMeta=null;
  try {
    const value = JSON.parse(localStorage.getItem(STORE) ?? localStorage.getItem('dsh.arcade.v1') ?? 'null');
    if (value?.version === VERSION) {
      for (const [key, valueState] of Object.entries(value.saved ?? {})) { try { if (key === valueState.kind) saved[key] = validateGame(valueState); } catch {} }
      mode = value.mode === 'model' ? 'model' : 'local';
      try { ({difficulty,thinking,failure}=opponentOptions(value.options??{})); } catch {}
      if (typeof value.selection?.provider === 'string' && typeof value.selection?.model === 'string') selection = value.selection;
      if (Number.isInteger(value.stats?.played) && Number.isInteger(value.stats?.wins)) stats = value.stats;
    }
  } catch { storageOK = false; }
  const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  function save() {
    if (game) saved[game.kind] = game;
    try { localStorage.setItem(STORE,JSON.stringify({ version:VERSION,saved,mode,selection,stats,options:{difficulty,thinking,failure} })); storageOK = true; }
    catch { storageOK = false; }
  }
  function stopClock() { clearInterval(clock); clock=null; thinkingStarted=0; }
  function updateClock() { const el=panel.querySelector('[data-wait]');if(el)el.textContent='已等待 '+((Date.now()-thinkingStarted)/1000).toFixed(1)+' 秒 · 最长 '+MODEL_PROFILES[thinking].timeoutMs/1000+' 秒'; }
  function cancel() { epoch++; clearTimeout(timer); timer = null; request?.abort(); request = null; busy = false; stopClock(); }
  function toggle(value = !open) {
    open = value; launcher.classList.toggle('hidden',open||embedded); panel.classList.toggle('hidden',!open); launcher.setAttribute('aria-expanded',String(open));
    if (!open) { paused = Boolean(game?.status === 'playing'); cancel(); save(); if(embedded) window.parent.postMessage({type:'dsh-bgame:return'},location.origin); else launcher.focus(); }
    else { render(); panel.querySelector('[data-close]')?.focus(); kick(); }
  }
  launcher.addEventListener('click',() => toggle(true));
  document.addEventListener('keydown',event => {
    if (event.ctrlKey && event.shiftKey && event.code === 'KeyG') { event.preventDefault(); toggle(); }
    else if (event.key === 'Escape' && open) { event.preventDefault(); toggle(false); }
  });
  async function loadModels() {
    try {
      const res = await fetch(new URL('./api/bgame/models',document.baseURI), { credentials:'same-origin' });
      if (!res.ok) throw new Error();
      const result = await res.json(); catalog = result.models;
      if (!selection || !catalog.some(m=>m.provider===selection.provider && m.id===selection.model)) selection = result.default && catalog.some(m=>m.provider===result.default.provider && m.id===result.default.model) ? {provider:result.default.provider,model:result.default.model} : catalog[0] ? {provider:catalog[0].provider,model:catalog[0].id} : null;
      if (mode === 'model' && !catalog.length) notice = '尚未配置模型，请在 dsh 的模型设置中添加。电脑模式可以直接玩。';
      save(); if (open) { render(); kick(); }
    } catch { if (mode === 'model') { notice='暂时无法读取模型列表，可切换到电脑对手。'; if(open) render(); } }
  }
  let loaded = false;
  function render() {
    if (!open) return;
    if (!loaded) { loaded = true; void loadModels(); }
    const opts = catalog.map((m,index)=>`<option value="${index}" ${selection?.provider===m.provider&&selection?.model===m.id?'selected':''}>${escape(m.name)} · ${escape(m.provider)}</option>`).join('');
    panel.innerHTML = `<header class="top"><h1>dsh-bgame</h1><button class="quiet" data-close title="回到工作（Esc）">回到工作</button></header><main class="body">
      ${settingsView(opts)}
      ${notice?`<div class="notice" role="status">${escape(notice)}</div>`:''}
      ${confirm?'<div class="confirm"><span>重新开局会替换这局存档。</span><div><button data-keep>继续本局</button><button class="primary" data-new>重新开局</button></div></div>':''}
      ${game?gameView():hall()}
      </main><footer class="foot"><span>${storageOK?'自动保存进度':'无法保存进度'}</span></footer>`;
  }
  function settingsView(opts) {
    const difficultyOptions=Object.entries(DIFFICULTIES).map(([id,name])=>`<option value="${id}" ${difficulty===id?'selected':''}>${name}</option>`).join('');
    return `<div class="modebar"><label>对手 <select data-mode aria-label="选择对手"><option value="local" ${mode==='local'?'selected':''}>电脑</option><option value="model" ${mode==='model'?'selected':''}>模型</option></select></label>
      ${mode==='model'?`<label>模型 <select data-model aria-label="选择游戏模型"><option value="" ${!selection?'selected':''}>${catalog.length?'请选择模型':'暂无可用模型'}</option>${opts}</select></label><label>出招方式 <select data-thinking aria-label="模型出招方式">${Object.entries(MODEL_PROFILES).map(([id,profile])=>`<option value="${id}" ${thinking===id?'selected':''}>${profile.name}</option>`).join('')}</select></label><label>失败时 <select data-failure aria-label="模型失败处理"><option value="ask" ${failure==='ask'?'selected':''}>由我选择</option><option value="auto" ${failure==='auto'?'selected':''}>电脑自动接手</option></select></label>`:''}
      <label>${mode==='model'?'代打难度':'电脑难度'} <select data-difficulty aria-label="电脑难度" ${kind==='blackjack'?'disabled':''}>${difficultyOptions}</select></label></div>
      ${kind==='blackjack'?'<p class="settings-hint">庄家按规则要牌，17 点停牌，难度不影响庄家动作。</p>':mode==='model'?`<p class="settings-hint">${thinking==='thoughtful'?'认真思考会使用模型支持的较高思考档位，可能增加等待时间和调用费用。':'优先关闭思考，适合快速对局。'} 最长等待 ${MODEL_PROFILES[thinking].timeoutMs/1000} 秒。</p>`:''}`;
  }
  function gameArtwork(id) {
    const art={
      poker:'<rect x="17" y="7" width="29" height="43" rx="3" fill="#f5f5f5" stroke="#c4c4c4" transform="rotate(-12 30 30)"/><rect x="33" y="8" width="29" height="43" rx="3" fill="white" stroke="#888" transform="rotate(9 48 30)"/><text x="42" y="34" font-size="25" fill="#333">♠</text>',
      blackjack:'<rect x="15" y="8" width="29" height="43" rx="3" fill="white" stroke="#aaa"/><rect x="37" y="8" width="29" height="43" rx="3" fill="white" stroke="#aaa"/><text x="21" y="26" font-size="15" fill="#333">A</text><text x="23" y="43" font-size="15" fill="#333">♠</text><text x="44" y="26" font-size="15" fill="#ad3f39">K</text><text x="45" y="43" font-size="15" fill="#ad3f39">♥</text>',
      gomoku:'<rect x="15" y="5" width="50" height="50" rx="3" fill="#ead8b4"/><path d="M25 10v40m15-40v40m15-40v40M20 15h40M20 30h40M20 45h40" stroke="#b2a080"/><circle cx="40" cy="30" r="6" fill="#333"/><circle cx="55" cy="30" r="6" fill="white" stroke="#aaa"/><circle cx="40" cy="45" r="6" fill="#333"/>',
      uno:'<rect x="18" y="8" width="29" height="43" rx="4" fill="#547da0" transform="rotate(-12 30 30)"/><rect x="33" y="8" width="29" height="43" rx="4" fill="#b54c45" transform="rotate(10 48 30)"/><ellipse cx="48" cy="30" rx="9" ry="15" fill="none" stroke="white" stroke-width="2" transform="rotate(28 48 30)"/><text x="43" y="35" font-size="15" font-weight="bold" fill="white">7</text>',
    };
    return `<svg class="game-art" viewBox="0 0 80 60" aria-hidden="true">${art[id]}</svg>`;
  }
  function hall() {
    const descriptions={poker:'双人对局，盲注 10 / 20',blackjack:'和庄家比点数，可加倍',gomoku:'15 × 15 棋盘，黑棋先手',uno:'匹配颜色或数字，先出完手牌'};
    return `<section class="hall"><div class="hall-heading"><h2>选择游戏</h2>${stats.played?`<span class="stats">${stats.played} 局 · 胜 ${stats.wins} 局</span>`:''}</div><div class="tiles">${Object.entries(GAMES).map(([id,g])=>`<button class="tile" data-game="${id}">${gameArtwork(id)}<span class="tile-copy"><h3>${g.name}</h3><p>${descriptions[id]}</p></span><span class="start">${saved[id]?.status==='playing'?'继续对局':'开始'}<span aria-hidden="true"> ›</span></span></button>`).join('')}</div></section>`;
  }
  function playingCard(card, hidden=false) {
    return hidden?'<span class="playing-card back" aria-label="隐藏的手牌">♠</span>':`<span class="playing-card ${['♥','♦'].includes(card.suit)?'red-suit':''}" aria-label="${escape(cardLabel(card))}">${escape(cardLabel(card))}</span>`;
  }
  function gameView() {
    choices = legalActions(game);
    const done=game.status==='done', mine=game.turn===0&&!done&&!paused&&!busy;
    const info=matchInfo(game);
    let arena='';
    if(kind==='gomoku') {
      arena=`<p class="seat-name">你执黑 ● &nbsp; 对手执白 ○</p><div class="gomoku" role="group" aria-label="15 行 15 列五子棋盘">${game.board.map((cell,at)=>`<button class="cell ${at===game.last?'last':''}" data-at="${at}" ${!mine||cell?'disabled':''} aria-label="${Math.floor(at/15)+1} 行 ${at%15+1} 列，${cell===0?'空位':cell===1?'黑子':'白子'}">${cell?`<span class="stone ${cell===2?'white':''}"></span>`:''}</button>`).join('')}</div>`;
    } else if(kind==='uno') {
      const top=game.discard.at(-1);
      arena=`<div class="seat"><p class="seat-name">对手 · ${game.hands[1].length} 张手牌</p><div class="cards">${Array.from({length:Math.min(3,game.hands[1].length)},()=>playingCard(null,true)).join('')}</div></div><div class="center"><p>当前颜色：${COLOR_NAMES[game.color]} · 牌堆 ${game.deck.length} 张</p><div class="uno-card current ${top.color}">${escape(unoLabel(top))}</div></div><div class="seat"><p class="seat-name">你 · ${game.hands[0].length} 张手牌${game.drawn!==null&&game.turn===0?' · 只能出刚摸到的牌或跳过':''}</p><div class="cards">${game.hands[0].map((c,index)=>`<button class="uno-card ${c.color}" data-card="${index}" aria-label="出 ${escape(unoLabel(c))}" ${!mine||!choices.some(a=>a.type==='play'&&a.index===index)?'disabled':''}>${escape(unoLabel(c))}</button>`).join('')}</div></div><div class="color-pick"><span>万能牌换色：</span>${COLORS.map(c=>`<button data-color="${c}" class="${color===c?'selected':''}" style="background:${{red:'#b34154',yellow:'#b58620',green:'#277952',blue:'#3867b4'}[c]}" aria-label="选择${COLOR_NAMES[c]}色" aria-pressed="${color===c}"></button>`).join('')}</div>`;
    } else {
      const hidden=kind==='poker'? !game.handRanks : game.turn===0&&!done;
      arena=`<div class="seat"><p class="seat-name">${kind==='blackjack'?'庄家':'对手'} ${kind==='poker'?`<span class="chips">${game.chips[1]} 筹码</span> · 本轮已下注 ${game.street[1]}`:hidden?'· 暗牌未翻开':`· ${points(game.hands[1])} 点`}</p><div class="cards">${game.hands[1].map((c,i)=>playingCard(c,kind==='poker'?hidden:hidden&&i===1)).join('')}</div></div><div class="center">${kind==='poker'?`<p>${['翻牌前','翻牌','转牌','河牌'][game.stage]} · 底池 ${game.pot} · ${game.dealer===0?'你':'对手'}为按钮位</p><div class="cards">${game.board.length?game.board.map(c=>playingCard(c)).join(''):Array.from({length:3},()=>playingCard(null,true)).join('')}</div>`:`<p>下注 ${game.bet} · 本局筹码 ${game.balance}</p><span class="badge">庄家 17 点停牌 · 天然 21 点赔 3:2</span>`}</div><div class="seat"><p class="seat-name">你 ${kind==='poker'?`<span class="chips">${game.chips[0]} 筹码</span> · 本轮已下注 ${game.street[0]}`:`· ${points(game.hands[0])} 点`}</p><div class="cards">${game.hands[0].map(c=>playingCard(c)).join('')}</div></div>`;
    }
    const actionButtons=choices.flatMap((a,index)=>a.type==='place'||a.type==='play'?[]:[`<button data-action="${index}" ${mine?'':'disabled'} class="${['call','stand','draw'].includes(a.type)?'primary':''}">${escape(actionLabel(a,game))}</button>`]).join('');
    const status=done?game.message:recovery?'等待你选择重试或电脑代打。':paused?'已暂停':busy?'模型正在思考…':game.turn===0?'轮到你了。':mode==='model'&&!selection?'请选择模型，或切换到电脑对手。':'对手正在考虑下一步…';
    return `<div class="game-title"><h2>${GAMES[kind].name}</h2><div><button class="quiet" data-hall>游戏大厅</button><button class="quiet" data-restart>新一局</button></div></div>${matchView(info)}<div class="game-layout"><div><div class="arena ${kind==='gomoku'?'board-arena':''}">${arena}${!done?`<div class="actions">${actionButtons}</div>`:''}</div><div class="status ${done&&game.winner===0?'win':''}" role="status" aria-live="polite">${escape(status)}${busy?'<span class="wait-time" data-wait role="timer" aria-live="off"></span>':''}</div>${recovery?'<div class="recovery actions"><button class="primary" data-retry>重试模型</button><button data-takeover>电脑代打本步</button></div>':''}<div class="actions">${done?'<button class="primary" data-new>再来一局</button>':`<button data-pause ${recovery?'disabled':''}>${paused?recovery?'保持暂停':'继续对局':busy?'取消思考并暂停':'暂停对局'}</button>`}</div><details class="rules"><summary>本局规则</summary><p>${GAMES[kind].rules}</p></details></div><aside class="sidebar">${modelMeta?`<p class="model-result">${escape(modelResultText())}</p>`:''}${say?`<h3>模型回复</h3><p class="say">${escape(say)}</p>`:''}<h3>对局记录</h3><div class="history">${game.log.slice().reverse().map(line=>`<div>${escape(line)}</div>`).join('')}</div></aside></div>`;
  }
  function modelResultText() {
    if(modelMeta.source==='computer')return '电脑代打 · '+DIFFICULTIES[modelMeta.difficulty??difficulty];
    const levels={off:'关闭',minimal:'最低',low:'低',medium:'中',high:'高',max:'最高'};
    return '模型出招 '+(modelMeta.elapsedMs/1000).toFixed(1)+' 秒 · 思考档位：'+(levels[modelMeta.reasoningEffort]??(modelMeta.reasoningEffort??'服务默认'));
  }
  function matchView(info) {
    return `<section class="match-info" aria-label="对局信息"><dl><div><dt>当前回合</dt><dd data-turn>${escape(info.turn)}${paused?' · 已暂停':''}</dd></div><div><dt>已走步数</dt><dd data-moves>${info.moves}</dd></div><div class="last-move"><dt>上一手</dt><dd data-last-move>${escape(info.lastMove)}</dd></div></dl>
      ${info.poker?`<dl class="bet-info"><div><dt>底池</dt><dd data-pot>${info.poker.pot}</dd></div><div><dt>本轮最高下注</dt><dd data-bet>${info.poker.currentBet}</dd></div><div><dt>你需跟注</dt><dd data-to-call>${info.poker.toCall}</dd></div></dl>`:''}</section>`;
  }
  function start(id,fresh=false) {
    cancel(); kind=id; game=!fresh&&saved[id]?.status==='playing'?saved[id]:createGame(id,{dealer:game?.kind==='poker'?1-game.dealer:0});
    paused=false; confirm=false; say=''; notice=''; recovery=null; modelMeta=null;
    if(game.status==='done') { stats.played++; if(game.winner===0) stats.wins++; }
    save(); render(); kick();
  }
  function move(action) {
    const before=game;
    try { game=applyAction(game,action); } catch { notice='这个动作当前不可用，请选择其他动作。'; render(); return; }
    if(before.status==='playing' && game.status==='done') { stats.played++; if(game.winner===0) stats.wins++; }
    save(); render(); kick();
  }
  function kick() {
    if(!open||!game||game.status!=='playing'||game.turn!==1||paused||busy||timer||recovery) return;
    if(mode==='model'&&!selection) return;
    const token=epoch;
    timer=setTimeout(async()=> {
      timer=null;
      if(token!==epoch||!open||paused) return;
      if(mode==='local') { move(chooseOpponent(game,difficulty)); return; }
      busy=true; request=new AbortController(); thinkingStarted=Date.now(); render(); updateClock(); clock=setInterval(updateClock,250);
      try {
        const res=await fetch(new URL('./api/bgame/move',document.baseURI),{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({state:game,selection,options:{thinking,failure,difficulty}}),signal:request.signal});
        const result=await res.json();
        if(token!==epoch) return;
        if(!res.ok) throw new Error(result.error??'模型暂时无法行动。');
        busy=false; request=null; stopClock();
        if(result.retryable){recovery=true;paused=true;notice=result.notice;render();return;}
        say=result.say||''; notice=result.notice||''; modelMeta=result.meta??null; move(result.action);
      } catch(error) {
        if(token!==epoch) return;
        busy=false; request=null; stopClock(); paused=true; recovery=true; notice=error instanceof TypeError?'模型连接中断，请重试或电脑代打本步。':error.message||'模型暂时无法出招。'; render();
      }
    },mode==='local'?420:150);
  }
  panel.addEventListener('change',event=> {
    const target=event.target;
    if(!target.matches('[data-mode],[data-model],[data-thinking],[data-failure],[data-difficulty]'))return;
    const wasRecovery=Boolean(recovery);cancel();recovery=null;modelMeta=null;say='';notice='';if(wasRecovery)paused=false;
    if(target.matches('[data-mode]'))mode=target.value;
    if(target.matches('[data-model]')){const chosen=catalog[Number(target.value)];selection=target.value!==''&&chosen?{provider:chosen.provider,model:chosen.id}:null;}
    if(target.matches('[data-thinking]'))thinking=target.value;
    if(target.matches('[data-failure]'))failure=target.value;
    if(target.matches('[data-difficulty]'))difficulty=target.value;
    save();render();kick();
  });
  panel.addEventListener('click',event=> {
    const button=event.target.closest('button'); if(!button||button.disabled) return;
    const data=button.dataset;
    if('close' in data) toggle(false);
    else if('game' in data) start(data.game);
    else if('hall' in data) { cancel(); save(); game=null; kind=null; confirm=false; recovery=null;modelMeta=null; render(); }
    else if('restart' in data) { if(game.status==='playing') { cancel(); paused=true; confirm=true; render(); } else start(kind,true); }
    else if('new' in data) start(kind,true);
    else if('keep' in data) { confirm=false; paused=Boolean(recovery); render(); kick(); }
    else if('retry' in data){cancel();recovery=null;paused=false;notice='';render();kick();}
    else if('takeover' in data){cancel();recovery=null;paused=false;say='';notice='电脑代打本步，之后仍由模型出招。';modelMeta={source:'computer',difficulty};move(chooseOpponent(game,difficulty));}
    else if('pause' in data) { cancel(); paused=!paused; notice=''; render(); kick(); }
    else if('color' in data) { color=data.color; render(); }
    else if('at' in data) move({type:'place',at:Number(data.at)});
    else if('action' in data) move(choices[Number(data.action)]);
    else if('card' in data) {
      const index=Number(data.card); const action=choices.find(a=>a.type==='play'&&a.index===index&&(!a.color||a.color===color));
      if(action) move(action);
    }
  });
  if(embedded) toggle(true);
}
