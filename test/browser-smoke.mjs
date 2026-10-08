import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { runEdge } from './cdp-browser.mjs';
import { fileURLToPath } from 'node:url';
import { apply } from '../index.mjs';
import { chooseLocal, createGame } from '../games.mjs';

const mobile=process.argv.includes('--mobile');
const effects=[],routes=[],api=new Map(); let transform=x=>x;
const ctx={
  effect:fn=>effects.push(fn()), get:()=>({currentSelection:()=>({provider:'test',model:'local-test'})}),
  webServer:{tapIndex:fn=>{transform=fn;return()=>{};},register:route=>{routes.push(route);return()=>{};}},
  connection:{requestRejection:()=>undefined,fetch:{register:route=>{api.set(route.path,route);return async()=>api.delete(route.path);}}},
  llm:{
    listProviders:()=>[{id:'test',name:'Test'}],listModels:async()=>[{provider:'test',id:'local-test',name:'测试模型'}],
    resolveModelInfo:async()=>({reasoning:{efforts:[{id:"low"},{id:"off"}]}}),prepareCall:async config=>({config,stream:async function*(request){
      await new Promise(resolve=>setTimeout(resolve,650));
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
check(root.querySelector('.panel').getBoundingClientRect().right<=innerWidth,'面板适配浏览器宽度');
await until(()=>JSON.parse(localStorage.getItem('dsh.bgame.v1')??'null')?.selection);
root.querySelector('[data-game="gomoku"]').click();
check(root.querySelectorAll('[data-at]').length===225,'五子棋棋盘');
root.querySelector('[data-at="112"]').click();
await until(()=>root.querySelectorAll('.stone').length===2);
check(root.querySelectorAll('.stone.white').length===1,'电脑五子棋落子');
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
root.querySelector('[data-action="1"]').click();
await until(()=>JSON.parse(localStorage.getItem('dsh.bgame.v1')).saved.poker.stage===1);
check(root.querySelectorAll('.playing-card').length===7,'德扑翻牌与隐藏手牌');
root.querySelector('[data-hall]').click();
root.querySelector('[data-game="blackjack"]').click();
check(root.querySelectorAll('.playing-card').length===4,'21 点发牌');
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
output.textContent=JSON.stringify({pass:true,results});
output.setAttribute('data-pass','true');
`;
let server;
try {
  server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://127.0.0.1');
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
