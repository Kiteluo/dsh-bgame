import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,applyAction,legalActions,validateGame,deck52,COLORS} from '../games.mjs';
import {chooseOpponent,pokerEquity,opponentOptions,MODEL_PROFILES,matchInfo} from '../opponents.mjs';
import {modelMove,apply} from '../index.mjs';
const rng=(seed=1)=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const gomoku=()=>applyAction(createGame('gomoku'),{type:'place',at:112});
const mock=(info,capture)=>({resolveModelInfo:async()=>info,prepareCall:async config=>{capture?.(config);return {config,stream:async function*(){yield {type:'text-delta',text:'{"choice":0,"say":"落子"}'};yield {type:'finish',reason:{kind:'stop'}};}};}});

test('认真思考使用支持的较高档位、独立预算；非推理模型不发送未知档位',async()=>{
 let config;
 const result=await modelMove(mock({reasoning:{efforts:[{id:'off'},{id:'low'},{id:'high'}]}},c=>config=c),gomoku(),{provider:'test',model:'mock'},undefined,{thinking:'thoughtful'});
 assert.equal(config.reasoningEffort,'high');assert.equal(config.maxTokens,16384);assert.equal(result.meta.reasoningEffort,'high');assert.equal(result.meta.thinking,'thoughtful');
 await modelMove(mock({},c=>config=c),gomoku(),{provider:'test',model:'plain'},undefined,{thinking:'thoughtful'});
 assert.equal(Object.hasOwn(config,'reasoningEffort'),false);
 assert.equal(MODEL_PROFILES.fast.timeoutMs,60000);assert.equal(MODEL_PROFILES.thoughtful.timeoutMs,90000);
});

test('对战设置拒绝未知值，旧存档可使用默认设置',()=>{
 assert.deepEqual(opponentOptions(),{thinking:'fast',difficulty:'normal',failure:'ask'});
 for(const value of [null,[],{thinking:'unlimited'},{failure:'skip'},{difficulty:'cheat'}])assert.throws(()=>opponentOptions(value));
});

test('三档电脑对所有游戏只选合法动作，不改动牌局',()=>{
 for(const difficulty of ['easy','normal','hard'])for(const kind of ['gomoku','poker','blackjack','uno']){
  const random=rng(77);let state=createGame(kind,{},random);
  for(let step=0;step<6&&state.status==='playing';step++){
   const before=structuredClone(state),action=chooseOpponent(state,difficulty,random);
   assert(legalActions(state).some(legal=>JSON.stringify(legal)===JSON.stringify(action)),kind+' '+difficulty);
   assert.deepEqual(state,before);state=applyAction(state,action,random);validateGame(state);
  }
 }
});

test('困难五子棋优先获胜、阻挡并构造双重威胁；简单不会固定走相同策略',()=>{
 let state=createGame('gomoku');state.turn=1;[30,31,32,33].forEach(at=>state.board[at]=1);
 assert.deepEqual(chooseOpponent(state,'hard'),{type:'place',at:34});
 [90,91,92,93].forEach(at=>state.board[at]=2);
 assert.deepEqual(chooseOpponent(state,'hard'),{type:'place',at:94});
 state=createGame('gomoku');state.turn=1;[66,81,111,94,95,97].forEach(at=>state.board[at]=2);
 assert.deepEqual(chooseOpponent(state,'hard'),{type:'place',at:96});
 assert.notDeepEqual(chooseOpponent(state,'easy',()=>.999),{type:'place',at:96});
});

test('困难德扑和 UNO 的选择不依赖真实暗牌或牌堆',()=>{
 for(const kind of ['poker','uno']){
  const first=createGame(kind,{},rng(42));first.turn=1;const second=structuredClone(first);
  const hidden=second.hands[0].splice(0,2);second.hands[0].unshift(...second.deck.splice(0,2));second.deck.push(...hidden);second.deck.reverse();
  validateGame(first);validateGame(second);
  assert.deepEqual(chooseOpponent(first,'hard',rng(14)),chooseOpponent(second,'hard',rng(14)));
  if(kind==='poker')assert.equal(pokerEquity(first,rng(13)),pokerEquity(second,rng(13)));
 }
});

test('UNO 困难档在对方只剩一张时优先罚牌；21 点所有档位遵守软 17 停牌',()=>{
 const uno=createGame('uno',{},rng(5));const all=[...uno.hands.flat(),...uno.deck,...uno.discard];
 const take=(color,value)=>all.splice(all.findIndex(c=>c.color===color&&c.value===value),1)[0];
 uno.hands=[[take('red',1),take('red','+2'),take('blue',5)],[take('green',2)]];uno.discard=[take('red',3)];uno.deck=all;uno.color='red';uno.drawn=null;
 validateGame(uno);assert.deepEqual(chooseOpponent(uno,'hard'),{type:'play',index:1});
 const blackjack=createGame('blackjack');blackjack.turn=1;blackjack.hands[1]=[{suit:'♠',rank:14},{suit:'♥',rank:6}];
 for(const difficulty of ['easy','normal','hard'])assert.deepEqual(chooseOpponent(blackjack,difficulty),{type:'stand'});
});

test('上一手记录跨下注阶段仍保留动作金额，对局信息和旧存档兼容',()=>{
 let state=createGame('poker',{},rng(12));
 let info=matchInfo(state);assert.equal(info.poker.currentBet,20);assert.equal(info.poker.toCall,10);assert.equal(info.poker.pot,30);assert.equal(info.lastMove,'尚未出手');
 state=applyAction(state,{type:'raise',to:40});info=matchInfo(state);assert.equal(info.poker.toCall,0);assert.equal(info.lastMove,'你：加注至 40');
 state=applyAction(state,{type:'call'});info=matchInfo(state);assert.equal(state.stage,1);assert.equal(info.moves,2);assert.equal(info.poker.currentBet,0);assert.equal(info.lastMove,'对手：跟注 20');
 const old=structuredClone(state);delete old.lastAction;assert.doesNotThrow(()=>validateGame(old));assert.match(matchInfo(old).lastMove,/对手跟注 20/);
 const done=applyAction(createGame('poker'),{type:'fold'});assert.equal(matchInfo(done).turn,'本局结束');assert.equal(matchInfo(done).poker.toCall,0);
});

function host(){
 const routes=[],effects=[];let calls=0;
 const ctx={effect:fn=>effects.push(fn()),get:()=>undefined,webServer:{register:()=>()=>{}},connection:{fetch:{register:route=>{routes.push(route);return()=>{};}}},llm:{listProviders:()=>[{id:'test'}],listModels:async()=>[{provider:'test',id:'mock',name:'Mock'}],resolveModelInfo:async()=>({reasoning:{efforts:[{id:'off'},{id:'high'}]}}),prepareCall:async config=>{calls++;return {config,stream:async function*(){yield {type:'finish',reason:{kind:'max-tokens'}};}};}}};
 apply(ctx);return {route:routes.find(r=>r.path==='/api/bgame/move'),effects,get calls(){return calls;}};
}

test('模型失败由玩家选择时不落子，自动接手按选定电脑难度行动',async()=>{
 const fixture=host(),state=gomoku(),before=structuredClone(state);
 try{
  for(const failure of ['ask','auto']){
   const response=await fixture.route.fetch(new Request('http://localhost/api/bgame/move',{method:'POST',body:JSON.stringify({state,selection:{provider:'test',model:'mock'},options:{thinking:'thoughtful',difficulty:'hard',failure}})}));
   const result=await response.json();assert.equal(result.reason,'MAX_TOKENS');assert.deepEqual(state,before);
   if(failure==='ask'){assert.equal(result.retryable,true);assert.equal(result.action,undefined);}
   else {assert.deepEqual(result.action,chooseOpponent(state,'hard'));assert.equal(result.meta.difficulty,'hard');}
  }
 }finally{for(const dispose of fixture.effects.reverse())await dispose();}
});

test('未知对战设置不调用模型；已取消的请求不返回电脑动作',async()=>{
 const fixture=host();const state=gomoku();
 try{
  const invalid=await fixture.route.fetch(new Request('http://localhost/api/bgame/move',{method:'POST',body:JSON.stringify({state,selection:{provider:'test',model:'mock'},options:{thinking:'unknown'}})}));
  assert.equal(invalid.status,400);assert.equal(fixture.calls,0);
  const cancel=new AbortController();cancel.abort();
  const cancelled=await fixture.route.fetch(new Request('http://localhost/api/bgame/move',{method:'POST',signal:cancel.signal,body:JSON.stringify({state,selection:{provider:'test',model:'mock'},options:{failure:'auto'}})}));
  assert.equal(cancelled.status,499);assert.equal((await cancelled.json()).action,undefined);
 }finally{for(const dispose of fixture.effects.reverse())await dispose();}
});
