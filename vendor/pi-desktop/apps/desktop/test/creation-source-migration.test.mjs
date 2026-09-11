import assert from 'node:assert/strict';import test from 'node:test';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash}from'node:crypto';import {execFileSync}from'node:child_process';import {build}from'esbuild';
const file=new URL('../electron/main/creation-source-migration.ts',import.meta.url).pathname.replace(/^\/(\w:)/,'$1');const bundled=await build({entryPoints:[file],bundle:true,write:false,format:'esm',platform:'node'});const {createCreationSourceMigration,CREATION_MIGRATION_FILES,creationProjectSelectorsSafe}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const sha=text=>createHash('sha256').update(text).digest('hex'),meta=(name,text)=>({path:name,bytes:Buffer.byteLength(text),sha256:sha(text)});
const project='[autoload]\nCraftmineRuntime="*res://craftmine_shared/runtime_bridge.gd"\n[craftmine]\nruntime/adapter="res://craftmine_shared/base_adapter.gd"\n';
const ctx={projectId:'project-a',sessionId:'session-a',turnId:'turn-a'};
function fixture({crlf=false,modern=false,loss=false}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'creation-migration-')),resourcesRoot=path.join(directory,'resources'),recordRoot=path.join(directory,'records'),texts=new Map([['project.godot',project],['world/creation.json','{"custom":"player scene preserved"}'],['world/creation-operations.json','{"custom":"journal preserved"}'],['scripts/user/invention.gd','extends Node\n# User-owned invention\n']]);
 for(const entry of CREATION_MIGRATION_FILES){let old=execFileSync('git',['show',`c1660f12:desktop/godot/${entry.resource}`],{encoding:'utf8',windowsHide:true});old=old.replace(/\r\n/g,'\n');assert.equal(entry.old.includes(sha(old)),true);const target=old+'\n# New trusted migration test fixture\n',file=path.join(resourcesRoot,entry.resource);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,target);texts.set(entry.source,modern?target:crlf?old.replace(/\n/g,'\r\n'):old);}
 const formal={worldId:'world-a',buildId:'formal-a',baseId:'creation-sandbox',sourceRevision:1,contentOid:'f'.repeat(40),files:[...texts].map(([name,text])=>meta(name,text))};let live=structuredClone(formal.files),revision=1,manifestHash='a'.repeat(64),receipt=null,patches=0,failBind=false;const calls=[],advances=[];
 const capture={worldId:'world-a',buildId:'formal-a',sourceRevision:1,manifestHash:'a'.repeat(64)};
 const source=()=>({worldId:'world-a',baseId:'creation-sandbox',revision,manifestHash,files:live,currentTaskId:'task-a',content:{repoId:'repo-a',branchId:'main',contentOid:'c'.repeat(40)},nextOffset:null});
 const deps={directory:recordRoot,resourcesRoot,managedMigrations:[],assertActive:async()=>{},recordAdvance:(_,__,advance)=>{if(failBind){failBind=false;throw Error('SIMULATED_LOST_BIND');}advances.push(advance);},domain:async(method,args)=>{calls.push({method,args});
  if(method==='godotRuntime.exportSource')return structuredClone(formal);
  if(method==='content.readFile')return {...meta(args.path,texts.get(args.path)),worldId:'world-a',rev:args.rev,text:texts.get(args.path)};
  if(method==='godotProject.index')return structuredClone(source());
  if(method==='task.context')return {binding:{...ctx,taskId:'task-a',baseBuild:'formal-a'}};
  if(method==='godotProject.receipt')return receipt;
  if(method==='godotProject.patch'){assert.equal(args.revision,revision);assert.equal(args.manifestHash,manifestHash);for(const op of args.operations){assert.equal(live.find(f=>f.path===op.path).sha256,op.expectedHash);}patches++;live=live.map(file=>{const op=args.operations.find(op=>op.path===file.path);return op?meta(file.path,op.text):file;});revision++;manifestHash=sha(JSON.stringify(live));receipt={revision,manifestHash};if(loss)throw Error('SIMULATED_REPLY_LOSS');return receipt;}
  throw Error('Unexpected '+method);
 }};
 return{directory,deps,capture,calls,advances,formal,source,execute:()=>createCreationSourceMigration(deps),patches:()=>patches,customCore:()=>{formal.files.find(f=>f.path==='scripts/creation_world.gd').sha256='e'.repeat(64);live=structuredClone(formal.files);},dirtyDraft:()=>{live.push(meta('scripts/unapplied.gd','custom draft'));},loseBind:()=>{failBind=true;}};
}
test('preview.10 LF and CRLF stock upgrades all changed core files in one CAS and preserves every user file',async()=>{
 for(const crlf of [false,true]){const f=fixture({crlf}),advance=await f.execute()(ctx,f.capture);assert.equal(f.patches(),1);assert.equal(f.calls.find(c=>c.method==='godotProject.patch').args.operations.length,5);assert.equal(advance.revision,2);for(const old of f.formal.files.filter(file=>!CREATION_MIGRATION_FILES.some(e=>e.source===file.path)))assert.deepEqual(f.source().files.find(file=>file.path===old.path),old);assert.equal(f.advances.length,1);}
});
test('current stock creates no patch or migration advance',async()=>{const f=fixture({modern:true});assert.equal(await f.execute()(ctx,f.capture),null);assert.equal(f.patches(),0);assert.equal(f.advances.length,0);});
test('current protected observer permits authored mutable world code without replacing it',async()=>{const f=fixture({modern:true});f.customCore();const before=structuredClone(f.source());assert.equal(await f.execute()(ctx,f.capture),null);assert.equal(f.patches(),0);assert.deepEqual(f.source(),before);});
test('unknown customized core and unrelated unapplied draft changes are preserved and explicitly refused',async()=>{
 for(const mode of ['customCore','dirtyDraft']){const f=fixture();f[mode]();const before=structuredClone(f.source());await assert.rejects(f.execute()(ctx,f.capture),/MIGRATION_NEEDED|DRAFT_CONFLICT/);assert.equal(f.patches(),0);assert.deepEqual(f.source(),before);}
});
test('lost committed patch response recovers original receipt without repeating the patch',async()=>{const f=fixture({loss:true});await f.execute()(ctx,f.capture);assert.equal(f.patches(),1);assert.ok(f.calls.some(c=>c.method==='godotProject.receipt'));});
test('new host turn recovers a committed migration after lost capture-bind record without accepting extra changes',async()=>{
 const f=fixture();f.loseBind();await assert.rejects(f.execute()(ctx,f.capture),/LOST_BIND/);const restored=await f.execute()({...ctx,turnId:'turn-b'},f.capture);assert.equal(restored.revision,2);assert.equal(f.patches(),1);assert.equal(f.calls.filter(c=>c.method==='godotProject.receipt').at(-1).args.binding.turnId,'turn-a');f.dirtyDraft();await assert.rejects(f.execute()({...ctx,turnId:'turn-c'},f.capture),/DRAFT_CONFLICT/);assert.equal(f.patches(),1);
});
test('fixed selector and autoload must be exact and unique; unrelated settings remain allowed',()=>{
 assert.equal(creationProjectSelectorsSafe(project),true);assert.equal(creationProjectSelectorsSafe(project+'title="custom world"\n'),true);assert.equal(creationProjectSelectorsSafe(project+project),false);assert.equal(creationProjectSelectorsSafe(project.replace('*res://','res://')),false);assert.equal(creationProjectSelectorsSafe(project.replace('base_adapter.gd','custom.gd')),false);
});
