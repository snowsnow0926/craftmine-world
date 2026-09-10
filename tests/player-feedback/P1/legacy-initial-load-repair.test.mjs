// Production initializer with controlled Core receipts and real old/new source
// bytes. This is not a native renderer, Core transaction or player-save test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../../..');
const output=path.join(root,'test-results/P1-legacy-repair');fs.mkdirSync(output,{recursive:true});
const desktop=path.join(root,'vendor/pi-desktop/apps/desktop');
const require=createRequire(path.join(desktop,'package.json'));
const bundle=path.join(output,'initializer.cjs');
await require('esbuild').build({entryPoints:[path.join(desktop,'electron/main/godot-world-initialization.ts')],outfile:bundle,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
const {createGodotWorldInitializer}=require(bundle);
const hash=value=>createHash('sha256').update(value).digest('hex');
const oldBridge=execFileSync('git',['show','eae279915094f09d987ef0eb747eba20ef92cd0e:desktop/godot/shared/runtime_bridge.gd'],{cwd:root,windowsHide:true});
const newBridge=fs.readFileSync(path.join(root,'desktop/godot/shared/runtime_bridge.gd'));
assert.equal(hash(oldBridge),'318fdb30c40a6165a2080ff12190571fada156ba321f83c3264bae91e4052c76');
function fixture({custom=false,missing=false,playable=false,changedOwner=false,failCheck=false,replacement=newBridge}={}){
 const worldsRoot=fs.mkdtempSync(path.join(output,'worlds-')),worldId='legacy-test';
 const directory=path.join(worldsRoot,worldId);fs.mkdirSync(path.join(directory,'craftmine_shared'),{recursive:true});
 const originals=new Map([['project.godot',Buffer.from('config_version=5\n')],['craftmine_shared/runtime_bridge.gd',oldBridge],['player-content.txt',Buffer.from('authored content must remain')]]);
 for(const [name,bytes] of originals)fs.writeFileSync(path.join(directory,name),bytes);
 const metadata=Buffer.from(JSON.stringify({worldId,baseId:'first-person',files:[...originals].map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:hash(bytes)}))}));
 fs.writeFileSync(path.join(directory,'managed-base.json'),metadata);
 const source=new Map([...originals].map(([name,bytes])=>[name,Buffer.from(bytes)]));
 if(custom)source.set('craftmine_shared/runtime_bridge.gd',Buffer.from('user-customized bridge'));
 if(missing)source.delete('player-content.txt');
 let revision=1,statusReads=0;const calls=[],loads=[];
 const index=()=>({revision,manifestHash:hash(JSON.stringify([...source].map(([name,bytes])=>[name,hash(bytes)]))),files:[...source].map(([name,bytes])=>({path:name,sha256:hash(bytes)})),nextOffset:null});
 const originalManifest=index().manifestHash;
 const domain=async(method,args)=>{
  calls.push({method,args:structuredClone(args)});
  switch(method){
   case 'godotWorld.initStatus':return {initId:++statusReads>1&&changedOwner?'changed-init':'original-init',worldId,worldRevision:1,status:playable?'confirmed':'checked',playable,candidateId:'old-candidate'};
   case 'task.recoverable':return {items:[]};
   case 'turn.begin':return {binding:{baseBuild:'original-base'}};
   case 'godotProject.index':return index();
   case 'content.status':return {backend:'git',repoId:'repo',headOid:'original-head',appliedOid:null};
   case 'godotProject.applyFiles':{
    assert.equal(args.revision,revision);assert.equal(args.manifestHash,index().manifestHash);
    assert.equal(args.files.length,1);assert.equal(args.files[0].path,'craftmine_shared/runtime_bridge.gd');
    assert.equal(args.files[0].expectedHash,hash(source.get(args.files[0].path)));
    assert.equal(args.operation.expectedHeadOid,'original-head');assert.equal(args.operation.expectedAppliedOid,null);
    assert.equal(args.operation.expectedProgressRevision,1);assert.deepEqual(args.initialLoadRepair,{initId:'original-init'});
    source.set(args.files[0].path,Buffer.from(args.files[0].bytesBase64,'base64'));revision++;return index();
   }
   case 'godotCandidate.list':return {items:[{candidateId:'old-candidate',status:'ready',manifestHash:originalManifest}]};
   case 'godotExecutor.status':return {buildAvailable:true,checkAvailable:true};
   case 'godotBuild.start':return {jobId:'new-check'};
   case 'godotBuild.read':return failCheck?{status:'failed',error:'AUTHORED_CHECK_FAILURE'}:{status:'passed',candidateId:'repaired-candidate'};
   case 'workspace.endTurn':return {ok:true};
   default:throw Error('Unexpected '+method);
  }
 };
 const initializer=createGodotWorldInitializer({worldsRoot,domain,selection:async()=>worldId,firstLoad:async(...args)=>loads.push(args),initialLoadBridge:()=>replacement});
 const originalPreserved=()=>{for(const [name,bytes] of originals)assert.deepEqual(fs.readFileSync(path.join(directory,name)),bytes);assert.deepEqual(fs.readFileSync(path.join(directory,'managed-base.json')),metadata);assert.deepEqual(source.get('player-content.txt'),originals.get('player-content.txt'));};
 return {initializer,worldId,calls,loads,source,originalPreserved};
}
test('explicit retry repairs only the known bridge in a new checked candidate',async()=>{
 const f=fixture();await f.initializer.start(f.worldId,{recover:true});assert.equal(f.initializer.error(f.worldId),null);
 assert.deepEqual(f.source.get('craftmine_shared/runtime_bridge.gd'),newBridge);assert.deepEqual(f.loads,[[f.worldId,'repaired-candidate']]);
 assert.equal(f.calls.filter(c=>c.method==='godotProject.applyFiles').length,1);assert.equal(f.calls.filter(c=>c.method==='godotBuild.start').length,1);f.originalPreserved();
});
test('automatic startup does not rewrite an old project',async()=>{
 const f=fixture();await f.initializer.start(f.worldId);assert.equal(f.calls.some(c=>c.method==='godotProject.applyFiles'),false);assert.deepEqual(f.source.get('craftmine_shared/runtime_bridge.gd'),oldBridge);f.originalPreserved();
});
test('custom bridge is preserved and never silently overwritten',async()=>{
 const f=fixture({custom:true});await f.initializer.start(f.worldId,{recover:true});assert.match(f.initializer.error(f.worldId),/GODOT_INITIAL_BRIDGE_CUSTOMIZED/);assert.equal(f.calls.some(c=>c.method==='godotProject.applyFiles'),false);assert.equal(f.loads.length,0);f.originalPreserved();
});
test('retry does not recreate files removed after the project was checked',async()=>{
 const f=fixture({missing:true});await f.initializer.start(f.worldId,{recover:true});assert.match(f.initializer.error(f.worldId),/GODOT_INITIAL_SOURCE_MISSING/);assert.equal(f.calls.some(c=>c.method==='godotProject.applyFiles'),false);assert.equal(f.source.has('player-content.txt'),false);assert.equal(f.loads.length,0);
});
test('already playable and changed initialization owners cannot be repaired',async()=>{
 for(const options of [{playable:true},{changedOwner:true}]){const f=fixture(options);await f.initializer.start(f.worldId,{recover:true});assert.equal(f.calls.some(c=>c.method==='godotProject.applyFiles'),false);assert.equal(f.loads.length,0);f.originalPreserved();}
});
test('bad replacement bytes and failed fresh check cannot be adopted',async()=>{
 for(const options of [{replacement:Buffer.from('wrong bundled bridge')},{failCheck:true}]){const f=fixture(options);await f.initializer.start(f.worldId,{recover:true});assert.ok(f.initializer.error(f.worldId));assert.equal(f.loads.length,0);f.originalPreserved();}
});
