import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {readCheckpointJson,fileProof,assertProofs} from './promo-checkpoint-contract.mjs';
import {readHeadlessProfile} from '../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless-profile.ts';

const samePath=(a,b)=>path.resolve(a)===path.resolve(b);
const contained=(parent,child)=>{const relative=path.relative(fs.realpathSync(parent),fs.realpathSync(child));assert.ok(relative&&!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep),'PLAYER_RECOVERY_PATH_ESCAPE');};
const clean=report=>{assert.ok(Array.isArray(report.launches)&&report.launches.length>0);for(const launch of report.launches){for(const key of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(launch.audit?.[key],[],'PLAYER_RECOVERY_AUDIT_FAILED');assert.equal(launch.exit?.code,0);assert.equal(launch.exit?.signal,null);}assert.equal(report.shutdownError,undefined);};
const sourceIdentity=value=>{assert.ok(Number.isSafeInteger(value?.revision)&&/^[a-f0-9]{64}$/.test(value?.manifestHash),'PLAYER_RECOVERY_SOURCE_REQUIRED');return{revision:value.revision,manifestHash:value.manifestHash};};
const observe=(value,worldId,buildId)=>{assert.equal(value?.worldId,worldId);assert.equal(value?.buildId,buildId);assert.equal(typeof value?.instanceId,'string');};
/** Follow explicit report provenance; never guess a profile by walking ancestors. */
export function inspectPlayerSource(sourceFile,{createSession=false}={}){
 const files=new Set(),read=file=>{assert.ok(path.isAbsolute(file));files.add(file);return readCheckpointJson(file);};
 const source=read(sourceFile),worldId=source.worldId;
 let out=path.dirname(sourceFile),recoveryBinding;
 if(['craftmine.prefab-check-recovery/1','craftmine.prefab-reopen-verification/1'].includes(source.format)){
  assert.equal(createSession,true,'PLAYER_RECOVERY_CREATE_SESSION_REQUIRED');
  const reopened=source.format==='craftmine.prefab-reopen-verification/1'?source:null;
  const recoveryFile=reopened?reopened.originalReport:sourceFile;
  if(reopened)assert.ok(samePath(reopened.sourceReport,recoveryFile),'PLAYER_RECOVERY_SOURCE_LINK_CHANGED');
  const recovery=reopened?read(recoveryFile):source;
  assert.equal(recovery.format,'craftmine.prefab-check-recovery/1');assert.equal(recovery.worldId,worldId);clean(recovery);
  for(const r of [source,recovery]){assert.equal(r.role,'developer-arranged-prefab-demo');assert.equal(r.modelCalls,0);assert.equal(r.sourceEdits,0);assert.equal(r.installationRetries,0);assert.deepEqual(r.unresolvedInstallations,[]);}
  assert.equal(source.ok,true,'PLAYER_RECOVERY_NOT_COMPLETE');clean(source);
  if(reopened){assert.equal(reopened.checksIssued,0);assert.equal(reopened.noModelExecution?.modelCallsAdded,0);assert.match(reopened.packageIdentity?.inventorySha256,/^[a-f0-9]{64}$/);assert.equal(reopened.packageIdentity.inventorySha256,recovery.packageIdentity?.inventorySha256);if(recovery.ok!==true)assert.match(recovery.error,/WORLD_BUSY/,'PLAYER_RECOVERY_UNRELATED_FAILURE');}
  assert.equal(source.error,undefined);
  const original=read(recovery.originalReport);out=path.dirname(recovery.originalReport);
  assert.equal(original.format,'craftmine.builtin-prefab-demo/1');assert.equal(original.worldId,worldId);assert.equal(original.modelCalls,0);assert.equal(original.creationEvaluation,false);
  if(original.sourceReport){assert.ok(samePath(path.dirname(original.sourceReport),out));const root=read(original.sourceReport);assert.equal(root.format,original.format);assert.equal(root.worldId,worldId);assert.equal(root.modelCalls,0);assert.equal(root.creationEvaluation,false);}
  for(const file of [sourceFile,recoveryFile])contained(out,file);
  const intentFile=recovery.recheckIntent?.file;assert.equal(typeof intentFile,'string');contained(path.join(out,'profile'),intentFile);
  const intent=read(intentFile),last=original.installations?.at(-1);
  assert.equal(intent.worldId,worldId);assert.equal(intent.applyRequest?.operation?.operationId,last?.operationId);assert.equal(intent.archiveSha256,last?.archiveSha256);
  assert.equal(intent.job?.jobId,recovery.recheckIntent.originalJobId);assert.deepEqual(intent.instanceIds,recovery.recheckIntent.instanceIds);
  const expectedSource=sourceIdentity(intent.receipt);
  for(const v of [recovery.sourceBefore,recovery.sourceAfter])assert.equal(v.worldId,worldId);
  for(const value of [recovery.recheckIntent.source,recovery.sourceBefore,recovery.sourceAfter,recovery.instanceSourceBefore,recovery.instanceSourceAfter])assert.deepEqual(sourceIdentity(value),expectedSource,'PLAYER_RECOVERY_SOURCE_CHANGED');
  for(const r of [recovery.instanceSourceBefore,recovery.instanceSourceAfter]){assert.equal(r.worldId,worldId);assert.equal(r.truncated,false);}
  assert.deepEqual(recovery.instanceSourceBefore.items.map(v=>v.entityId).sort(),recovery.instanceSourceAfter.items.map(v=>v.entityId).sort());
  for(const item of original.installations.slice(0,-1)){assert.equal(item.applied?.status,'applied');assert.equal(item.applied.worldId,worldId);assert.equal(item.finished?.status,'passed');}
  const expectedComponents=original.installations.map((item,index)=>({assetId:item.assetId,instanceIds:index===original.installations.length-1?intent.instanceIds:item.installed.instanceIds}));
  for(const r of [source,recovery])assert.deepEqual(r.completedComponents,expectedComponents,'PLAYER_RECOVERY_COMPONENTS_CHANGED');
  const ids=expectedComponents.flatMap(item=>item.instanceIds);assert.equal(new Set(ids).size,ids.length);
  const job=recovery.checkedJob,candidate=recovery.candidate?.candidate,buildId=recovery.finalBuild;
  assert.equal(job?.status,'passed');assert.equal(job.sourceStale,false);assert.equal(job.worldId,worldId);assert.equal(job.jobId,recovery.checkRequest?.jobId);assert.notEqual(job.jobId,intent.job.jobId);
  for(const v of [job,recovery.checkRequest,candidate]){assert.equal(v.worldId,worldId);assert.equal(v.buildId,buildId);assert.equal(v.sourceRevision,expectedSource.revision);assert.equal(v.manifestHash,expectedSource.manifestHash);}
  assert.equal(candidate.checkJobId,job.jobId);assert.equal(recovery.candidate.checkStatus,'passed');assert.ok(recovery.candidate.check?.assertions?.length&&recovery.candidate.check.assertions.every(v=>v.passed===true));
  assert.equal(recovery.applied?.status,'applied');assert.equal(recovery.applied.worldId,worldId);assert.equal(recovery.applied.candidateId,candidate.candidateId);assert.equal(recovery.applied.record?.world?.build?.id,buildId);
  assert.equal(recovery.saved?.worldId,worldId);assert.equal(recovery.saved?.buildId,buildId);
  if(reopened)assert.equal(reopened.expectedBuild,buildId);
  observe(source.before,worldId,reopened?buildId:recovery.expectedBuild);observe(source.reopened,worldId,buildId);assert.notEqual(source.before.instanceId,source.reopened.instanceId);assert.equal(source.saved?.buildId,buildId);assert.equal(source.saved?.worldId,worldId);
  if(source.profileRoot)assert.ok(samePath(source.profileRoot,path.join(out,'profile')),'PLAYER_RECOVERY_PROFILE_CHANGED');
  recoveryBinding={recoveryFile,originalReport:recovery.originalReport,worldId,buildId,branchId:recovery.sourceAfter.branchId,...expectedSource};
 }
 const profile=path.join(out,'profile'),markerFile=path.join(profile,'headless-profile.json'),marker=read(markerFile);
 readHeadlessProfile({CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:out,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:marker.token});
 const sessionId=source.sessionId??source.session?.sessionId??source.latest?.record?.session?.id;
 assert.equal(typeof worldId,'string');
 if(createSession){assert.equal(sessionId,undefined,'Reuse the existing session instead of creating a replacement');if(!recoveryBinding){assert.equal(source.format,'craftmine.builtin-prefab-demo/1');assert.equal(source.ok,true,'Complete the prefab demo before model follow-up');assert.equal(source.stateIntegrityVerified,true);}}
 else assert.equal(typeof sessionId,'string','Existing session required');
 const proofs=[...files].map(fileProof);assertProofs(proofs);
 return{source,out,profile,markerFile,marker,worldId,sessionId,recoveryBinding,proofs};
}
