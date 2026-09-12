import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {createCraftmineEnginePerformanceSampler} from '../electron/main/craftmine-engine-performance-sample.ts';
import {readEnginePerformance} from '../electron/main/engine-performance-request.ts';
const require=createRequire(import.meta.url),{RESOURCES}=require('../../../../../plugins/craftmine-world/godot-engine-profile.cjs');
const sha=(b,algorithm='sha256')=>createHash(algorithm).update(b).digest(),digest=b=>sha(b).toString('hex');
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;},u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
const variant=text=>{const b=Buffer.from(text);return Buffer.concat([u32(4),u32(b.length),b,Buffer.alloc((4-b.length%4)%4)]);};
function pack(entries){
 const selectors=[['autoload/CraftmineRuntime','*res://craftmine_shared/runtime_bridge.gd'],['craftmine/runtime/adapter','res://craftmine_shared/base_adapter.gd']];
 const project=Buffer.concat([Buffer.from('ECFG'),u32(2),...selectors.flatMap(([key,value])=>{const b=variant(value);return[u32(Buffer.byteLength(key)),Buffer.from(key),u32(b.length),b];})]);
 entries=[...entries,{path:'project.binary',data:project}];
 const header=Buffer.alloc(112);for(const[at,value]of [[0,0x43504447],[4,4],[8,4],[12,7],[16,2],[20,2]])header.writeUInt32LE(value,at);
 header.writeBigUInt64LE(112n,24);let offset=0;const chunks=[],directory=[];
 for(const entry of entries){const b=Buffer.from(entry.data),name=Buffer.from(entry.path),padded=Buffer.concat([name,Buffer.alloc((4-name.length%4)%4)]);chunks.push(b);directory.push(Buffer.concat([u32(padded.length),padded,u64(offset),u64(b.length),sha(b,'md5'),u32(0)]));offset+=b.length;}
 header.writeBigUInt64LE(BigInt(112+offset),32);return Buffer.concat([header,...chunks,u32(entries.length),...directory]);
}
const version='4.7.2.stable.official.ed1daf0bf',clock=Date.parse('2026-09-12T03:00:00Z');
function sample(sequence){
 const measured=(monitor,unit,rawValue)=>({status:'measured',monitor,unit,rawValue}),unknown=(monitor,unit)=>({status:'unknown',monitor,unit});
 return{format:'craftmine.godot-engine-performance/1',profile:'engine-monitor/1',engineVersion:version,sequence,processFrame:200,physicsFrame:180,framesDrawn:0,monotonicUsec:3000000,
  paused:false,headless:true,debugBuild:false,editorHint:false,renderingMethod:'gl_compatibility',renderingDriver:'opengl3',sampledAt:new Date(clock).toISOString(),
  metrics:{processTime:measured('TIME_PROCESS','s',0.002),physicsTime:measured('TIME_PHYSICS_PROCESS','s',0.001),fps:measured('TIME_FPS','fps',60),objectCount:measured('OBJECT_COUNT','count',260),nodeCount:measured('OBJECT_NODE_COUNT','count',256),drawCalls:unknown('RENDER_TOTAL_DRAW_CALLS_IN_FRAME','count'),primitives:unknown('RENDER_TOTAL_PRIMITIVES_IN_FRAME','count'),gpuTime:unknown(null,'s')}};
}
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'engine-service-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const entries=Object.entries(RESOURCES).map(([name,relative])=>{const data='extends RefCounted\n# trusted mechanism fixture '+relative+'\n';fs.mkdirSync(path.dirname(path.join(directory,relative)),{recursive:true});fs.writeFileSync(path.join(directory,relative),data);return{path:name,data};});
 const files=entries.map(e=>({path:e.path,bytes:Buffer.byteLength(e.data),sha256:digest(e.data)}));
 const buffer=pack(entries),artifact={path:'web/game.pck',bytes:buffer.length,sha256:digest(buffer)};
 const identity={worldId:'world-a',buildId:'build-a',instanceId:'instance-a'};
 const descriptor={format:'craftmine.godot-runtime-descriptor/1',phase:'formal',worldId:'world-a',buildId:'build-a',root:directory,entry:'web/index.html',sourceRevision:4,manifestHash:'a'.repeat(64),artifactManifestHash:'b'.repeat(64),artifacts:[artifact],snapshot:{secret:'DO_NOT_FORWARD'}};
 const source={format:'craftmine.godot-export-source/1',worldId:'world-a',buildId:'build-a',sourceWorldId:'world-a',sourceRevision:4,repoId:'repo-a',contentOid:'c'.repeat(40),files,snapshot:{secret:'DO_NOT_FORWARD'}};
 const calls=[],state={identity,descriptor,source,buffer,sequence:0,now:clock,hook:async()=>{},reply:reply=>reply};
 const host={get instance(){return state.identity;},async enginePerformance(expected,nonce){calls.push('engine');await state.hook('engine');return state.reply({format:'craftmine.godot-engine-performance-envelope/1',profile:'engine-monitor/1',...expected,nonce,sample:sample(++state.sequence)});}};
 const deps={host:()=>host,resourcesRoot:directory,actualVersion:version,now:()=>state.now,
  describe:async()=>{calls.push('describe');await state.hook('describe');return state.descriptor;},
  exportSource:async()=>{calls.push('source');await state.hook('source');return state.source;},
  readPack:async desc=>{assert.equal(desc.snapshot,undefined);calls.push('pack');await state.hook('pack');return state.buffer;}};
 return{state,calls,deps,host,run:createCraftmineEnginePerformanceSampler(deps)};
}

test('real source/PCK gate runs before and after one nonce-bound sample without returning source/progress bodies',async t=>{
 const f=fixture(t),result=await f.run({worldId:'world-a'});
 assert.deepEqual(f.calls,['describe','source','pack','engine','describe','source','pack']);
 assert.equal(result.available,true);assert.match(result.nonce,/^[a-f0-9]{64}$/);assert.equal(result.instanceId,'instance-a');
 assert.equal(result.sourceRevision,4);assert.equal(result.packSha256,digest(f.state.buffer));assert.equal(result.observation.metrics.processTime.value,2);
 assert.equal(result.observation.metrics.gpuTime.status,'unknown');assert.match(result.boundary,/not isolation/);
 assert.equal(JSON.stringify(result).includes('DO_NOT_FORWARD'),false);assert.equal(result.files,undefined);assert.equal(result.snapshot,undefined);
 const again=await f.run();assert.notEqual(again.nonce,result.nonce);assert.equal(again.observation.sequence,2);
});
test('absent profile, missing/tampered source and bad artifacts cannot dispatch an engine request',async t=>{
 for(const mutate of [f=>{f.state.identity=null;},f=>fs.unlinkSync(path.join(f.deps.resourcesRoot,Object.values(RESOURCES)[0])),f=>{f.state.source.files.pop();},f=>{f.state.source.files[0].sha256='f'.repeat(64);},f=>{f.state.buffer=Buffer.from('damaged');},f=>{f.state.descriptor.artifacts.push({...f.state.descriptor.artifacts[0]});},f=>{f.state.source.sourceRevision=5;},f=>{f.state.descriptor.manifestHash='invalid';}]){
  const f=fixture(t);mutate(f);try{const result=await f.run();assert.equal(result.available,false);}catch(error){assert.match(error.message,/ENGINE_/);}
  assert.ok(!f.calls.includes('engine'));
 }
 const f=fixture(t);for(const input of [{worldId:'foreign'},{instanceId:'old'},{nonce:'a'.repeat(64)},{path:'C:/private'},[]])await assert.rejects(f.run(input));assert.deepEqual(f.calls,[]);
});
test('nonce/envelope/version/time/replay failures never project a measurement',async t=>{
 for(const change of [r=>({...r,nonce:'f'.repeat(64)}),r=>({...r,worldId:'other'}),r=>({...r,extra:true}),r=>({...r,format:'self-report'}),r=>({...r,sample:{...r.sample,engineVersion:'4.5'}}),r=>({...r,sample:{...r.sample,sampledAt:'2000-01-01T00:00:00Z'}})]){
  const f=fixture(t);f.state.reply=change;await assert.rejects(f.run());
 }
 const f=fixture(t);await f.run();f.state.sequence=0;await assert.rejects(f.run(),/REPLAY/);
});
test('post-request changes to instance/source/descriptor/PCK are rejected, including same-build restarts',async t=>{
 for(const mutate of [s=>{s.identity={...s.identity,instanceId:'next'};},s=>{s.descriptor.manifestHash='d'.repeat(64);},s=>{s.descriptor.artifactManifestHash='e'.repeat(64);},s=>{s.source.contentOid='f'.repeat(40);},s=>{s.source.files.push({path:'authored.gd',bytes:1,sha256:'f'.repeat(64)});},s=>{s.buffer=Buffer.from(s.buffer);s.buffer[112]^=1;},s=>{s.descriptor.root+='-other';},s=>{s.now+=31000;}]){
  const f=fixture(t);f.state.hook=async point=>{if(point==='engine')mutate(f.state);};await assert.rejects(f.run());assert.equal(f.calls.filter(x=>x==='engine').length,1);
 }
});
test('cancellation resolves pending reads without another dispatch or global job cancellation',async t=>{
 for(const phase of ['describe','source','pack','engine']){
  const f=fixture(t),abort=new AbortController();let release;f.state.hook=point=>point===phase?new Promise(resolve=>{release=resolve;}):Promise.resolve();
  const pending=f.run({}, {signal:abort.signal});while(!release)await new Promise(resolve=>setImmediate(resolve));abort.abort();
  await assert.rejects(pending,/ENGINE_PERFORMANCE_CANCELLED/);const calls=f.calls.length;release();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,calls);
 }
});
test('strict host route allows a frozen read while rejecting foreign nonce/identity, busy or replaced runtime',async()=>{
 const identity={worldId:'w',buildId:'b',instanceId:'i'},nonce='1'.repeat(64);let calls=0,busy=false,replace=false;
 let instance={...identity,alive:true,runtime:{request:async(op,args)=>{calls++;assert.equal(op,'engine-performance');assert.deepEqual(args,{nonce});if(replace)instance={...instance};return{result:{ok:true}};}}};
 const host={current:()=>instance,busy:()=>busy};assert.deepEqual(await readEnginePerformance(host,identity,nonce),{ok:true});
 for(const [who,n]of [[{...identity,worldId:'other'},nonce],[{...identity,extra:1},nonce],[identity,'A'.repeat(64)]])await assert.rejects(readEnginePerformance(host,who,n));assert.equal(calls,1);
 busy=true;await assert.rejects(readEnginePerformance(host,identity,nonce),/WORLD_BUSY/);assert.equal(calls,1);
 busy=false;replace=true;await assert.rejects(readEnginePerformance(host,identity,nonce),/INSTANCE_CHANGED/);
 const file=fs.readFileSync(new URL('../electron/main/godot-world-view-host.ts',import.meta.url),'utf8');assert.match(file,/op === "engine-performance"\) throw Error\("ENGINE_PERFORMANCE_PRIVATE_ROUTE"\)/);
});
