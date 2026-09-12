import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {readGodotBuildWithWait:read}=require('../plugins/craftmine-world/godot-build-read-wait.cjs');
const {creationApplicationRecord:record,readCreationApplication:view,normalizeCreationApplication:normalize}=require('../plugins/craftmine-world/creation-application-state.cjs');
const context={projectId:'project',sessionId:'session',turnId:'turn'};
const params={context,worldId:'world',jobId:'gjob-'+'a'.repeat(64)};
const entry={...params,claim:{worldId:'world',buildId:'build'}};
const job={...params,buildId:'build',baseId:'creation-sandbox',kind:'check',status:'passed',candidateId:'candidate'};
function fixture(){let clock=0,state='applying',active=true,selected=true,reads=0;return {
 get reads(){return reads;},get clock(){return clock;},set state(value){state=value;},set active(value){active=value;},set selected(value){selected=value;},
 options:{params,waitMs:1000,core:{call:async()=>{reads++;return job;}},readCompletion:()=>view(record(entry,state,null,'candidate'),params,{live:true}),now:()=>clock,pause:async ms=>{clock+=ms;state='applied';},assertActive:()=>{if(!active)throw Error('TURN_ENDED');},assertSelected:async()=>{if(!selected)throw Error('WORLD_CHANGED');}},
};}
test('a passed check waits until the same authorized host application settles',async()=>{
 const f=fixture(),result=await read(f.options);
 assert.equal(result.status,'passed');assert.equal(result.creationApplication.status,'applied');assert.equal(result.waitedMs,500);assert.equal(f.reads,2);
});
test('application deadline preserves pending state without extending authority or claiming applied',async()=>{
 const f=fixture();const result=await read({...f.options,waitMs:0});
 assert.equal(result.waitReason,'application-pending');assert.equal(result.creationApplication.status,'applying');assert.equal(f.reads,1);
});
test('elapsed application deadline keeps the last actual receipt',async()=>{
 const f=fixture();let clock=0;const result=await read({...f.options,waitMs:800,now:()=>clock,pause:async ms=>{clock+=ms;}});
 assert.equal(result.waitReason,'application-pending');assert.equal(result.creationApplication.status,'applying');assert.equal(result.waitedMs,800);
});
for(const state of ['manual','failed','cancelled','interrupted'])test('terminal application '+state+' stays distinct from the passed check',async()=>{
 const f=fixture();f.state=state;const result=await read(f.options);assert.equal(result.status,'passed');assert.equal(result.creationApplication.status,state);assert.equal(f.reads,1);
});
test('cancel and switch during handoff reject even an applied late reply',async()=>{
 for(const key of ['active','selected']){const f=fixture();await assert.rejects(read({...f.options,pause:async()=>{f[key]=false;f.state='applied';}}),/TURN_ENDED|WORLD_CHANGED/);assert.equal(f.reads,1);}
});
test('wrong application job, world, build or candidate cannot complete this read',async()=>{
 for(const change of [{jobId:'other'},{worldId:'other'},{buildId:'other'},{candidateId:'other'},{status:'invented'},{status:'applied',candidateId:null}]){const f=fixture();await assert.rejects(read({...f.options,readCompletion:()=>({...f.options.readCompletion(),...change})}),/APPLICATION_IDENTITY_CHANGED/);}
});
test('missing old receipt is unknown and never reconstructed as an application',async()=>{
 const f=fixture(),result=await read({...f.options,readCompletion:()=>null});assert.equal(result.creationApplication.status,'unknown');assert.equal(f.reads,1);
});
test('restart preserves completed diagnostics and interrupts pending receipts without running anything',()=>{
 for(const status of ['pending','applying'])assert.equal(normalize(record(entry,status),{restart:true}).status,'interrupted');
 for(const status of ['applied','manual','failed','cancelled'])assert.equal(normalize(record(entry,status,null,'candidate'),{restart:true}).status,status);
 assert.equal(normalize({status:'applied'}),null);
});
test('receipts are bound to original owner and corrupted or uncertain records never claim success',()=>{
 const applied=record(entry,'applied',null,'candidate');
 assert.equal(view(applied,{...params,context:{...context,turnId:'other'}}),null);
 assert.equal(view(applied,{...params,worldId:'other'}),null);
 assert.equal(view(applied,params,{ledgerError:'disk-full'}).status,'interrupted');
 assert.equal(view(record(entry,'applying'),params).status,'interrupted');
 assert.equal(normalize({...applied,context:{...context,script:'untrusted'}}),null);
});

for(const status of ['deferred','repairing'])test('host '+status+' is visible and never misreported as applied',async()=>{
 const f=fixture();f.state=status;const result=await read(f.options);assert.equal(result.creationApplication.status,status);assert.equal(result.waitReason,'terminal');
 assert.equal(normalize(record(entry,status),{restart:true}).status,status);
});
