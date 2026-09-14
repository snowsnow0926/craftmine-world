import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {verifyAppliedProgress,auditPromoApplications,auditClosedSavedProgress} from './helpers/direct-library-application-audit.mjs';
import {preservePriorComponents,observeLiveComponents,compareColdLiveProgress} from './helpers/direct-library-progress.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/promo-heavyblade-progress-LuT318.json',import.meta.url)));
const row=fixture.application,identity={worldId:row.world_id,candidateId:row.candidate_id,buildId:row.build_id};

test('real archived application preserves every old component while a later live freeze genuinely differs',()=>{
  const proof=verifyAppliedProgress(row,identity);
  assert.equal(proof.progress.previousComponentIds.length,8);assert.equal(proof.progress.addedComponentIds.length,1);
  preservePriorComponents(fixture.beforeLive,{state:proof.before});
  assert.throws(()=>preservePriorComponents(fixture.beforeLive,fixture.afterLive),/PRIOR_COMPONENT_CHANGED/,'keep the original pose mismatch visible');
  const live=observeLiveComponents(fixture.beforeLive,fixture.afterLive);assert.equal(live.changedComponentIds.length,6);
  assert.equal(live.scope,'live-after-UI-and-simulation');
});

test('a pose reset still fails even if both migrated input and returned output repeat the same reset',()=>{
  for(const key of ['position','yaw','health']){
    const changed=structuredClone(row),input=JSON.parse(changed.input),output=JSON.parse(changed.output);
    const id='promo-monster-088593e7afa8f56988a1a1af';
    const reset=key==='position'?[4,0,-17]:key==='yaw'?0:60;
    input.snapshot.body.components[id][key]=reset;output.snapshot.body.components[id][key]=reset;
    if(input.progressMigration?.snapshot)input.progressMigration.snapshot.body.components[id][key]=reset;
    changed.input=JSON.stringify(input);changed.output=JSON.stringify(output);
    assert.throws(()=>verifyAppliedProgress(changed,identity),/PRIOR_COMPONENT_CHANGED/);
  }
});

test('player resets, missing old components and forged receipt identity remain failures',()=>{
  const changed=structuredClone(row),input=JSON.parse(changed.input),output=JSON.parse(changed.output);
  input.snapshot.body.player.position=[0,.9,0];output.snapshot.body.player.position=[0,.9,0];
  if(input.progressMigration?.snapshot)input.progressMigration.snapshot.body.player.position=[0,.9,0];
  changed.input=JSON.stringify(input);changed.output=JSON.stringify(output);
  assert.throws(()=>verifyAppliedProgress(changed,identity),/PLAYER_CHANGED_DURING_INSTALL/);
  assert.throws(()=>verifyAppliedProgress({...row,status:'prepared'},identity));
  assert.throws(()=>verifyAppliedProgress(row,{...identity,candidateId:'wrong'}));
  const live=structuredClone(fixture.afterLive);delete live.state.body.components['promo-monster-088593e7afa8f56988a1a1af'];
  assert.throws(()=>observeLiveComponents(fixture.beforeLive,live),/LIVE_COMPONENT_MISSING/);
});

test('SQLite audit refuses a live or uncleanly closed profile before opening any database',()=>{
  for(const launches of [[],[{}],[{exit:{code:1}}]])assert.throws(()=>auditPromoApplications({launches,out:'does-not-exist'}),/APPLICATION_AUDIT_REQUIRES_NORMAL_CLOSED_PROFILE/);
});

test('closed-Core save audit requires the complete exact persisted snapshot',()=>{
  const root=path.resolve('test-results');fs.mkdirSync(root,{recursive:true});const out=fs.mkdtempSync(path.join(root,'closed-promo-save-'));
  const directory=path.join(out,'profile/plugins/data/craftmine.world');fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'tasks.sqlite'),snapshot=JSON.parse(row.output).snapshot;
  const write=value=>{const db=new DatabaseSync(file);db.exec('CREATE TABLE IF NOT EXISTS craftmine_worlds(id TEXT PRIMARY KEY, document TEXT NOT NULL)');db.prepare('INSERT OR REPLACE INTO craftmine_worlds VALUES(?,?)').run(identity.worldId,JSON.stringify({snapshot:value}));db.close();};
  write(snapshot);const report={out,launches:[{exit:{code:0}}],saved:{worldId:identity.worldId,state:snapshot}};
  assert.equal(auditClosedSavedProgress(report).exactlyEqual,true);
  const changed=structuredClone(snapshot);changed.body.player.position[0]+=1;write(changed);
  assert.throws(()=>auditClosedSavedProgress(report),/CLOSED_CORE_SAVED_PROGRESS_CHANGED/);
});

test('cold live pose differences remain visible and unconfirmed while persistent health/config stay strict',()=>{
  const saved={...fixture.beforeLive,state:JSON.parse(row.output).snapshot};
  const cold=compareColdLiveProgress(saved,fixture.afterLive,{payload:{creation:{physicsTick:25}}});
  assert.equal(cold.fullSnapshotEqual,false);assert.equal(cold.exactNativePoseRestore,'unconfirmed-after-resume');
  assert(cold.unconfirmedFields.some(row=>row.path.endsWith('.position')));assert.match(cold.fullDifference,/COLD_PROGRESS_CHANGED/);
  const hurt=structuredClone(fixture.afterLive),id='promo-monster-088593e7afa8f56988a1a1af';hurt.state.body.components[id].health=89;
  assert.throws(()=>compareColdLiveProgress(saved,hurt,{payload:{creation:{physicsTick:25}}}),/COLD_PERSISTENT_VALUE_CHANGED/);
  assert.throws(()=>compareColdLiveProgress(saved,fixture.afterLive,{payload:{creation:{physicsTick:0}}}),/COLD_CHANGED_WITHOUT_FRAME_EVIDENCE/);
  assert.throws(()=>compareColdLiveProgress(saved,fixture.afterLive,{}),/COLD_PHYSICS_EVIDENCE_REQUIRED/);
});
