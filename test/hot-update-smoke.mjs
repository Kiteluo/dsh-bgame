import {readFile,writeFile,mkdir,lstat,symlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runEdge} from './cdp-browser.mjs';
const home=fileURLToPath(new URL('./hot-update-home/',import.meta.url));
const profile=home+'/profiles/web';const fixture=home+'/fixture';
await mkdir(profile+'/node_modules',{recursive:true});await mkdir(fixture+'/locale',{recursive:true});
for(const file of ['index.mjs','opponents.mjs','opponent-runtime.mjs','move-runtime.mjs','model-runtime.mjs','native-runtime.mjs','native-client.js','client.mjs','games.mjs','bgame.css','icon.svg','cordis.patch.yml','locale/en.json','locale/zh.json'])await writeFile(fixture+'/'+file,await readFile(new URL('../'+file,import.meta.url)));
const currentManifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const initialManifest=structuredClone(currentManifest);delete initialManifest.dsh.client;
await writeFile(fixture+'/package.json',JSON.stringify(initialManifest));
const oldCode=(await readFile(fixture+'/index.mjs','utf8')).replace("kind: 'prefix', path: '/bgame'","kind: 'prefix', path: '/bgame/'");
await writeFile(fixture+'/index.mjs',oldCode);
await writeFile(fixture+'/cordis.patch.yml','- insert:\n    - id: dsh-bgame\n      name: dsh-bgame\n');
if(!await lstat(profile+'/node_modules/dsh-bgame').catch(()=>null))await symlink(fixture,profile+'/node_modules/dsh-bgame','junction');
await writeFile(profile+'/package.json',JSON.stringify({name:'dsh-bgame-hot-update-test',private:true,dependencies:{'dsh-bgame':'link:'+fixture.replaceAll('\\','/')},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-bgame']}}},null,2));
await writeFile(profile+'/cordis.yml','[]\n');await writeFile(profile+'/cordis.patch.yml','[]\n');
const bin=import.meta.resolve('@deepseek-ai/dsh/lib/bin.js');
const child=spawn(process.execPath,['--input-type=module','-e',`process.env.DSH_HOME=${JSON.stringify(home)};process.env.DSH_TELEMETRY_DISABLED='1';process.argv=['node','dsh','web','--no-open','--port','0'];const {runCli}=await import(${JSON.stringify(bin)});await runCli();`],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>logs+=chunk);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const graph=async origin=>{const abort=new AbortController();try{const r=await fetch(origin+'/plugins/events',{signal:abort.signal});const reader=r.body.getReader();let s='';for(let i=0;i<5;i++){s+=new TextDecoder().decode((await reader.read()).value);const line=s.split('\n').find(l=>l.startsWith('data:'));if(line)return JSON.parse(line.slice(5)).graph;}}finally{abort.abort();}};
try{
 let url;for(let i=0;i<200;i++){url=logs.match(/http:\/\/127\.0\.0\.1:\d+\/[^\s\x1b]*/)?.[0];if(url)break;if(child.exitCode!==null)throw new Error('DSH boot failed: '+logs.replace(/token=[^\s]+/g,'token=[redacted]'));await delay(100);}if(!url)throw new Error('DSH boot timeout');
 const origin=new URL(url).origin;
 if((await graph(origin)).entries.some(e=>e.id==='dsh-bgame'))throw new Error('Legacy fixture unexpectedly has a client');
 if((await fetch(origin+'/bgame/play')).status!==404)throw new Error('Legacy fixture must reproduce 404');
 await writeFile(fixture+'/package.json',JSON.stringify(currentManifest));await writeFile(fixture+'/index.mjs',await readFile(new URL('../index.mjs',import.meta.url)));
 await writeFile(fixture+'/cordis.patch.yml',await readFile(new URL('../cordis.patch.yml',import.meta.url)));
 await writeFile(profile+'/cordis.patch.yml','[]\n# Reload arcade runtime after installing its client declaration.\n');
 let mounted=false;for(let i=0;i<120;i++){if((await graph(origin)).entries.some(e=>e.id==='dsh-bgame')){mounted=true;break;}await delay(100);}
 if(!mounted)throw new Error('Hot update failed to load client: '+logs.replace(/token=[^\s]+/g,'token=[redacted]'));
 if((await fetch(origin+'/bgame/play')).status!==401)throw new Error('Hot update did not replace the legacy host route');
 console.log('Legacy cache reproduced, native client and authenticated host route restored without restart.');
 const outputDir=fileURLToPath(new URL('../artifacts/',import.meta.url)).replaceAll('\\','/');await mkdir(outputDir,{recursive:true});
 await runEdge(url,{mobile:false,outputDir,testCode:await readFile(new URL('./native-ui.browser.js',import.meta.url),'utf8'),label:'hot-update'});
}finally{child.kill();}
