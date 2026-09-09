// Narrow host protocol tests with an explicit in-memory core/runner fixture.
// No claim of native launch, durable Rust storage, or real model acceptance.
// CRAFTMINE_ADDITIVE_HOST_ROOT selects the integrated host source read-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const ownRoot=path.resolve(import.meta.dirname,'../..');
const sourceRoot=path.resolve(process.env.CRAFTMINE_ADDITIVE_HOST_ROOT??ownRoot);
const hostFile=path.join(sourceRoot,'vendor/pi-desktop/apps/desktop/electron/main/godot-candidate-coordinator.ts');
const sharedFile=path.join(sourceRoot,'desktop/godot/shared/progress-migration.mjs');
const {createGodotCandidateCoordinator}=await import(pathToFileURL(hostFile));
const {deriveAdditiveProgress}=await import(pathToFileURL(sharedFile));
const clone=value=>JSON.parse(JSON.stringify(value));
const hash=value=>createHash('sha256').update(value).digest('hex');
console.log(JSON.stringify({scope:'fixed-host-protocol',sourceRoot,files:[hostFile,sharedFile].map(file=>({path:file,sha256:hash(fs.readFileSync(file))}))}));
const captured=JSON.parse(fs.readFileSync(path.join(ownRoot,'docs/dispatch-reports/godot-final/core/evidence/additive-native-peer-replay.json'),'utf8'));

function fixture(){
 const worldId=captured.previous.worldId,candidateId='candidate-fixture',events=[],records=new Map();
 const trustedDefaults=clone(captured.defaults);
 let returnedDefaults=clone(trustedDefaults),latest=clone(captured.previous),pending=null,sequence=0;
 const formal={id:worldId,revision:11,world:{build:{id:'old-build'},snapshot:clone(latest)}};
 const host={instance:{worldId,buildId:'old-build',instanceId:'formal-original'},candidateInstance:null,
  async holdSelectionSync(){events.push('hold');return()=>events.push('release');},
  async pause(){events.push('pause');},async resume(){events.push('resume');},
  async stageCandidate(descriptor){events.push('stage');pending=clone(descriptor.snapshot);this.candidateInstance={worldId,buildId:descriptor.buildId,instanceId:`candidate-${++sequence}`};},
  async candidateRequest(op){if(op!=='save')return {};const state=clone(pending),snapshotText=JSON.stringify(state);return {status:'confirmed',state,runnerReceipt:{format:'craftmine.godot-runner-receipt/1',...this.candidateInstance,snapshotText,snapshotSha256:hash(snapshotText),bytes:Buffer.byteLength(snapshotText)}};},
  async discardCandidate(){pending=null;this.candidateInstance=null;events.push('discard');},
  setCandidateVisible(){},setSurfaceVisible(){},
  async checkpoint(){formal.world.snapshot=clone(latest);formal.revision++;events.push('checkpoint');return {status:'persisted',receipt:{revision:formal.revision},snapshot:clone(latest)};},
  async promoteCandidate(){events.push('promote');this.instance=this.candidateInstance;this.candidateInstance=null;}
 };
 const adapter={async describe(){return {phase:'formal',worldId,buildId:formal.world.build.id,revision:formal.revision,snapshot:clone(formal.world.snapshot)};},
  async describeCandidate(_world,id){const record=records.get(id);return {phase:'candidate',worldId,buildId:record.buildId,applicationId:id,applicationInputHash:record.inputHash,revision:record.input.revision,snapshot:clone(record.input.snapshot)};}};
 const domain=async(method,args)=>{
  events.push({method,args:clone(args)});
  if(method==='godotCandidate.read')return {candidate:{},job:{check:{defaultsSnapshot:clone(returnedDefaults),progressMigration:clone(captured.migration)}}};
  if(method==='godotApplication.prepare'){
   // Independent trusted defaults remain separate from candidate-read payload.
   assert.deepEqual(args.snapshot,formal.world.snapshot);
   assert.equal(args.revision,formal.revision);
   const migration=deriveAdditiveProgress(args.snapshot,trustedDefaults);
   const input={revision:args.revision,previousSnapshot:clone(args.snapshot),snapshot:migration.snapshot,progressMigration:migration};
   const record={id:args.id,worldId,candidateId,buildId:'new-build',status:'prepared',input,inputHash:hash(JSON.stringify(input))};
   records.set(args.id,record);return clone(record);
  }
  if(method==='godotApplication.read')return clone(records.get(args.id));
  if(method==='godotApplication.abort'){const record=records.get(args.id);record.status='aborted';return clone(record);}
  if(method==='godotApplication.commit'){
   const record=records.get(args.id);assert.equal(args.evidence.inputHash,record.inputHash);
   assert.deepEqual(args.evidence.snapshot,record.input.snapshot);
   assert.deepEqual(formal.world.snapshot,record.input.previousSnapshot);
   formal.world.snapshot=clone(record.input.snapshot);formal.world.build.id=record.buildId;formal.revision++;
   record.status='applied';record.output=clone(args.evidence);return clone(record);
  }
  if(method==='content.status')return {backend:'legacy'};
  if(method==='world.read')return clone(formal);
  throw Error(`Unexpected fixture method ${method}`);
 };
 return {worldId,candidateId,formal,events,records,host,
  coordinator:createGodotCandidateCoordinator({host,adapter,domain,selection:async()=>worldId}),
  play(){latest.body.targets[0].damageTaken+=3;latest.body.targets[0].hitCount+=2;latest.body.inventory.protocolMarker={retained:17};return clone(latest);},
  forgeDefaults(){const added=returnedDefaults.body.targets.find(entry=>!captured.previous.body.targets.some(old=>old.id===entry.id));assert.ok(added);added.health+=500;},
  mutatePreview(){pending.body.inventory.previewOnly='must be discarded';}
 };
}

test('apply re-derives from latest checkpoint instead of check-time or preview progress',async()=>{
 const f=fixture(),args={worldId:f.worldId,candidateId:f.candidateId};
 await f.coordinator.invoke('godot.candidatePreview',args);
 const latest=f.play();f.mutatePreview();
 const result=await f.coordinator.invoke('godot.candidateApply',args);
 const expected=deriveAdditiveProgress(latest,captured.defaults).snapshot;
 assert.equal(result.status,'applied');assert.deepEqual(result.record.world.snapshot,expected);
 const calls=f.events.filter(event=>event?.method==='godotApplication.prepare');
 assert.equal(calls.length,2);assert.deepEqual(calls[0].args.snapshot,captured.previous);
 assert.deepEqual(calls[1].args.snapshot,latest);assert.equal(calls[1].args.revision,12);
 assert.equal(result.record.world.snapshot.body.inventory.previewOnly,undefined);
 assert.deepEqual(result.record.world.snapshot.body.inventory.protocolMarker,{retained:17});
 assert.equal(f.host.instance.instanceId,'candidate-2');assert.equal(f.coordinator.blocking,false);
});

test('candidate defaults differing from the independently bound core result cannot stage or promote',async()=>{
 const f=fixture();f.forgeDefaults();
 await assert.rejects(f.coordinator.invoke('godot.candidatePreview',{worldId:f.worldId,candidateId:f.candidateId}),/GODOT_APPLICATION_PREPARE_MISMATCH/);
 assert.deepEqual(f.formal.world.snapshot,captured.previous);assert.equal(f.formal.world.build.id,'old-build');
 assert.ok(!f.events.includes('stage'));assert.ok(!f.events.includes('promote'));
 assert.ok([...f.records.values()].every(record=>record.status==='aborted'));
 assert.equal(f.coordinator.blocking,false);assert.ok(f.events.includes('resume'));
});

test('renderer cannot supply defaults or a migration proof through the candidate action',async()=>{
 const f=fixture();
 for(const key of ['defaultsSnapshot','progressMigration','snapshot']) {
  await assert.rejects(f.coordinator.invoke('godot.candidatePreview',{worldId:f.worldId,candidateId:f.candidateId,[key]:captured.defaults}),/INVALID_GODOT_CANDIDATE_ACTION/);
 }
 assert.equal(f.records.size,0);assert.equal(f.coordinator.blocking,false);
});
