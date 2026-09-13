import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';import {build} from 'esbuild';
import {materializeBase} from '../../../../../desktop/godot/shared/materialize.mjs';
import {loadSceneObserverPins,hasCurrentSceneObserver,needsCreationPreviewUpgrade} from '../electron/main/creation-observer-pins.ts';
const root=fileURLToPath(new URL('../../../../../',import.meta.url)),resourcesRoot=path.join(root,'desktop/godot'),pins=loadSceneObserverPins(resourcesRoot),sha=t=>createHash('sha256').update(t).digest('hex');
const bundle=await build({entryPoints:[fileURLToPath(new URL('../electron/main/creation-source-migration.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node'});const {createCreationSourceMigration}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'preview-upgrade-'));test.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
for(const crlf of [false,true])test('released '+(crlf?'CRLF':'LF')+' engine bridge upgrades only itself through the exact source CAS',async()=>{
 const out=path.join(temporary,crlf?'crlf':'lf'),manifest=materializeBase({baseId:'creation-sandbox',worldId:'preview-upgrade',out,enginePerformanceProfile:'engine-monitor/1'});
 const name='craftmine_shared/runtime_bridge.gd';let old=fs.readFileSync(path.join(resourcesRoot,'shared/repairs/runtime_bridge_engine_v1-before-preview.gd'),'utf8').replace(/\r\n/g,'\n');if(crlf)old=old.replace(/\n/g,'\r\n');
 const files=manifest.files.map(f=>f.path===name?{...f,bytes:Buffer.byteLength(old),sha256:sha(old)}:f);assert(hasCurrentSceneObserver(files,pins));assert(needsCreationPreviewUpgrade(files,pins));
 let live=structuredClone(files),revision=1,manifestHash='a'.repeat(64),patches=[];
 const capture={worldId:'world-a',buildId:'build-a',sourceRevision:1,manifestHash,observerUpgradeOnly:true};
 const migrate=createCreationSourceMigration({directory:path.join(out,'records'),resourcesRoot,assertActive:async()=>{},recordAdvance:()=>{},domain:async(method,args)=>{
  if(method==='godotRuntime.exportSource')return {worldId:'world-a',buildId:'build-a',sourceRevision:1,baseId:'creation-sandbox',contentOid:'f'.repeat(40),files};
  if(method==='content.readFile'){const text=fs.readFileSync(path.join(out,args.path),'utf8');return {worldId:'world-a',rev:args.rev,path:args.path,text,bytes:Buffer.byteLength(text),sha256:sha(text)};}
  if(method==='godotProject.index')return {worldId:'world-a',baseId:'creation-sandbox',revision,manifestHash,files:live.slice(args.offset,args.offset+args.limit),nextOffset:args.offset+args.limit<live.length?args.offset+args.limit:null,currentTaskId:'task-a'};
  if(method==='task.context')return {binding:{taskId:'task-a'}};
  if(method==='godotProject.patch'){patches.push(args);assert.equal(args.operations.length,1);const op=args.operations[0];assert.equal(op.path,name);assert.equal(op.expectedHash,sha(old));live=live.map(f=>f.path===name?{...f,bytes:Buffer.byteLength(op.text),sha256:sha(op.text)}:f);revision++;manifestHash=sha(JSON.stringify(live));return {revision,manifestHash};}
  throw Error('Unexpected '+method);
 }});
 const result=await migrate({projectId:'project-a',sessionId:'session-a',turnId:'turn-a'},capture);assert.equal(result.revision,2);assert.equal(patches.length,1);assert(!needsCreationPreviewUpgrade(live,pins));assert(hasCurrentSceneObserver(live,pins));assert.deepEqual(live.filter(f=>f.path!==name),files.filter(f=>f.path!==name));
});
test('unknown old bridge and aliases cannot acquire preview migration authority',()=>{const manifest=materializeBase({baseId:'creation-sandbox',worldId:'preview-unknown',out:path.join(temporary,'unknown'),enginePerformanceProfile:'engine-monitor/1'});const name='craftmine_shared/runtime_bridge.gd';assert(!needsCreationPreviewUpgrade(manifest.files.map(f=>f.path===name?{...f,sha256:'f'.repeat(64)}:f),pins));assert(!needsCreationPreviewUpgrade([...manifest.files,{path:name+'.remap',sha256:'a'.repeat(64)}],pins));});

for(const crlf of [false,true])test('ordinary standard bridge '+(crlf?'CRLF':'LF')+' bootstraps only the exact wrapper and two missing helpers',async()=>{
 const out=path.join(temporary,'standard-'+crlf),manifest=materializeBase({baseId:'creation-sandbox',worldId:'standard-upgrade',out});
 assert.equal(manifest.files.find(f=>f.path==='craftmine_shared/runtime_bridge.gd').sha256,pins['@engineBridge'][0],'ordinary new worlds enable preview by default');
 const bridge='craftmine_shared/runtime_bridge.gd',base='craftmine_shared/runtime_bridge_base.gd',collector='craftmine_shared/engine_performance.gd';let old=fs.readFileSync(path.join(resourcesRoot,'shared/runtime_bridge.gd'),'utf8').replace(/\r\n/g,'\n');if(crlf)old=old.replace(/\n/g,'\r\n');
 const files=manifest.files.filter(f=>![base,collector].includes(f.path)).map(f=>f.path===bridge?{...f,bytes:Buffer.byteLength(old),sha256:sha(old)}:f);assert(hasCurrentSceneObserver(files,pins));assert(needsCreationPreviewUpgrade(files,pins));
 let live=structuredClone(files),revision=1,manifestHash='a'.repeat(64),patches=0;
 const capture={worldId:'world-a',buildId:'build-a',sourceRevision:1,manifestHash,observerUpgradeOnly:true};
 const migrate=createCreationSourceMigration({directory:path.join(out,'records'),resourcesRoot,assertActive:async()=>{},recordAdvance:()=>{},domain:async(method,args)=>{
  if(method==='godotRuntime.exportSource')return {worldId:'world-a',buildId:'build-a',sourceRevision:1,baseId:'creation-sandbox',contentOid:'f'.repeat(40),files};
  if(method==='content.readFile'){const text=fs.readFileSync(path.join(out,args.path),'utf8');return {worldId:'world-a',rev:args.rev,path:args.path,text,bytes:Buffer.byteLength(text),sha256:sha(text)};}
  if(method==='godotProject.index')return {worldId:'world-a',baseId:'creation-sandbox',revision,manifestHash,files:live.slice(args.offset,args.offset+args.limit),nextOffset:args.offset+args.limit<live.length?args.offset+args.limit:null,currentTaskId:'task-a'};
  if(method==='task.context')return {binding:{taskId:'task-a'}};
  if(method==='godotProject.patch'){patches++;assert.deepEqual(args.operations.map(o=>o.path),[bridge,base,collector]);for(const op of args.operations){assert.equal(op.expectedHash,op.path===bridge?sha(old):null);const f={path:op.path,bytes:Buffer.byteLength(op.text),sha256:sha(op.text)};const at=live.findIndex(v=>v.path===op.path);if(at<0)live.push(f);else live[at]=f;}revision++;manifestHash=sha(JSON.stringify(live));return {revision,manifestHash};}
  throw Error('Unexpected '+method);
 }});
 const result=await migrate({projectId:'project-a',sessionId:'session-a',turnId:'turn-a'},capture);assert.equal(result.revision,2);assert.equal(patches,1);assert(!needsCreationPreviewUpgrade(live,pins));assert(hasCurrentSceneObserver(live,pins));assert.deepEqual(live.filter(f=>![bridge,base,collector].includes(f.path)),files.filter(f=>f.path!==bridge));
 const unknown=files.map(f=>f.path===bridge?{...f,sha256:'e'.repeat(64)}:f);assert(!needsCreationPreviewUpgrade(unknown,pins));
});
