import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
/** Standalone headless Edge fallback; this does not control the Codex in-app browser. */
export async function runEdge(url, { mobile, outputDir, testCode, label, snapshots = [] }) {
  const userData = fileURLToPath(new URL('./edge-profile/', import.meta.url));
  const activePort = `${userData}/DevToolsActivePort`;
  await mkdir(userData, { recursive: true });
  await writeFile(activePort, '');
  const child = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${userData}`, '--remote-debugging-port=0', 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; child.stderr.on('data', chunk => errors += chunk);
  const closed = new Promise(resolve => child.once('close', resolve));
  const timer = setTimeout(() => child.kill(), 45000);
  let socket;
  try {
    let port;
    for (let i = 0; i < 200; i++) {
      const contents = await readFile(activePort, 'utf8').catch(() => '');
      port = Number(contents.split('\n')[0]); if (port) break; await pause(50);
    }
    if (!port) throw new Error('无法连接测试浏览器');
    const protocol = await (await fetch(`http://127.0.0.1:${port}/json/protocol`)).json();
    for (const [domain, command] of [['Emulation','setDeviceMetricsOverride'],['Page','captureScreenshot']]) {
      if (!protocol.domains.find(x=>x.domain===domain)?.commands.some(x=>x.name===command)) throw new Error('浏览器不支持所需验证接口');
    }
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find(t => t.type === 'page');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true}); });
    let id=0;const requests=new Map();
    socket.addEventListener('message',event=>{
      const message=JSON.parse(event.data);const request=requests.get(message.id);
      if(request){requests.delete(message.id);clearTimeout(request.timer);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);}
    });
    const send=(method,params={})=>new Promise((resolve,reject)=>{
      const key=++id;const timeout=setTimeout(()=>{requests.delete(key);reject(new Error(`测试浏览器调用超时：${method}`));},10000);
      requests.set(key,{resolve,reject,timer:timeout});socket.send(JSON.stringify({id:key,method,params}));
    });
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:mobile?420:1440,height:mobile?900:1000,deviceScaleFactor:1,mobile});
    await send('Page.navigate',{url});
    if(testCode){await new Promise(resolve=>setTimeout(resolve,500));await send('Runtime.evaluate',{expression:testCode,returnByValue:true});}
    let pass;
    for(let i=0;i<200;i++){
      const result=await send('Runtime.evaluate',{expression:"document.getElementById('result')?.getAttribute('data-pass')",returnByValue:true});
      pass=result.result?.value;if(pass==='true'||pass==='false')break;await pause(100);
    }
    const dom=await send('Runtime.evaluate',{expression:'document.documentElement.outerHTML',returnByValue:true});
    await writeFile(`${outputDir}arcade-browser-${label??(mobile?'mobile':'desktop')}.html`,dom.result.value);
    const screenshot=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
    await writeFile(`${outputDir}arcade-${label??(mobile?'mobile':'desktop')}.png`,Buffer.from(screenshot.data,'base64'));
    for(const snapshot of snapshots){
      const result=await send('Runtime.evaluate',{expression:snapshot.expression,awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??'Screenshot preparation failed');
      const shot=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
      await writeFile(outputDir+'arcade-'+snapshot.label+'.png',Buffer.from(shot.data,'base64'));
    }
    const report=await send('Runtime.evaluate',{expression:"document.getElementById('result')?.textContent ?? document.body.innerText",returnByValue:true});
    console.log(`${mobile?'Mobile':'Desktop'} browser result:`,report.result.value);
    const closing=send('Browser.close').catch(()=>{});
    await Promise.race([closed,pause(2000)]);socket.close();
    await closing;
    if(pass!=='true')throw new Error('浏览器交互验证失败');
  } catch(error){console.error(errors.slice(-1000));throw error;}
  finally{clearTimeout(timer);socket?.close();if(child.exitCode===null)child.kill();}
}
