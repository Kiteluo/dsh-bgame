(async()=>{
 const results=[];const delay=ms=>new Promise(r=>setTimeout(r,ms));
 const check=(ok,label)=>{if(!ok)throw new Error(label);results.push(label);};
 const until=async(fn,label)=>{for(let i=0;i<120;i++){if(fn())return fn();await delay(100);}throw new Error(label+'; '+document.body.innerText.slice(0,1200)+' FRAME: '+document.querySelector('iframe')?.contentDocument?.documentElement?.outerHTML.slice(0,1600));};
 const output=document.createElement('pre');output.id='result';output.style.display='none';document.body.append(output);
 try{
 const consent=await until(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='继续'),'测试环境初次启动提示');consent.click();const skip=await until(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='稍后配置'),'跳过测试环境凭据配置');skip.click();await delay(200);
 const nav=await until(()=>document.querySelector('[aria-label="dsh-bgame"]'),'原生左侧入口');
 check(nav.getBoundingClientRect().width>0,'左侧显示dsh-bgame');nav.click();
 const gameRoot=()=>document.querySelector('[data-dsh-bgame-panel] iframe')?.contentDocument?.getElementById('dsh-bgame-host')?.shadowRoot;
 let root=await until(()=>gameRoot()?.querySelectorAll('[data-game]').length===4&&gameRoot(),'打开原生游戏大厅');
 check(root.querySelector('.panel.embedded')?.getBoundingClientRect().height>500,'大厅嵌入主区域');
 root.querySelector('[data-close]').click();await until(()=>!document.querySelector('[data-dsh-bgame-panel]'),'回到工作');results.push('回到工作关闭大厅');
 document.querySelector('[aria-label="插件"]').click();
 const card=await until(()=>document.querySelector('[data-plugin-package="dsh-bgame"]'),'已安装插件卡片');
 check(card.textContent.includes('dsh-bgame'),'插件显示中文名称');check(card.querySelector('[role=switch]')?.getAttribute('aria-checked')==='true','插件处于启用状态');
 card.querySelector('button').click();
 await until(()=>document.querySelector('[data-plugin-detail="dsh-bgame"]'),'插件详情');
 check(!!document.querySelector('[data-arcade-plugin-info]'),'详情显示四款游戏介绍');
 document.querySelector('[data-arcade-open]').click();
 root=await until(()=>gameRoot()?.querySelectorAll('[data-game]').length===4&&gameRoot(),'详情打开游戏大厅');results.push('插件详情打开大厅');
 root.querySelector('[data-game="gomoku"]').click();root.querySelector('[data-at="112"]').click();
 await until(()=>gameRoot()?.querySelectorAll('.stone').length===2,'电脑落子');results.push('原生面板完成五子棋回合');
 root.querySelector('[data-close]').click();await until(()=>!document.querySelector('[data-dsh-bgame-panel]'),'关闭对局');
 document.querySelector('[aria-label="dsh-bgame"]').click();
 root=await until(()=>gameRoot()?.querySelector('[data-game="gomoku"]')&&gameRoot(),'重开大厅');root.querySelector('[data-game="gomoku"]').click();
 check(root.querySelectorAll('.stone').length===2,'跨面板恢复存档');root.querySelector('[data-hall]').click();
 output.dataset.pass='true';output.textContent=JSON.stringify(results);
 }catch(error){output.dataset.pass='false';const diagnostic=await fetch('/bgame/play').then(async r=>({status:r.status,body:(await r.text()).slice(0,1000)}));output.textContent=JSON.stringify(diagnostic)+'\n'+error.stack+'\n'+JSON.stringify(results);}
})();
