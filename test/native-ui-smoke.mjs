import {readFile,writeFile,mkdir,lstat,symlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runEdge} from './cdp-browser.mjs';
const home=fileURLToPath(new URL('./native-home/',import.meta.url));
const profile=home+'/profiles/web';
const plugin=fileURLToPath(new URL('../',import.meta.url));
await mkdir(profile+'/node_modules',{recursive:true});
if(!await lstat(profile+'/node_modules/dsh-bgame').catch(()=>null))await symlink(plugin,profile+'/node_modules/dsh-bgame','junction');
await writeFile(profile+'/package.json',JSON.stringify({name:'dsh-bgame-ui-test',private:true,dependencies:{'dsh-bgame':'link:'+plugin.replaceAll('\\','/')},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-bgame']}}},null,2));
await writeFile(profile+'/cordis.yml','[]\n');
await writeFile(profile+'/cordis.patch.yml','[]\n');
const bin=import.meta.resolve('@deepseek-ai/dsh/lib/bin.js');
const child=spawn(process.execPath,['--input-type=module','-e',`process.env.DSH_HOME=${JSON.stringify(home)};process.env.DSH_TELEMETRY_DISABLED='1';process.argv=['node','dsh','web','--no-open','--port','0'];const {runCli}=await import(${JSON.stringify(bin)});await runCli();`],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>logs+=chunk);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 let url;
 for(let i=0;i<200;i++){url=logs.match(/http:\/\/127\.0\.0\.1:\d+\/[^\s\x1b]*/)?.[0];if(url)break;if(child.exitCode!==null)throw new Error('Native DSH boot failed: '+logs);await delay(100);}
 if(!url)throw new Error('Native DSH URL timeout: '+logs);
 const outputDir=fileURLToPath(new URL('../artifacts/',import.meta.url)).replaceAll('\\','/');await mkdir(outputDir,{recursive:true});
 await runEdge(url,{mobile:false,outputDir,testCode:await readFile(new URL('./native-ui.browser.js',import.meta.url),'utf8'),label:'native-ui',snapshots:[
  {label:'game-gomoku',expression:`(async()=>{const frame=document.querySelector('[data-dsh-bgame-panel] iframe');const root=frame.contentDocument.getElementById('dsh-bgame-host').shadowRoot;root.querySelector('[data-game="gomoku"]').click();await new Promise(r=>setTimeout(r,300));})()`},
  {label:'plugins-installed',expression:`(async()=>{document.querySelector('[aria-label="插件"]').click();for(let i=0;i<80;i++){const card=document.querySelector('[data-plugin-package="dsh-bgame"]');if(card){card.scrollIntoView({block:'center'});await new Promise(r=>setTimeout(r,300));return;}await new Promise(r=>setTimeout(r,100));}throw new Error('Plugin list screenshot timeout');})()`},
  {label:'plugin-detail',expression:`(async()=>{document.querySelector('[data-plugin-package="dsh-bgame"] button').click();for(let i=0;i<80;i++){if(document.querySelector('[data-arcade-plugin-info]')){await new Promise(r=>setTimeout(r,300));return;}await new Promise(r=>setTimeout(r,100));}throw new Error('Plugin detail screenshot timeout');})()`},
]});
}finally{child.kill();}
