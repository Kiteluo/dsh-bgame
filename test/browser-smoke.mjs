import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { runEdge } from './cdp-browser.mjs';
import { fileURLToPath } from 'node:url';
import { apply } from '../index.mjs';
import { chooseLocal, createGame } from '../games.mjs';

const mobile=process.argv.includes('--mobile');
let mockMode='ok', observed=[];
const effects=[],routes=[],api=new Map(); let transform=x=>x;
const ctx={
  effect:fn=>effects.push(fn()), get:()=>({currentSelection:()=>({provider:'test',model:'local-test'})}),
  webServer:{tapIndex:fn=>{transform=fn;return()=>{};},register:route=>{routes.push(route);return()=>{};}},
  connection:{requestRejection:()=>undefined,fetch:{register:route=>{api.set(route.path,route);return async()=>api.delete(route.path);}}},
  llm:{
    listProviders:()=>[{id:'test',name:'Test'}],listModels:async()=>[{provider:'test',id:'local-test',name:'测试模型'}],
    resolveModelInfo:async()=>({reasoning:{efforts:[{id:"low"},{id:"off"},{id:"high"}]}}),prepareCall:async config=>({config,stream:async function*(request){
      const responseMode=mockMode;observed.push({effort:request.reasoningEffort,maxTokens:request.maxTokens});
      await new Promise(resolve=>setTimeout(resolve,650));
      if(responseMode==='fail'){yield {type:'finish',reason:{kind:'max-tokens'}};return;}
      const input=JSON.parse(request.messages[0].content[0].text);
      const choice=input.choices.find(x=>['check','call','stand','place','play'].includes(x.action?.type))?.choice??0;
      yield {type:'text-delta',text:JSON.stringify({choice,say:'测试模型已完成动作。'})};yield {type:'finish',reason:{kind:'stop'}};
    }})
  }
};
apply(ctx);
const browserTest = String.raw`
const output=document.getElementById('result'); const results=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(ok,name)=>{if(!ok)throw new Error(name);results.push(name);};
const until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await delay(100);}throw new Error('等待页面超时');};
await until(()=>document.getElementById('dsh-bgame-host')?.shadowRoot?.querySelector('.launcher'));
const root=document.getElementById('dsh-bgame-host').shadowRoot;
root.querySelector('.launcher').click();
check(root.querySelectorAll('[data-game]').length===4,'四款游戏入口');
const difficulty=root.querySelector('[data-difficulty]');difficulty.value='hard';difficulty.dispatchEvent(new Event('change',{bubbles:true}));
check(JSON.parse(localStorage.getItem('dsh.bgame.v1')).options.difficulty==='hard','电脑难度自动保存');
check(root.querySelector('.panel').getBoundingClientRect().right<=innerWidth,'面板适配浏览器宽度');
await until(()=>JSON.parse(localStorage.getItem('dsh.bgame.v1')??'null')?.selection);
root.querySelector('[data-game="gomoku"]').click();
check(root.querySelectorAll('[data-at]').length===225,'五子棋棋盘');
root.querySelector('[data-at="112"]').click();
await until(()=>root.querySelectorAll('.stone').length===2);
check(root.querySelectorAll('.stone.white').length===1,'电脑五子棋落子');
check(root.querySelector('[data-moves]').textContent==='2'&&root.querySelector('[data-last-move]').textContent.includes('对手'),'回合和上一手同步更新');
root.querySelector('[data-pause]').click();
check(root.querySelector('.status').textContent.includes('已暂停'),'暂停对局');
root.querySelector('[data-close]').click();
check(root.querySelector('.panel').classList.contains('hidden'),'收起返回工作');
root.querySelector('.launcher').click();
check(root.querySelector('.status').textContent.includes('已暂停'),'恢复时保留暂停状态');
root.querySelector('[data-hall]').click();
check(root.querySelector('[data-game="gomoku"] .start').textContent.includes('继续'),'大厅恢复存档入口');
root.querySelector('[data-game="gomoku"]').click();
check(root.querySelectorAll('.stone').length===2,'五子棋存档恢复');
root.querySelector('[data-hall]').click();
root.querySelector('[data-game="poker"]').click();
check(root.querySelector('[data-action="1"]').textContent.includes('跟注'),'德扑盲注操作');
check(root.querySelector('[data-pot]').textContent==='30'&&root.querySelector('[data-bet]').textContent==='20'&&root.querySelector('[data-to-call]').textContent==='10','德扑底池和跟注金额');
root.querySelector('[data-action="1"]').click();
await until(()=>JSON.parse(localStorage.getItem('dsh.bgame.v1')).saved.poker.stage===1);
check(root.querySelectorAll('.playing-card').length===7,'德扑翻牌与隐藏手牌');
root.querySelector('[data-hall]').click();
root.querySelector('[data-game="blackjack"]').click();
check(root.querySelectorAll('.playing-card').length===4,'21 点发牌');
check(root.querySelector('[data-difficulty]').disabled&&root.querySelector('.settings-hint').textContent.includes('17 点'),'21 点明确显示固定庄家规则');
if(root.querySelector('[data-action="1"]')){root.querySelector('[data-action="1"]').click();await until(()=>JSON.parse(localStorage.getItem('dsh.bgame.v1')).saved.blackjack.status==='done');}
check(root.querySelector('.status').textContent.includes('点'),'21 点结算');
root.querySelector('[data-hall]').click();
root.querySelector('[data-game="uno"]').click();
check(root.querySelectorAll('[data-card]').length===7,'UNO 初始手牌');
const savedUno=JSON.parse(localStorage.getItem('dsh.bgame.v1')).saved.uno;
const draw=root.querySelectorAll('[data-action]');draw[draw.length-1].click();
check(root.querySelectorAll('[data-card]').length===8,'UNO 摸一张牌');
root.querySelector('[data-hall]').click();
const mode=root.querySelector('[data-mode]');mode.value='model';mode.dispatchEvent(new Event('change',{bubbles:true}));
check(root.querySelector('[data-model]')!==null,'模型选择器');
root.querySelector('[data-game="gomoku"]').click();
root.querySelector('[data-at="113"]').click();
await until(()=>root.querySelector('.say')?.textContent.includes('测试模型已完成'));
check(root.querySelectorAll('.stone').length===4,'模型模式完成合法落子');
root.querySelector('[data-at="114"]').click();
await until(()=>root.querySelector('.status').textContent.includes('模型正在思考'));
root.querySelector('[data-close]').click();
await delay(900);
root.querySelector('.launcher').click();
check(root.querySelectorAll('.stone').length===5,'取消模型思考后不落入旧动作');
check(root.querySelector('.status').textContent.includes('已暂停'),'模型取消后保留回合');
root.querySelector('[data-pause]').click();
await until(()=>root.querySelectorAll('.stone').length===6);
check(root.querySelectorAll('.stone').length===6,'恢复模型对局后继续正确回合');
root.querySelector('[data-restart]').click();
check(root.querySelector('.confirm')!==null,'重新开局确认保留存档');
root.querySelector('[data-keep]').click();
check(root.querySelectorAll('.stone').length===6,'取消重新开局保留棋子');
const change=(selector,value)=>{const el=root.querySelector(selector);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));};
const control=mode=>fetch('/__test/model',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode})});
check(root.querySelector('[data-thinking]')&&root.querySelector('[data-failure]'),'模型出招和失败处理选项');
change('[data-thinking]','thoughtful');
check(JSON.parse(localStorage.getItem('dsh.bgame.v1')).options.thinking==='thoughtful','认真思考选项自动保存');
const nextCell=()=>[...root.querySelectorAll('[data-at]')].find(button=>!button.disabled);
nextCell().click();await until(()=>root.querySelector('[data-wait]')?.textContent.includes('90 秒'));
check(root.querySelector('[data-wait]').textContent.includes('已等待'),'实时模型等待时间');
await until(()=>root.querySelector('[data-moves]').textContent==='8');
const config=await (await fetch('/__test/model')).json();
check(config.observed.at(-1).effort==='high'&&config.observed.at(-1).maxTokens===16384,'认真思考实际请求较高档位');
await control('fail');const beforeFailure=Number(root.querySelector('[data-moves]').textContent);
nextCell().click();await until(()=>root.querySelector('[data-retry]'));
check(Number(root.querySelector('[data-moves]').textContent)===beforeFailure+1,'模型失败不会自动落子');
check(root.querySelector('[data-takeover]')&&root.querySelector('.notice').textContent.includes('输出额度'),'失败后显示重试和代打');
root.querySelector('[data-retry]').click();await until(()=>root.querySelector('[data-retry]'));
check(Number(root.querySelector('[data-moves]').textContent)===beforeFailure+1,'失败重试仍保留相同回合');
await control('ok');root.querySelector('[data-retry]').click();await until(()=>Number(root.querySelector('[data-moves]').textContent)===beforeFailure+2);
check(!root.querySelector('[data-retry]'),'重试成功后继续对局');
await control('fail');nextCell().click();await until(()=>root.querySelector('[data-takeover]'));
const beforeTakeover=Number(root.querySelector('[data-moves]').textContent);root.querySelector('[data-takeover]').click();
check(Number(root.querySelector('[data-moves]').textContent)===beforeTakeover+1&&root.querySelector('[data-mode]').value==='model','电脑只代打本步，保留模型对手');
change('[data-failure]','auto');const beforeAuto=Number(root.querySelector('[data-moves]').textContent);
nextCell().click();await until(()=>Number(root.querySelector('[data-moves]').textContent)===beforeAuto+2);
check(!root.querySelector('[data-retry]')&&root.querySelector('.model-result').textContent.includes('电脑代打'),'自动接手按选定难度完成回合');
await control('ok');change('[data-failure]','ask');
nextCell().click();await until(()=>root.querySelector('[data-wait]'));
change('[data-thinking]','fast');
await until(()=>!root.querySelector('[data-wait]')&&root.querySelector('[data-turn]').textContent.includes('你的回合'));
check(Number(root.querySelector('[data-moves]').textContent)===beforeAuto+4,'切换思考方式取消旧请求且只落子一次');
check((await (await fetch('/__test/model')).json()).observed.at(-1).effort==='off','快速出招恢复关闭思考');
root.querySelector('[data-hall]').click();change('[data-mode]','local');
check(root.querySelector('[data-difficulty]').value==='hard','切换对手后保留电脑难度');
check(root.querySelector('.panel').scrollWidth<=root.querySelector('.panel').clientWidth,'新增选项不造成横向溢出');
output.textContent=JSON.stringify({pass:true,results});
output.setAttribute('data-pass','true');
`;
let server;
try {
  server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://127.0.0.1');
      if(url.pathname==='/__test/model'){if(req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;mockMode=JSON.parse(body).mode;}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({mode:mockMode,observed}));return;}
      if(url.pathname==='/') {
        const page=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>Math.random=()=>0.5;</script><title>DSH 小游戏集成验证</title><style>body{background:#080f1b;color:#eee;font-family:Segoe UI,sans-serif;padding:28px}#result{position:absolute;left:1040px;top:20px;width:310px;white-space:pre-wrap;font-size:12px}</style></head><body><h2>DSH 插件独立测试页</h2><pre id="result">测试进行中</pre><script type="module">try{${browserTest}}catch(error){document.getElementById('result').textContent=JSON.stringify({pass:false,error:error.message});document.getElementById('result').setAttribute('data-pass','false');}</script><script type="module" src="./bgame/client.mjs"></script></body></html>`;
        res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(transform(page));return;
      }
      const route=routes.find(r=>url.pathname.startsWith(r.path));if(route){await route.handler(req,res);return;}
      const handler=api.get(url.pathname);if(handler){let body='';for await(const chunk of req)body+=chunk;const request=new Request(`http://127.0.0.1:${server.address().port}${req.url}`,{method:req.method,headers:req.headers,...(req.method==='POST'?{body}: {})});const response=await handler.fetch(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;}
      res.writeHead(404);res.end();
    }catch(error){res.writeHead(500);res.end(error.message);}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const outputDir=fileURLToPath(new URL('../artifacts/',import.meta.url));await mkdir(outputDir,{recursive:true});
  await runEdge(`http://127.0.0.1:${server.address().port}/`,{mobile,outputDir});
}finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  for(const dispose of effects.reverse())await dispose();
}
