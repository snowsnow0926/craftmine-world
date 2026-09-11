import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readHeadlessProfile} from '../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-headless-profile.ts';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function parseCheckpointArgs(args){
 const [phase,input,...rest]=args;
 assert.ok(['export','restore'].includes(phase)&&input&&path.isAbsolute(input),'CHECKPOINT_USAGE: export|restore <absolute report> [--packaged-root <absolute path>] [--diagnostic-reason <reason>]');
 const result={phase,input};
 for(let i=0;i<rest.length;i+=2){
  const flag=rest[i],value=rest[i+1];
  assert.ok(['--packaged-root','--diagnostic-reason'].includes(flag)&&value&&!value.startsWith('--'),'CHECKPOINT_ARGUMENTS');
  const key=flag==='--packaged-root'?'packagedRoot':'diagnosticReason';assert.equal(result[key],undefined,'CHECKPOINT_DUPLICATE_ARGUMENT');result[key]=value;
 }
 if(result.packagedRoot)assert.ok(path.isAbsolute(result.packagedRoot),'CHECKPOINT_ABSOLUTE_PACKAGE_REQUIRED');
 if(phase==='restore')assert.ok(result.packagedRoot,'CHECKPOINT_RESTORE_EXPLICIT_PACKAGE_REQUIRED');
 return result;
}
export function readCheckpointJson(file){
 assert.ok(path.isAbsolute(file),'CHECKPOINT_ABSOLUTE_PATH_REQUIRED');
 const info=fs.lstatSync(file);assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.size<16*1024*1024,'CHECKPOINT_REPORT_FILE');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
export function fileProof(file){return {path:file,sha256:hash(fs.readFileSync(file))};}
export function assertProofs(proofs){for(const proof of proofs)assert.equal(fileProof(proof.path).sha256,proof.sha256,'CHECKPOINT_SOURCE_CHANGED: '+proof.path);}
export async function archiveProof(file){
 const info=fs.lstatSync(file);assert.ok(info.isFile()&&!info.isSymbolicLink(),'CHECKPOINT_ARCHIVE_FILE');
 const digest=createHash('sha256');for await(const chunk of fs.createReadStream(file))digest.update(chunk);
 const after=fs.statSync(file);assert.ok(info.size===after.size&&info.mtimeMs===after.mtimeMs,'CHECKPOINT_ARCHIVE_CHANGED');
 return {path:file,bytes:after.size,sha256:digest.digest('hex')};
}
export function inspectCheckpointSource(adoptionFile){
 const adoption=readCheckpointJson(adoptionFile);assert.equal(adoption.format,'craftmine.promo-adoption/1');assert.equal(adoption.ok,true,'CHECKPOINT_ADOPTION_REQUIRED');
 const original=readCheckpointJson(adoption.originalReport),out=path.dirname(adoption.originalReport),profile=path.join(out,'profile');
 assert.equal(original.format,'craftmine.promo-pilot/1');assert.equal(original.worldId,adoption.worldId);
 assert.equal(original.maxRequests,10);assert.equal(original.budget?.remaining,0,'CHECKPOINT_EXHAUSTED_TRIAL_REQUIRED');
 assert.ok(adoption.after?.buildId&&adoption.after.worldId===adoption.worldId,'CHECKPOINT_ADOPTED_IDENTITY');
 const markerFile=path.join(profile,'headless-profile.json'),marker=readCheckpointJson(markerFile);
 readHeadlessProfile({CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:out,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:marker.token});
 const budgetFile=path.join(profile,'creation-evaluation-budget.json'),budget=readCheckpointJson(budgetFile);
 assert.equal(budget.format,'craftmine.creation-evaluation-budget/1');assert.equal(budget.limit,10);
 assert.ok(Array.isArray(budget.requests)&&budget.requests.length===10&&new Set(budget.requests).size===10,'CHECKPOINT_EXHAUSTED_LEDGER_REQUIRED');
 return {adoption,original,out,profile,token:marker.token,proofs:[adoptionFile,adoption.originalReport,budgetFile,markerFile].map(fileProof)};
}
export function checkpointWorld({observation,snapshot,history}){
 assert.ok(observation?.worldId&&observation.buildId&&observation.instanceId&&snapshot?.state?.worldId===observation.worldId&&history?.worldId===observation.worldId,'CHECKPOINT_GODOT_WORLD_REQUIRED');
 return {worldId:observation.worldId,buildId:observation.buildId,instanceId:observation.instanceId,
  source:{branchId:history.branchId,appliedOid:history.appliedOid,headOid:history.headOid,sourceRevision:history.index?.revision??null,manifestHash:history.index?.manifestHash??null,
   scope:'appliedOid identifies the formal version; index describes the selected history branch, which may include later drafts'},
  progress:snapshot.state,progressSha256:hash(JSON.stringify(snapshot.state))};
}
export function compareCheckpoint(before,after){
 assert.equal(after.worldId,before.worldId,'CHECKPOINT_WORLD_ID_CHANGED');
 return {worldIdPreserved:true,oldBuild:before.buildId,newBuild:after.buildId,buildChanged:before.buildId!==after.buildId,
  sourceManifestPreserved:before.source.manifestHash===after.source.manifestHash,progressBytesPreserved:before.progressSha256===after.progressSha256,
  note:'Changed source/build can reflect product rebuild or managed-file migration; this comparison does not prove authored source equivalence or gameplay acceptance.'};
}
