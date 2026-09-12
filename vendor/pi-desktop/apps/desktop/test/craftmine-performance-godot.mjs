// Requires an existing verified Godot Web descriptor (or cases.json with a formal variant).
// Read-only reuse of its artifacts; two fresh offscreen Electron processes and profiles.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import {createRequire} from 'node:module';import {spawn,execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../../../../..',import.meta.url)));
const deps=process.env.CRAFTMINE_PERFORMANCE_DEPS||path.join(root,'vendor/pi-desktop/apps/desktop');
const require=createRequire(path.join(deps,'package.json'));
const source=process.env.CRAFTMINE_PERFORMANCE_DESCRIPTOR;
assert.ok(source,'Set CRAFTMINE_PERFORMANCE_DESCRIPTOR to an existing verified Web descriptor JSON or cases.json');
const value=JSON.parse(fs.readFileSync(source)),descriptor=Array.isArray(value)?value.find(v=>v.variant==='formal').descriptor:value;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function verify(){for(const item of descriptor.artifacts){const absolute=path.resolve(descriptor.root,item.path);assert.ok(absolute.startsWith(path.resolve(descriptor.root)+path.sep));const bytes=fs.readFileSync(absolute);assert.equal(bytes.length,item.bytes);assert.equal(hash(bytes),item.sha256);}}
verify();fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/performance-godot-'));
fs.writeFileSync(path.join(out,'descriptor.json'),JSON.stringify(descriptor,null,2));
const pluginRoot=process.env.CRAFTMINE_PERFORMANCE_PLUGIN_ROOT||root;
execFileSync(process.execPath,[path.join(pluginRoot,'desktop/build-world-plugin.mjs'),'--output',path.join(out,'plugin')],{cwd:pluginRoot,windowsHide:true,stdio:'pipe'});
const appRoot=path.join(out,'electron');fs.mkdirSync(path.join(appRoot,'main'),{recursive:true});fs.mkdirSync(path.join(appRoot,'preload'));
fs.writeFileSync(path.join(appRoot,'package.json'),JSON.stringify({name:'godot-performance-fixture',main:'main/index.cjs'}));
fs.writeFileSync(path.join(appRoot,'main/owner.html'),'<!doctype html><title>Isolated Godot performance fixture</title>');
const desktop=path.join(root,'vendor/pi-desktop/apps/desktop');
for(const [entry,target] of [['test/craftmine-performance-godot-main.mjs','main/index.cjs'],['electron/preload/godot-world.ts','preload/godot-world.cjs'],['electron/preload/craftmine-headless.ts','preload/craftmine-headless.cjs']])
  await require('esbuild').build({entryPoints:[path.join(desktop,entry)],outfile:path.join(appRoot,target),bundle:true,platform:'node',format:'cjs',external:['electron'],target:'node22',nodePaths:[path.join(deps,'node_modules')],logLevel:'warning'});
const pluginFiles=['world-tools.cjs','manifest.json','godot-performance-query.cjs','godot-performance-observation.mjs','godot-observe.cjs','tool-services.cjs'].map(file=>{
  const bytes=fs.readFileSync(path.join(out,'plugin',file));return {path:file,bytes:bytes.length,sha256:hash(bytes)};
});
const report={passed:false,source,path:out,pluginRoot,pluginCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:pluginRoot,encoding:'utf8',windowsHide:true}).trim(),pluginFiles,sourceArtifactsUnchanged:false,phases:[]};
try{
  for(const phase of ['first','reopen']){
    const env={...process.env,CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_PERFORMANCE_OUT:out,CRAFTMINE_PERFORMANCE_PHASE:phase};delete env.ELECTRON_RUN_AS_NODE;
    const log=fs.createWriteStream(path.join(out,phase+'.log'));const child=spawn(require('electron'),[appRoot,'--user-data-dir='+path.join(out,phase+'-profile')],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});const timer=setTimeout(()=>child.kill(),120000);
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}).finally(()=>clearTimeout(timer));log.end();
    const result=JSON.parse(fs.readFileSync(path.join(out,phase+'-report.json')));report.phases.push({phase,code,result});assert.equal(code,0,JSON.stringify(result));assert.equal(result.passed,true);
  }
  verify();report.sourceArtifactsUnchanged=true;report.passed=true;
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed}));}
