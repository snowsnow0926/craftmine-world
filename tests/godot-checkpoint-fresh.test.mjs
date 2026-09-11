// Executes the actual host checkpoint method with controlled persistence.
// No constructor, Electron process, runtime launch, OS input, or disk-store claim.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {stripTypeScriptTypes} from 'node:module';
const source=fs.readFileSync(new URL('../vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host.ts',import.meta.url),'utf8');
const compiled=stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import[\s\S]*?from ["'][^"']+["'];\s*/gm,'').replace(/^export /gm,'');
const context={module:{exports:{}}};vm.runInNewContext(compiled+'\nmodule.exports.checkpoint=GodotWorldViewHost.prototype.checkpoint;',context);
const checkpoint=context.module.exports.checkpoint;
function fixture({paused=true}={}){
 let latest=1,revision=0,failure=false,gate=null;const events=[],instance={alive:true};
 const host={current:instance,stagedRequest:null,frozen:null,savePromise:null,checkpointPromise:null,pauseIntentRevision:new Map(),pauseController:{manualPaused:()=>paused},
  async pause(){events.push('pause');paused=true;this.pauseIntentRevision.set(instance,(this.pauseIntentRevision.get(instance)??0)+1);},
  async resume(){events.push('resume');paused=false;},identityOf:()=>({worldId:'world',buildId:'build',instanceId:'instance'}),publish(){},
  async save(){events.push('save');if(gate)await gate;if(failure)return {status:'failed',error:'SAVE_FAILED'};return {status:'persisted',receipt:{revision:++revision},snapshot:{value:latest}};},
 };
 return {host,events,run:options=>checkpoint.call(host,options),latest:value=>latest=value,fail:value=>failure=value,gate:value=>gate=value};
}
test('default keeps the frozen confirmation; fresh captures latest progress without resuming',async()=>{
 const f=fixture(),first=await f.run();f.latest(2);assert.equal(await f.run(),first);assert.deepEqual(f.events,['pause','save']);
 const second=await f.run({fresh:true});assert.equal(second.snapshot.value,2);assert.equal(second.receipt.revision,2);assert.equal(await f.run(),second);assert.deepEqual(f.events,['pause','save','pause','save']);
});
test('failed fresh invalidates old success and subsequent default cannot return the stale receipt',async()=>{
 const f=fixture(),old=await f.run();f.fail(true);assert.equal((await f.run({fresh:true})).status,'failed');assert.equal(f.host.frozen,null);
 assert.equal((await f.run()).status,'failed');assert.equal(f.events.filter(event=>event==='save').length,3);assert.ok(!f.events.includes('resume'));
 f.fail(false);f.latest(3);const recovered=await f.run();assert.notEqual(recovered,old);assert.equal(recovered.snapshot.value,3);
});
test('a refused fresh attempt also invalidates its previous cached success',async()=>{
 const f=fixture(),old=await f.run();f.host.stagedRequest={};assert.equal((await f.run({fresh:true})).status,'failed');assert.equal(f.host.frozen,null);f.host.stagedRequest=null;f.latest(4);const next=await f.run();assert.notEqual(next,old);assert.equal(next.snapshot.value,4);
});
test('concurrent fresh/default callers share one actual in-flight transaction',async()=>{
 const f=fixture();await f.run();let release;f.gate(new Promise(resolve=>release=resolve));f.latest(9);
 const first=f.run({fresh:true}),second=f.run(),third=f.run({fresh:true});await Promise.resolve();assert.equal(f.host.frozen,null);release();
 const results=await Promise.all([first,second,third]);assert.ok(results.every(result=>result===results[0]));assert.equal(results[0].snapshot.value,9);assert.equal(f.events.filter(event=>event==='save').length,2);assert.ok(!f.events.includes('resume'));
});
for(const paused of [false,true])test('fresh persistence failure retains original '+(paused?'paused':'playing')+' intent',async()=>{
 const f=fixture({paused});f.fail(true);assert.equal((await f.run({fresh:true})).status,'failed');assert.equal(f.host.pauseController.manualPaused(),paused);assert.equal(f.events.filter(event=>event==='resume').length,paused?0:1);
});
