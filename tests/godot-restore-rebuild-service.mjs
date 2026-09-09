// Bounded service orchestration fixtures; actual archive/Git/core transactions
// are exercised by portable_restore_rebuilds_applied_source_without_losing_progress_or_drafts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const dependencyRoot=process.env.CRAFTMINE_NATIVE_DEPENDENCY_ROOT||root;
const {build}=createRequire(path.join(dependencyRoot,'vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
const out=fs.mkdtempSync(path.join(root,'test-results/rebuild-service-'));
await build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/godot-restore-rebuild-service.ts')],outfile:path.join(out,'service.mjs'),bundle:true,platform:'node',format:'esm'});
const {createGodotRestoreRebuildService}=await import(pathToFileURL(path.join(out,'service.mjs')));
for(const scenario of ['ready','blocked','wrong-candidate']) {
  const calls=[];let created=false,applied=false;
  const snapshot={format:'craftmine.godot-progress/1',worldId:'world-a',body:{inventory:{ore:17},quests:{intro:'finished'}}};
  const record={revision:8,world:{build:{id:'old-formal'},snapshot}};
  const plan=()=>({rebuildRequired:!applied,formalBuildId:'old-formal',repoId:'repo-a',contentOid:'old-formal-oid',rebuildBranchId:'restore-branch',rebuildContentOid:created?'recovery-oid':null});
  const service=createGodotRestoreRebuildService({selection:async()=>'world-a',domain:async(method,args)=>{
    calls.push({method,args});
    if(method==='content.status')return {backend:'git',headOid:'new-unpublished-draft'};
    if(method==='godotWorld.prepareRebuildSource')return {copied:false};
    if(method==='godotWorld.prepareCopyRuntime')return {copied:false};
    if(method==='godotWorld.rebuildPlan')return plan();
    if(method==='world.read')return structuredClone(record);
    if(method==='content.branch.create'){assert.equal(args.fromRev,'old-formal-oid');created=true;return {};}
    if(method==='turn.begin'||method==='workspace.endTurn')return {};
    if(method==='godotProject.index'){assert.equal(args.branchId,'restore-branch');return {revision:4,manifestHash:'hash'};}
    if(method==='godotBuild.start'){assert.equal(args.branchId,'restore-branch');assert.equal(args.mode,'check');return {jobId:'job-a'};}
    if(method==='godotBuild.read')return scenario==='blocked'?{status:'blocked',blockedReason:'NO_EXECUTOR'}:{status:'passed',candidateId:'candidate-a'};
    if(method==='godotCandidate.read')return {candidate:{content:{repoId:'repo-a',branchId:'restore-branch',contentOid:scenario==='wrong-candidate'?'different':'recovery-oid'}}};
    if(method==='godotRuntime.describe'){assert.equal(applied,true);return {buildId:'new-build',snapshot:structuredClone(snapshot)};}
    throw Error('UNEXPECTED_METHOD:'+method);
  },restoreLoad:async(world,candidate)=>{assert.equal(world,'world-a');assert.equal(candidate,'candidate-a');applied=true;}});
  const promise=service.start('world-a');assert.equal(service.start('world-a'),promise);
  if(scenario==='ready') {assert.equal((await promise).status,'ready');assert.equal(service.status('world-a').rebuilt,true);}
  else {await assert.rejects(promise,scenario==='blocked'?/NO_EXECUTOR/:/GODOT_REBUILD_CANDIDATE_MISMATCH/);assert.equal(applied,false);assert.equal(service.status('world-a').status,'failed');}
  assert.equal(calls.findLast(call=>call.method==='workspace.endTurn').args.status,scenario==='ready'?'completed':'error');
  assert.equal(calls.some(call=>call.method==='world.saveProgress'||call.method==='godotProject.create'||call.method==='godotProject.patch'),false);
  fs.writeFileSync(path.join(out,scenario+'.json'),JSON.stringify(calls,null,2));
  console.log('PASS '+scenario+' orchestration; progress/source never replaced');
}
console.log('Evidence: '+out);
