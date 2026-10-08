import {readFile,writeFile,copyFile,mkdir,lstat,realpath,symlink,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {relative,join,resolve} from 'node:path';
import {homedir} from 'node:os';
const directory=fileURLToPath(new URL('./',import.meta.url));
const localProfile=fileURLToPath(new URL('../../.dsh/profiles/web/',import.meta.url));
const args=process.argv.slice(2);let explicit;
if(args.length){if(args.length!==2||args[0]!=='--profile')throw new Error('用法：node install.mjs [--profile /path/to/.dsh/profiles/web]');explicit=args[1];}
const exists=path=>access(path).then(()=>true,()=>false);
const profile=resolve(explicit ?? (process.env.DSH_HOME?join(process.env.DSH_HOME,'profiles/web'):await exists(join(localProfile,'package.json'))?localProfile:join(homedir(),'.dsh/profiles/web')));
const manifestPath=join(profile,'package.json'),patchPath=join(profile,'cordis.patch.yml'),lockPath=join(profile,'pnpm-lock.yaml');
const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
const patch=await readFile(patchPath,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
const lock=await readFile(lockPath,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
const {version}=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
const legacy=/\r?\n# DSH 小游戏厅（本地插件）\r?\n- insert:\r?\n    - id: dsh-arcade\r?\n      name: [^\r\n]*\r?\n?/;
const migrated=patch.replace(legacy,'\n');
if(/id:\s*dsh-(?:arcade|bgame)\s*(?:\r?\n|$)/m.test(migrated))throw new Error('发现手动挂载的小游戏插件，请先检查以避免重复加载。');
const marker='# DSH bgame bundle revision: '+version;
const markerPattern=/^# DSH (?:arcade|bgame) bundle revision:.*$/m;
const nextPatch=markerPattern.test(migrated)?migrated.replace(markerPattern,marker):migrated.trimEnd()+'\n\n'+marker+'\n';
const dependency='link:'+relative(profile,directory).replaceAll('\\','/');
let nextLock=lock;
if(lock!==null){
 const newline=lock.includes('\r\n')?'\r\n':'\n';
 const entry=['      dsh-bgame:','        specifier: '+dependency,'        version: '+dependency,''].join(newline);
 const existing=/^      dsh-(?:arcade|bgame):\r?\n        specifier: [^\r\n]*\r?\n        version: [^\r\n]*\r?\n/gm;
 const importer=/(^  \.:\r?\n    dependencies:\r?\n)/m;
 if(!importer.test(lock))throw new Error('无法识别 Web profile 的锁文件依赖段。');
 nextLock=lock.replace(existing,'').replace(importer,'$1'+entry);
}
const modules=join(profile,'node_modules');await mkdir(modules,{recursive:true});
const link=join(modules,'dsh-bgame');const existing=await lstat(link).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
if(existing){if((await realpath(link)).toLowerCase()!==(await realpath(directory)).toLowerCase())throw new Error('dsh-bgame 已由另一安装占用。');}
else await symlink(directory,link,process.platform==='win32'?'junction':'dir');
for(const path of [manifestPath,...await exists(patchPath)?[patchPath]:[],...lock===null?[]:[lockPath]])await copyFile(path,path+'.before-bgame-rename.bak',constants.COPYFILE_EXCL).catch(error=>{if(error.code!=='EEXIST')throw error;});
manifest.dependencies??={};delete manifest.dependencies['dsh-arcade'];manifest.dependencies['dsh-bgame']=dependency;
manifest.dsh??={};manifest.dsh.profile??={};
const bundles=(manifest.dsh.profile.bundles??[]).map(name=>name==='dsh-arcade'?'dsh-bgame':name);
manifest.dsh.profile.bundles=[...new Set([...bundles,'dsh-bgame'])];
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
if(nextLock!==lock)await writeFile(lockPath,nextLock);
if(nextPatch!==patch)await writeFile(patchPath,nextPatch);
console.log('已安装并启用 dsh-bgame；刷新 Web 可见导航和插件详情入口。');
