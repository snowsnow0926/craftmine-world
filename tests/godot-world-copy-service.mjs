// Pure service fixtures; actual core lineage is covered by godot_worlds tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const deps=process.env.CRAFTMINE_NATIVE_DEPENDENCY_ROOT||root;
const {build}=createRequire(path.join(deps,'vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
const out=fs.mkdtempSync(path.join(root,'test-results/copy-service-'));
await build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/godot-world-copy-service.ts')],outfile:path.join(out,'service.mjs'),bundle:true,platform:'node',format:'esm'});
await build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/src/components/craftmine/CopyWorldButton.tsx')],outfile:path.join(out,'button.mjs'),bundle:true,platform:'browser',format:'esm',external:['react']});
const {createGodotWorldCopyService:create,godotCopyTarget:targetFor}=await import(pathToFileURL(path.join(out,'service.mjs')));
const hash=text=>createHash('sha256').update(text).digest('hex');
const input={worldId:'source-world',operationId:'operation-copy-01',title:'My copy'};
const target=targetFor(input.worldId,input.operationId);
const source={format:'craftmine.godot-progress/1',worldId:input.worldId,baseId:'top-down',baseVersion:'1.0.0',stateVersion:1,body:{worldId:input.worldId,inventory:{herb:7},quests:{mira:'completed'},player:{position:[90,240]},coins:64}};
const copy={...structuredClone(source),worldId:target};copy.body.worldId=target;
const report={kind:'pure-copy-service-fixtures-not-runtime',checks:[]};
function fixture(mode='ready'){
 let selected=input.worldId,exists=false,applied=false,attempts=0,checkpoints=0;
 const calls=[];
 const options={selection:async()=>selected,checkpoint:async()=>{checkpoints++;if(mode==='save-failure')throw Error('durability failure');return{status:'persisted',receipt:{format:'craftmine.godot-progress-receipt/1',worldId:input.worldId,buildId:'old-build',revision:7}};},
 open:async id=>{calls.push('open');assert.equal(id,target);selected=id;},
 start:async id=>{calls.push('start');assert.equal(selected,target);assert.equal(id,target);if(mode==='build-retry'&&attempts++===0)throw Error('CHECK_FAILED');applied=true;return{status:'ready'};},
 domain:async(method,args)=>{
  calls.push(method);
  if(method==='godotWorld.copyStatus')return exists?{targetWorldId:target,originalSourceWorldId:mode==='wrong-origin'?'foreign':input.worldId,copyId:'gcopy-'+hash('craftmine.godot-world-copy/1|'+input.worldId+'|'+target),progressMode:'formal'}:null;
  if(method==='godotRuntime.describe')return args.worldId===input.worldId?{phase:'formal',worldId:input.worldId,buildId:'old-build',snapshot:source}:{phase:'formal',worldId:target,copiedFromWorldId:applied?null:input.worldId,buildId:'new-build',snapshot:copy};
  if(method==='world.read')return {revision:args.id===input.worldId?7:0,world:{build:{id:'old-build'},snapshot:args.id===input.worldId?source:copy}};
  if(method==='godotWorld.copy'){assert.deepEqual(args,{sourceWorldId:input.worldId,targetWorldId:target,title:input.title,progress:'formal'});exists=true;if(mode==='lost-response')throw Error('response lost after commit');return{};}
  if(method==='content.status')return {backend:'git'};
  if(method==='godotWorld.prepareRebuildSource'||method==='godotWorld.prepareCopyRuntime')return {copied:true};
  throw Error('Unexpected '+method);
 }};
 return {options,calls,get checkpoints(){return checkpoints;},makeExisting(){exists=true;}};
}
for(const mode of ['ready','lost-response']){
 const f=fixture(mode),service=create(f.options);
 const pending=service.copy(input);assert.equal(service.busy,true);assert.equal(service.copy(input),pending);
 const result=await pending;assert.equal(result.status,'ready');assert.equal(service.busy,false);assert.equal(f.checkpoints,1);
 assert.ok(f.calls.indexOf('godotWorld.copy')<f.calls.indexOf('godotWorld.prepareCopyRuntime'));
 assert.ok(f.calls.indexOf('open')<f.calls.indexOf('start'));
 // Reconstructed host service, same core origin: never recopy or resave source.
 await create(f.options).copy(input);
 assert.equal(f.calls.filter(x=>x==='godotWorld.copy').length,1);assert.equal(f.checkpoints,1);
 report.checks.push(mode+': durable-origin retry preserves one target');
}
{
 const f=fixture('build-retry'),first=create(f.options);await assert.rejects(first.copy(input),/CHECK_FAILED/);
 assert.equal(first.status(input).status,'failed');
 await create(f.options).copy(input);assert.equal(f.calls.filter(x=>x==='godotWorld.copy').length,1);assert.equal(f.checkpoints,1);
 report.checks.push('independent rebuild failure retries same persisted copy after service restart');
}
{
 const f=fixture('save-failure');await assert.rejects(create(f.options).copy(input),/durability failure/);assert.ok(!f.calls.includes('godotWorld.copy'));assert.ok(!f.calls.includes('open'));
 report.checks.push('failed durability cannot create or select a copy');
}
{
 const f=fixture('wrong-origin');f.makeExisting();await assert.rejects(create(f.options).copy(input),/ORIGIN_MISMATCH/);assert.equal(f.checkpoints,0);
 assert.throws(()=>create(f.options).copy({...input,snapshot:{}}),/INVALID_COPY_REQUEST/);
 report.checks.push('foreign durable origin and caller-supplied snapshot rejected');
}
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,out},null,2));
