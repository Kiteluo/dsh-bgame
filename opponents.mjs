import {legalActions,chooseLocal,five,deck52,cardLabel,bestHand,compareRank,COLORS} from './games.mjs';

export const DIFFICULTIES = {easy:'简单',normal:'普通',hard:'困难'};
export const MODEL_PROFILES = {
  fast:{name:'快速出招',maxTokens:8192,timeoutMs:60000,efforts:['off','minimal','low','medium','high']},
  thoughtful:{name:'认真思考',maxTokens:16384,timeoutMs:90000,efforts:['medium','high','low','minimal','off']},
};
export function opponentOptions(value = {}) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('对战设置无效');
  const result={thinking:value.thinking??'fast',difficulty:value.difficulty??'normal',failure:value.failure??'ask'};
  if(!Object.hasOwn(MODEL_PROFILES,result.thinking)||!Object.hasOwn(DIFFICULTIES,result.difficulty)||!['ask','auto'].includes(result.failure))throw new Error('对战设置无效');
  return result;
}
export function matchInfo(state) {
  const last=state.lastAction;
  const lastMove=last&&[0,1].includes(last.player)&&typeof last.label==='string'
    ? `${last.player===0?'你':state.kind==='blackjack'?'庄家':'对手'}：${last.label}`
    : state.moves ? [...state.log].reverse().find(line=>/^(你|对手)(落子|摸到|加注|跟注|过牌|弃牌|出 |摸了|跳过)/.test(line))??'暂无动作记录' : '尚未出手';
  const info={turn:state.status==='done'?'本局结束':state.turn===0?'你的回合':state.kind==='blackjack'?'庄家回合':'对手回合',moves:Number.isInteger(state.moves)?state.moves:0,lastMove};
  if(state.kind==='poker') info.poker={pot:state.pot,currentBet:Math.max(...state.street),toCall:state.status==='done'?0:Math.max(...state.street)-state.street[0],mine:state.street[0],opponent:state.street[1]};
  return info;
}
const pick=(items,rng)=>items[Math.min(items.length-1,Math.max(0,Math.floor(rng()*items.length)))];
function nearby(board,actions) {
  if(board.every(cell=>cell===0))return actions.filter(a=>Math.abs(Math.floor(a.at/15)-7)<=1&&Math.abs(a.at%15-7)<=1);
  return actions.filter(a=>{const r=Math.floor(a.at/15),c=a.at%15;for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++){const nr=r+dr,nc=c+dc;if(nr>=0&&nr<15&&nc>=0&&nc<15&&board[nr*15+nc])return true;}return false;});
}
function potential(board,at,stone) {
  const r=Math.floor(at/15),c=at%15;let score=0;
  for(const [dr,dc] of [[1,0],[0,1],[1,1],[1,-1]])for(let offset=-4;offset<=0;offset++){
    let count=0,valid=true;
    for(let k=0;k<5;k++){
      const nr=r+(offset+k)*dr,nc=c+(offset+k)*dc;
      if(nr<0||nr>=15||nc<0||nc>=15){valid=false;break;}
      const cell=nr*15+nc===at?stone:board[nr*15+nc];
      if(cell&&cell!==stone){valid=false;break;}if(cell===stone)count++;
    }
    if(valid)score+=[0,1,12,200,6000,1000000][count];
  }
  return score;
}
function winsAt(board,at,stone) {const before=board[at];board[at]=stone;const win=five(board,at);board[at]=before;return win;}
function hardGomoku(state,actions) {
  const board=[...state.board],own=state.turn+1,other=3-own;
  if(board.every(cell=>cell===0))return actions.find(a=>a.at===112);
  const candidates=nearby(board,actions);
  const win=candidates.find(a=>winsAt(board,a.at,own));if(win)return win;
  const block=candidates.find(a=>winsAt(board,a.at,other));if(block)return block;
  const scored=candidates.map(a=>({action:a,score:potential(board,a.at,own)+potential(board,a.at,other)*1.05+14-Math.abs(Math.floor(a.at/15)-7)-Math.abs(a.at%15-7)})).sort((a,b)=>b.score-a.score);
  let best=scored[0].action,bestScore=-Infinity;
  for(const item of scored.slice(0,12)){
    board[item.action.at]=own;let replies=0,threats=0;
    for(const a of candidates)if(!board[a.at]){
      if(winsAt(board,a.at,own))threats++;
      replies=Math.max(replies,potential(board,a.at,other)+potential(board,a.at,own)*.9);
    }
    const score=item.score-replies*.75+(threats>=2?10000000:threats*5000);
    board[item.action.at]=0;
    if(score>bestScore){bestScore=score;best=item.action;}
  }
  return best;
}
/** Sample only unknown cards from the standard deck; never inspect the actual opposing hand or draw pile. */
export function pokerEquity(state,rng=Math.random,samples=64) {
  const hand=state.hands[state.turn],board=state.board;
  const known=new Set([...hand,...board].map(cardLabel)),unseen=deck52().filter(card=>!known.has(cardLabel(card)));
  let wins=0;const count=2+5-board.length;
  for(let n=0;n<samples;n++){
    const pool=[...unseen];
    for(let i=0;i<count;i++){const j=i+Math.min(pool.length-i-1,Math.max(0,Math.floor(rng()*(pool.length-i))));[pool[i],pool[j]]=[pool[j],pool[i]];}
    const publicCards=[...board,...pool.slice(2,count)];const cmp=compareRank(bestHand([...hand,...publicCards]),bestHand([...pool.slice(0,2),...publicCards]));
    wins+=cmp>0?1:cmp===0?.5:0;
  }
  return wins/samples;
}
function hardPoker(state,actions,rng) {
  const equity=pokerEquity(state,rng),due=Math.max(...state.street)-state.street[state.turn],odds=due/(state.pot+due||1);
  if(due>0&&equity<odds+.025)return actions.find(a=>a.type==='fold');
  const raises=actions.filter(a=>a.type==='raise');
  if(raises.length&&equity>.68&&rng()<.8)return raises[Math.min(raises.length-1,equity>.88?1:0)];
  return actions.find(a=>a.type==='check'||a.type==='call');
}
function hardUno(state,actions) {
  const hand=state.hands[state.turn],plays=actions.filter(a=>a.type==='play');if(!plays.length)return actions.at(-1);
  const danger=state.hands[1-state.turn].length<=2;
  const score=a=>{const card=hand[a.index],color=a.color??card.color,rest=hand.filter((_,index)=>index!==a.index);return rest.filter(c=>c.color===color).length*8+(card.color==='wild'?-12:4)+(['skip','reverse','+2','+4'].includes(card.value)?danger?50:8:0)+(typeof card.value==='number'?card.value/10:2)+(rest.length===0?1000:0);};
  return plays.sort((a,b)=>score(b)-score(a))[0];
}
export function chooseOpponent(state,difficulty='normal',rng=Math.random) {
  if(!Object.hasOwn(DIFFICULTIES,difficulty))throw new Error('未知电脑难度');
  const actions=legalActions(state);if(!actions.length)return null;
  if(state.kind==='blackjack')return chooseLocal(state,rng);
  if(difficulty==='normal')return chooseLocal(state,rng);
  if(difficulty==='easy')return pick(state.kind==='gomoku'?nearby(state.board,actions):state.kind==='poker'?actions.filter(a=>a.type!=='raise'||a.to===actions.find(x=>x.type==='raise')?.to):actions,rng);
  return state.kind==='gomoku'?hardGomoku(state,actions):state.kind==='poker'?hardPoker(state,actions,rng):hardUno(state,actions);
}
