export const VERSION = 1;
export const GAMES = {
  poker: { name: '德州扑克', icon: '♠', desc: '双人牌桌 · 虚拟筹码', rules: '双人无限注德州扑克。小盲 10、大盲 20；翻牌、转牌、河牌后比较最佳五张牌。下注上限按双方有效筹码计算，不设边池。' },
  blackjack: { name: '21 点', icon: '♥', desc: '再来一张，还是收手？', rules: 'A 算 1 或 11，花牌算 10。庄家在 17 点（含软 17）停牌。天然 21 点赔 3:2；可在最初两张牌时加倍，只再取一张。不含分牌、保险。筹码仅用于本局娱乐。' },
  gomoku: { name: '五子棋', icon: '●', desc: '15 × 15 · 先连五子获胜', rules: '自由五子棋，15 × 15 棋盘，黑棋先手。横、竖、斜线连续五子或以上获胜，无禁手。' },
  uno: { name: 'UNO', icon: '✦', desc: '换色、跳过、反转，出光手牌', rules: '双人 UNO：匹配颜色或牌面出牌；万能牌可换色。同色有牌时不能出 +4。+2/+4 摸牌并跳过，不叠加、不设质疑；双人反转相当于跳过。摸一张后可出刚摸的牌或跳过。剩一张自动喊 UNO。最后一张罚牌仍生效。' }
};
export const COLORS = ['red', 'yellow', 'green', 'blue'];
export const COLOR_NAMES = { red: '红', yellow: '黄', green: '绿', blue: '蓝' };
export function shuffle(items, rng = Math.random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
export function deck52() { return ['♠', '♥', '♦', '♣'].flatMap(suit => Array.from({ length: 13 }, (_, i) => ({ suit, rank: i + 2 }))); }
export function cardLabel(c) { return c ? `${({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[c.rank] ?? c.rank}${c.suit}` : '？'; }
export function points(cards) {
  let n = cards.reduce((sum, c) => sum + (c.rank === 14 ? 11 : Math.min(c.rank, 10)), 0);
  let aces = cards.filter(c => c.rank === 14).length;
  while (n > 21 && aces-- > 0) n -= 10;
  return n;
}
const note = (s, text) => { s.log.push(text); s.log = s.log.slice(-40); };
const end = (s, winner, message) => { s.status = 'done'; s.winner = winner; s.message = message; note(s, message); };
export function createGame(kind, options = {}, rng = Math.random) {
  if (!Object.hasOwn(GAMES, kind)) throw new Error('未知游戏');
  const s = { version: VERSION, kind, status: 'playing', turn: 0, winner: null, message: '', log: [], moves: 0 };
  if (kind === 'gomoku') { s.board = Array(225).fill(0); s.last = -1; note(s, '你执黑先行，对手执白。'); }
  if (kind === 'blackjack') {
    s.deck = shuffle(deck52(), rng); s.hands = [[s.deck.pop(), s.deck.pop()], [s.deck.pop(), s.deck.pop()]];
    s.bet = 20; s.balance = 1000; s.doubled = false;
    if (points(s.hands[0]) === 21 || points(s.hands[1]) === 21) settle21(s);
    else note(s, '你已下注 20 枚虚拟筹码。');
  }
  if (kind === 'poker') {
    s.deck = shuffle(deck52(), rng); s.hands = [[s.deck.pop(), s.deck.pop()], [s.deck.pop(), s.deck.pop()]];
    s.board = []; s.dealer = options.dealer === 1 ? 1 : 0; s.turn = s.dealer; s.stage = 0;
    s.chips = [1000, 1000]; s.street = [0, 0]; s.pot = 0; s.acted = [false, false]; s.lastRaise = 20;
    commit(s, s.dealer, 10); commit(s, 1 - s.dealer, 20); note(s, '已下小盲 10 / 大盲 20，开始翻牌前下注。');
  }
  if (kind === 'uno') {
    s.deck = shuffle(deckUno(), rng); s.hands = [s.deck.splice(-7), s.deck.splice(-7)];
    const index = s.deck.findIndex(c => typeof c.value === 'number');
    s.discard = [s.deck.splice(index, 1)[0]]; s.color = s.discard[0].color; s.drawn = null; s.passes = 0;
    note(s, '每人 7 张牌，你先出。');
  }
  return s;
}
export function deckUno() {
  let id = 0; const out = [];
  for (const color of COLORS) {
    out.push({ id: id++, color, value: 0 });
    for (const value of [1,2,3,4,5,6,7,8,9,'skip','reverse','+2']) for (let n = 0; n < 2; n++) out.push({ id: id++, color, value });
  }
  for (const value of ['wild', '+4']) for (let n = 0; n < 4; n++) out.push({ id: id++, color: 'wild', value });
  return out;
}
function unoCanPlay(s, card, player) {
  if (card.value === '+4') return !s.hands[player].some(c => c.color === s.color);
  return card.color === 'wild' || card.color === s.color || card.value === s.discard.at(-1).value;
}
export function legalActions(s) {
  if (s.status !== 'playing') return [];
  const p = s.turn;
  if (s.kind === 'gomoku') return s.board.flatMap((cell, at) => cell === 0 ? [{ type: 'place', at }] : []);
  if (s.kind === 'blackjack') {
    if (p === 1) return [{ type: points(s.hands[1]) < 17 ? 'hit' : 'stand' }];
    return [{ type: 'hit' }, { type: 'stand' }, ...(s.hands[0].length === 2 && !s.doubled ? [{ type: 'double' }] : [])];
  }
  if (s.kind === 'uno') {
    const plays = s.hands[p].flatMap((card, index) => {
      if ((s.drawn !== null && index !== s.drawn) || !unoCanPlay(s, card, p)) return [];
      return card.color === 'wild' ? COLORS.map(color => ({ type: 'play', index, color })) : [{ type: 'play', index }];
    });
    return [...plays, { type: s.drawn === null ? 'draw' : 'pass' }];
  }
  const other = 1 - p; const current = Math.max(...s.street); const due = current - s.street[p];
  const actions = [{ type: 'fold' }, { type: due === 0 ? 'check' : 'call' }];
  const cap = Math.min(s.street[p] + s.chips[p], s.street[other] + s.chips[other]);
  const min = current + s.lastRaise;
  const sizes = [...new Set([min, current + Math.max(s.lastRaise, Math.floor(s.pot / 2)), cap])];
  for (const to of sizes) if (to > current && to <= cap && (to >= min || to === cap)) actions.push({ type: 'raise', to });
  return actions;
}
export function sameAction(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
export function applyAction(state, action, rng = Math.random) {
  const canonical = legalActions(state).find(a => a.type === action?.type && a.at === action.at && a.index === action.index && a.color === action.color && a.to === action.to);
  if (!canonical) throw new Error('这个动作当前不可用');
  const s = structuredClone(state); const p = s.turn; const who = p === 0 ? '你' : '对手'; s.moves++;
  s.lastAction = {player:p,label:actionLabel(canonical,state)};
  if (s.kind === 'gomoku') {
    s.board[action.at] = p + 1; s.last = action.at;
    note(s, `${who}落子 ${Math.floor(action.at / 15) + 1} 行 ${action.at % 15 + 1} 列`);
    if (five(s.board, action.at)) end(s, p, `${who}连成五子，获胜！`);
    else if (s.board.every(Boolean)) end(s, null, '棋盘已满，和棋。');
    else s.turn = 1 - p;
  }
  if (s.kind === 'blackjack') {
    if (action.type === 'double') { s.bet *= 2; s.doubled = true; }
    if (action.type !== 'stand') { const c = s.deck.pop(); s.hands[p].push(c); note(s, `${who}摸到 ${cardLabel(c)}`); }
    if (points(s.hands[p]) > 21) settle21(s);
    else if (p === 1 && action.type === 'stand') settle21(s);
    else if (p === 0 && (action.type === 'stand' || action.type === 'double' || points(s.hands[0]) === 21)) { s.turn = 1; note(s, '轮到庄家。'); }
  }
  if (s.kind === 'poker') pokerAction(s, action, who);
  if (s.kind === 'uno') unoAction(s, action, who, rng);
  return s;
}
function settle21(s) {
  const a = points(s.hands[0]), b = points(s.hands[1]);
  const naturalA = a === 21 && s.hands[0].length === 2 && !s.doubled;
  const naturalB = b === 21 && s.hands[1].length === 2;
  const winner = a > 21 ? 1 : b > 21 ? 0 : naturalA && !naturalB ? 0 : naturalB && !naturalA ? 1 : a === b ? null : a > b ? 0 : 1;
  const delta = winner === null ? 0 : winner === 0 ? s.bet * (naturalA ? 1.5 : 1) : -s.bet;
  s.balance += delta;
  end(s, winner, `你 ${a} 点 / 庄家 ${b} 点 · ${winner === null ? '平局' : winner === 0 ? '你赢了' : '庄家获胜'}${delta ? `（${delta > 0 ? '+' : ''}${delta} 筹码）` : ''}`);
}
export function five(board, at) {
  const stone = board[at]; if (!stone) return false;
  const row = Math.floor(at / 15), col = at % 15;
  return [[1,0],[0,1],[1,1],[1,-1]].some(([dr, dc]) => {
    let count = 1;
    for (const sign of [-1,1]) for (let k = 1; k < 15; k++) {
      const r = row + dr * k * sign, c = col + dc * k * sign;
      if (r < 0 || r >= 15 || c < 0 || c >= 15 || board[r * 15 + c] !== stone) break;
      count++;
    }
    return count >= 5;
  });
}
function commit(s, p, amount) { s.chips[p] -= amount; s.street[p] += amount; s.pot += amount; }
function pokerAction(s, a, who) {
  const p = s.turn, current = Math.max(...s.street);
  if (a.type === 'fold') { s.chips[1-p] += s.pot; s.pot = 0; end(s, 1-p, `${who}弃牌，${p === 0 ? '对手' : '你'}赢得底池。`); return; }
  if (a.type === 'raise') {
    s.lastRaise = Math.max(s.lastRaise, a.to - current); commit(s, p, a.to - s.street[p]); s.acted = [false,false]; note(s, `${who}加注至 ${a.to}`);
  } else if (a.type === 'call') { const due = current - s.street[p]; commit(s, p, due); note(s, `${who}跟注 ${due}`); }
  else note(s, `${who}过牌`);
  s.acted[p] = true; s.turn = 1 - p;
  if (s.acted.every(Boolean) && s.street[0] === s.street[1]) {
    if (s.stage === 3 || s.chips.some(n => n === 0)) { while (s.board.length < 5) s.board.push(s.deck.pop()); showdown(s); }
    else {
      s.stage++; s.street = [0,0]; s.acted = [false,false]; s.lastRaise = 20; s.turn = 1 - s.dealer;
      const count = s.stage === 1 ? 3 : 1; for (let i = 0; i < count; i++) s.board.push(s.deck.pop());
      note(s, `进入${['翻牌前','翻牌','转牌','河牌'][s.stage]}：${s.board.map(cardLabel).join(' ')}`);
    }
  }
}
export const HAND_NAMES = ['高牌','一对','两对','三条','顺子','同花','葫芦','四条','同花顺'];
export function compareRank(a, b) { for (let i = 0; i < Math.max(a.length,b.length); i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return Math.sign(d); } return 0; }
export function rank5(cards) {
  const ranks = cards.map(c => c.rank).sort((a,b) => b-a), unique = [...new Set(ranks)];
  const flush = cards.every(c => c.suit === cards[0].suit);
  const straight = unique.length === 5 ? ranks[0] - ranks[4] === 4 ? ranks[0] : unique.join(',') === '14,5,4,3,2' ? 5 : 0 : 0;
  const groups = unique.map(rank => [ranks.filter(n => n === rank).length, rank]).sort((a,b) => b[0]-a[0] || b[1]-a[1]);
  if (flush && straight) return [8,straight];
  if (groups[0][0] === 4) return [7,groups[0][1],groups[1][1]];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6,groups[0][1],groups[1][1]];
  if (flush) return [5,...ranks]; if (straight) return [4,straight];
  if (groups[0][0] === 3) return [3,groups[0][1],...groups.slice(1).map(g => g[1])];
  if (groups[0][0] === 2 && groups[1][0] === 2) return [2,Math.max(groups[0][1],groups[1][1]),Math.min(groups[0][1],groups[1][1]),groups[2][1]];
  if (groups[0][0] === 2) return [1,groups[0][1],...groups.slice(1).map(g => g[1])];
  return [0,...ranks];
}
export function bestHand(cards) {
  let best = [-1];
  for (let a=0;a<cards.length-4;a++) for(let b=a+1;b<cards.length-3;b++) for(let c=b+1;c<cards.length-2;c++) for(let d=c+1;d<cards.length-1;d++) for(let e=d+1;e<cards.length;e++) {
    const rank = rank5([cards[a],cards[b],cards[c],cards[d],cards[e]]); if(compareRank(rank,best)>0) best=rank;
  }
  return best;
}
function showdown(s) {
  const ranks = s.hands.map(hand => bestHand([...hand,...s.board])); const cmp = compareRank(...ranks); const pot = s.pot;
  if (cmp === 0) { s.chips[0] += pot/2; s.chips[1] += pot/2; }
  else s.chips[cmp > 0 ? 0 : 1] += pot;
  s.pot = 0; s.handRanks = ranks;
  end(s, cmp === 0 ? null : cmp > 0 ? 0 : 1, `你：${HAND_NAMES[ranks[0][0]]} / 对手：${HAND_NAMES[ranks[1][0]]} · ${cmp === 0 ? '平分底池' : cmp > 0 ? '你赢了' : '对手获胜'}（底池 ${pot}）`);
}
function drawUno(s, player, count, rng) {
  let drawn = 0;
  for(let i=0;i<count;i++) {
    if(s.deck.length === 0 && s.discard.length > 1) { const top=s.discard.pop(); s.deck=shuffle(s.discard,rng); s.discard=[top]; }
    if(s.deck.length === 0) break;
    s.hands[player].push(s.deck.pop()); drawn++;
  }
  return drawn;
}
function unoAction(s, a, who, rng) {
  const p = s.turn;
  if(a.type === 'draw') {
    if(drawUno(s,p,1,rng)) { s.drawn=s.hands[p].length-1; note(s,`${who}摸了 1 张牌。`); }
    else { s.turn=1-p; s.drawn=null; s.passes++; note(s,`${who}无牌可摸，跳过。`); }
  } else if(a.type === 'pass') { s.drawn=null; s.turn=1-p; s.passes++; note(s,`${who}跳过。`); }
  else {
    const [card]=s.hands[p].splice(a.index,1); s.discard.push(card); s.color=card.color==='wild'?a.color:card.color; s.drawn=null; s.passes=0; s.turn=1-p;
    note(s,`${who}出 ${unoLabel(card)}${card.color==='wild'?` → ${COLOR_NAMES[s.color]}`:''}`);
    if(card.value === '+2' || card.value === '+4') { const n=drawUno(s,1-p,card.value==='+2'?2:4,rng); note(s,`${p===0?'对手':'你'}摸 ${n} 张并跳过。`); s.turn=p; }
    if(card.value==='skip' || card.value==='reverse') s.turn=p;
    if(s.hands[p].length===1) note(s,`${who}：UNO！`);
    if(s.hands[p].length===0) end(s,p,`${who}出光手牌，获胜！`);
  }
  if(s.status==='playing' && s.passes>=4) end(s,null,'双方连续无法出牌，本局平局。');
}
export function unoLabel(c) { return `${COLOR_NAMES[c.color] ?? ''}${({ skip:'跳过', reverse:'反转', wild:'换色' })[c.value] ?? c.value}`; }
export function actionLabel(a,s) {
  return ({ place:`${Math.floor(a.at/15)+1} 行 ${a.at%15+1} 列`, hit:'要牌', stand:'停牌', double:'加倍', fold:'弃牌', check:'过牌', call:s.kind==='poker'?`跟注 ${Math.max(...s.street)-s.street[s.turn]}`:'跟注', raise:`加注至 ${a.to}`, draw:'摸一张', pass:'跳过', play:a.type==='play'&&s.kind==='uno'?`${unoLabel(s.hands[s.turn][a.index])}${a.color?` → ${COLOR_NAMES[a.color]}`:''}`:'出牌' })[a.type];
}
export function observation(s, player = 1) {
  const out={ kind:s.kind, turn:s.turn, you:player, log:s.log.slice(-8) };
  if(s.kind==='gomoku') return {...out,board:s.board,last:s.last};
  if(s.kind==='uno') return {...out,hand:s.hands[player],opponentCount:s.hands[1-player].length,top:s.discard.at(-1),color:s.color,drawn:s.drawn,deckCount:s.deck.length};
  if(s.kind==='poker') return {...out,hand:s.hands[player],board:s.board,chips:s.chips,pot:s.pot,street:s.street,stage:s.stage,dealer:s.dealer};
  return {...out,hand:s.hands[player],opponent:s.hands[1-player],bet:s.bet};
}
function gomokuScore(board, at, stone) {
  const copy=[...board]; copy[at]=stone; if(five(copy,at)) return 1000000;
  const r=Math.floor(at/15),c=at%15; let score=0;
  for(const [dr,dc] of [[1,0],[0,1],[1,1],[1,-1]]) {
    let count=1,open=0;
    for(const sign of [-1,1]) for(let k=1;k<=5;k++) {
      const nr=r+dr*k*sign,nc=c+dc*k*sign; if(nr<0||nr>=15||nc<0||nc>=15) break;
      const cell=board[nr*15+nc]; if(cell===stone) count++; else { if(cell===0) open++; break; }
    }
    score += ([0,1,10,100,10000,1000000][Math.min(count,5)]) * (open===2?5:open===1?1:0);
  }
  return score;
}
export function chooseLocal(s, rng = Math.random) {
  const actions=legalActions(s); if(!actions.length) return null;
  if(s.kind==='gomoku') {
    if(s.board.every(n=>n===0)) return {type:'place',at:112};
    let best=null,score=-Infinity;
    for(const a of actions) {
      const attack=gomokuScore(s.board,a.at,s.turn+1),defend=gomokuScore(s.board,a.at,2-s.turn);
      const n=attack>=1000000?1e9:defend>=1000000?1e8:attack+defend*1.15+14-Math.abs(Math.floor(a.at/15)-7)-Math.abs(a.at%15-7);
      if(n>score) {score=n;best=a;}
    }
    return best;
  }
  if(s.kind==='blackjack') return actions[0];
  if(s.kind==='uno') {
    const plays=actions.filter(a=>a.type==='play');
    if(!plays.length) return actions.at(-1);
    const counts=Object.fromEntries(COLORS.map(color=>[color,s.hands[s.turn].filter(c=>c.color===color).length]));
    return plays.sort((a,b)=> {
      const ca=s.hands[s.turn][a.index],cb=s.hands[s.turn][b.index];
      return (counts[b.color ?? cb.color] ?? 0) - (counts[a.color ?? ca.color] ?? 0) || (ca.color==='wild')-(cb.color==='wild');
    })[0];
  }
  const hand=s.hands[s.turn], ranks=s.board.length>=3?bestHand([...hand,...s.board]):[hand[0].rank===hand[1].rank?1:0,Math.max(...hand.map(c=>c.rank))];
  const due=Math.max(...s.street)-s.street[s.turn]; const strength=ranks[0];
  const raises=actions.filter(a=>a.type==='raise');
  if(raises.length && ((strength>=2 && rng()<0.6) || (strength===1 && rng()<0.25) || rng()<0.08)) return raises[0];
  if(due>s.pot*0.5 && strength===0 && rng()<0.65) return actions[0];
  return actions.find(a=>a.type==='check'||a.type==='call');
}
export function validateGame(s) {
  if(!s || s.version!==VERSION || !Object.hasOwn(GAMES, s.kind) || !['playing','done'].includes(s.status) || ![0,1].includes(s.turn) || !Array.isArray(s.log) || s.log.length>40 || !s.log.every(x=>typeof x==='string' && x.length<500)) throw new Error('存档无效');
  if(s.lastAction!==undefined&&(!s.lastAction||![0,1].includes(s.lastAction.player)||typeof s.lastAction.label!=='string'||s.lastAction.label.length>120))throw new Error('动作记录无效');
  if(s.kind==='gomoku') {
    if(!Array.isArray(s.board)||s.board.length!==225||!s.board.every(x=>[0,1,2].includes(x))) throw new Error('棋盘无效');
  } else {
    if(!Array.isArray(s.hands)||s.hands.length!==2||!s.hands.every(h=>Array.isArray(h)&&h.length<=108)||!Array.isArray(s.deck)||s.deck.length>108) throw new Error('牌局无效');
    const cards=[...s.hands.flat(),...s.deck,...(s.kind==='uno'?s.discard??[]:s.board??[])];
    if(s.kind==='uno') {
      if(cards.length!==108||!Array.isArray(s.discard)||!s.discard.length||!COLORS.includes(s.color)||!(s.drawn===null||Number.isInteger(s.drawn)&&s.drawn>=0&&s.drawn<s.hands[s.turn].length)||!cards.every(c=>c&&Number.isInteger(c.id)&&c.id>=0&&c.id<108&&[...COLORS,'wild'].includes(c.color)&&[0,1,2,3,4,5,6,7,8,9,'skip','reverse','+2','wild','+4'].includes(c.value))) throw new Error('UNO 牌局无效');
      if(new Set(cards.map(c=>c.id)).size!==108) throw new Error('UNO 牌重复');
    } else {
      if(cards.length!==52||!cards.every(c=>c&&['♠','♥','♦','♣'].includes(c.suit)&&Number.isInteger(c.rank)&&c.rank>=2&&c.rank<=14)||new Set(cards.map(cardLabel)).size!==52) throw new Error('扑克牌无效');
      if(s.kind==='blackjack' && (!Number.isFinite(s.bet)||s.bet<1||s.bet>1000)) throw new Error('下注无效');
      if(s.kind==='poker' && (!Array.isArray(s.board)||s.board.length>5||![0,1,2,3].includes(s.stage)||![0,1].includes(s.dealer)||!s.hands.every(h=>h.length===2)||!Array.isArray(s.chips)||s.chips.length!==2||!s.chips.every(x=>Number.isInteger(x)&&x>=0)||!Array.isArray(s.street)||s.street.length!==2||!s.street.every(x=>Number.isInteger(x)&&x>=0)||!Number.isInteger(s.pot)||s.pot<0||s.chips[0]+s.chips[1]+s.pot!==2000||!Array.isArray(s.acted)||s.acted.length!==2||!s.acted.every(x=>typeof x==='boolean')||!Number.isInteger(s.lastRaise)||s.lastRaise<20)) throw new Error('筹码状态无效');
    }
  }
  return s;
}
