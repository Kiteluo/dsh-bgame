import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

test('安装器迁移旧名称，保留其他插件并可重复执行',async()=>{
 const base=new URL('./install-home/',import.meta.url);await mkdir(base,{recursive:true});
 const profile=await mkdtemp(fileURLToPath(new URL('profile-',base)));
 const original={name:'fixture',private:true,dependencies:{'dsh-arcade':'link:../old','other-plugin':'1.0.0'},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','dsh-arcade','other-plugin']}}};
 await writeFile(profile+'/package.json',JSON.stringify(original));
 await writeFile(profile+'/cordis.patch.yml','# Keep other settings\n[]\n# DSH arcade bundle revision: 0.2.4\n');
 await writeFile(profile+'/pnpm-lock.yaml',"lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      dsh-arcade:\n        specifier: link:../old\n        version: link:../old\n      other-plugin:\n        specifier: 1.0.0\n        version: 1.0.0\n");
 const run=()=>execFileSync(process.execPath,[fileURLToPath(new URL('../install.mjs',import.meta.url)),'--profile',profile],{stdio:'pipe'});
 run();const manifest=JSON.parse(await readFile(profile+'/package.json','utf8'));
 assert.equal(manifest.dependencies['dsh-arcade'],undefined);assert.match(manifest.dependencies['dsh-bgame'],/^link:/);
 assert.deepEqual(manifest.dsh.profile.bundles,['@deepseek-ai/dsh-base','dsh-bgame','other-plugin']);
 assert.equal(manifest.dependencies['other-plugin'],'1.0.0');
 const lock=await readFile(profile+'/pnpm-lock.yaml','utf8');assert.doesNotMatch(lock,/dsh-arcade:/);assert.match(lock,/dsh-bgame:/);assert.match(lock,/other-plugin:\n        specifier: 1.0.0\n        version: 1.0.0/);
 assert.deepEqual(JSON.parse(await readFile(profile+'/package.json.before-bgame-rename.bak','utf8')),original);
 assert.equal(await realpath(profile+'/node_modules/dsh-bgame'),await realpath(fileURLToPath(new URL('../',import.meta.url))));
 const paths=['package.json','cordis.patch.yml','pnpm-lock.yaml'];const before=await Promise.all(paths.map(file=>readFile(profile+'/'+file,'utf8')));run();
 assert.deepEqual(await Promise.all(paths.map(file=>readFile(profile+'/'+file,'utf8'))),before);
});
