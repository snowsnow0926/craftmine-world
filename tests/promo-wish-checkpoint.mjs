// Two explicit, zero-model stages. Never copy profiles or reset old budgets.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCompleteOutput} from './godot-final/complete-contract.mjs';
import {resolveCreationNativeLaunch} from './helpers/creation-native-launch.mjs';
import {createCheckpointController} from './helpers/checkpoint-native-controller.mjs';
import {parseCheckpointArgs,readCheckpointJson,inspectCheckpointSource,assertProofs,archiveProof,fileProof,checkpointWorld,compareCheckpoint} from './helpers/promo-checkpoint-contract.mjs';

const options=parseCheckpointArgs(process.argv.slice(2));
const exported=options.phase==='restore'?readCheckpointJson(options.input):null;
if(exported){assert.equal(exported.format,'craftmine.promo-checkpoint/1');assert.equal(exported.phase,'export');assert.equal(exported.ok,true);}
const source=inspectCheckpointSource(exported?.adoptionReport??options.input);
if(exported)assertProofs(exported.sourceProofs);
const packagedRoot=options.packagedRoot??source.original.packageIdentity?.packaged;
assert.ok(packagedRoot&&path.isAbsolute(packagedRoot),'CHECKPOINT_PACKAGE_REQUIRED');
const client=resolveCreationNativeLaunch({root:process.cwd(),packagedRoot});
const diagnostic=client.identity.inventorySha256!==source.original.packageIdentity.inventorySha256;
if(options.phase==='export'&&diagnostic)assert.ok(options.diagnosticReason?.trim(),'CHECKPOINT_DIAGNOSTIC_REASON_REQUIRED');
const out=createCompleteOutput(process.cwd()),directory=out;
const report={format:'craftmine.promo-checkpoint/1',phase:options.phase,trialKind:'checkpoint-derived',startedAt:new Date().toISOString(),adoptionReport:exported?.adoptionReport??options.input,
 originalReport:source.adoption.originalReport,sourceProofs:source.proofs,sourceTrialBudget:{limit:10,reserved:10,remaining:0},
 packageIdentity:client.identity,originalPackageInventory:source.original.packageIdentity.inventorySha256,changedProduct:diagnostic,
 diagnosticReason:options.diagnosticReason??null,modelRequestsAdded:0,modelInitialization:false,sourceEdits:0,scope:'product backup/restore only; not original-trial autonomous success',
 nextTrial:{limit:10,initialized:false,sessionId:null,taskLeaseCheck:'NOT_RUN; a later model trial must create a new session and verify its normal task lease'},ok:false};
let controller,profile,token;const extraProofs=[];
const save=()=>fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
async function start(paths){
 controller=createCheckpointController({client,...paths,record:report});await controller.start();
 await controller.until(()=>controller.nav('world.list'),value=>value.activeWorldId&&value.worlds?.some(world=>world.id===value.activeWorldId),'default selected world');
}
async function select(worldId){
 const list=await controller.nav('world.list');assert.ok(list.worlds.some(world=>world.id===worldId),'CHECKPOINT_WORLD_MISSING');
 if(list.activeWorldId!==worldId){const switched=await controller.nav('world.switch',{id:worldId});assert.notEqual(switched?.ok,false,'CHECKPOINT_SWITCH_FAILED');}
 return controller.until(()=>controller.rpc('godotObserve'),value=>value.worldId===worldId&&value.instanceId,'actual rebuilt world',900000);
}
async function capture(worldId){
 const observation=await controller.rpc('godotObserve');assert.equal(observation.worldId,worldId);
 const snapshot=await controller.rpc('godotSnapshot'),history=await controller.nav('godot.historyLoad',{worldId});
 return checkpointWorld({observation,snapshot,history});
}
try{
 if(options.phase==='export'){
  profile=source.profile;token=source.token;
  await start({out:source.out,profile,token});
  const observed=await select(source.adoption.worldId);assert.equal(observed.buildId,source.adoption.after.buildId,'CHECKPOINT_FORMAL_BUILD_CHANGED');
  report.saved=await controller.panel('godot.runtimeSave',{worldId:observed.worldId,freeze:true});
  report.checkpoint=await capture(observed.worldId);assert.equal(report.checkpoint.buildId,observed.buildId);
  report.exportReceipt=await controller.panel('backup.export',{worldId:observed.worldId,operationId:'checkpoint-export-'+randomUUID()});
  assert.equal(report.exportReceipt.status,'completed');assert.equal(report.exportReceipt.credentialsIncluded,false);
  const selected=path.join(source.out,'portable-backup.craftmine');
  const actual=await archiveProof(selected);assert.equal(actual.bytes,report.exportReceipt.bytes,'CHECKPOINT_ARCHIVE_BYTES');
  const retained=path.join(directory,'portable-backup.craftmine');fs.copyFileSync(selected,retained,fs.constants.COPYFILE_EXCL);
  report.archive=await archiveProof(retained);assert.equal(report.archive.sha256,actual.sha256);
  report.archiveHash=report.exportReceipt.archiveHash;
 }else{
  const archive=await archiveProof(exported.archive.path);assert.equal(archive.sha256,exported.archive.sha256,'CHECKPOINT_ARCHIVE_CHANGED');assert.equal(archive.bytes,exported.archive.bytes);
  report.parentExport={...fileProof(options.input),archiveSha256:archive.sha256,archiveHash:exported.archiveHash};
  extraProofs.push(fileProof(options.input));
  profile=path.join(out,'profile');const legacySource=path.join(out,'legacy');fs.mkdirSync(profile);fs.mkdirSync(legacySource);token=randomUUID();
  fs.writeFileSync(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource}));
  const markerProof=fileProof(path.join(profile,'headless-profile.json'));
  extraProofs.push(markerProof);
  const archivePath=path.join(out,'portable-backup.craftmine');fs.copyFileSync(archive.path,archivePath,fs.constants.COPYFILE_EXCL);
  report.archive=await archiveProof(archivePath);assert.equal(report.archive.sha256,archive.sha256);
  await start({out,profile,token});
  const initial=await controller.nav('world.list');report.replacedSelection=initial.activeWorldId;
  const grant=await controller.panel('backup.inspect',{worldId:initial.activeWorldId});
  assert.equal(grant.status,'ready');assert.equal(grant.bodiesVerified,true);assert.equal(grant.archiveHash,exported.archiveHash);
  report.inspection={status:grant.status,archiveHash:grant.archiveHash,counts:grant.counts,bytes:grant.bytes,bodiesVerified:grant.bodiesVerified};
  report.restoreReceipt=await controller.panel('backup.restore',{worldId:initial.activeWorldId,operationId:'checkpoint-restore-'+randomUUID(),grantId:grant.grantId,expectedCurrentHash:grant.expectedCurrentHash});
  assert.equal(report.restoreReceipt.status,'completed');assert.equal(report.restoreReceipt.activated,true);assert.equal(report.restoreReceipt.modelReplay,false);
  await select(exported.checkpoint.worldId);
  report.saved=await controller.panel('godot.runtimeSave',{worldId:exported.checkpoint.worldId,freeze:true});
  report.checkpoint=await capture(exported.checkpoint.worldId);
  report.comparison=compareCheckpoint(exported.checkpoint,report.checkpoint);
  report.newProfile={root:out,profile,markerSha256:markerProof.sha256,budgetFilePresent:fs.existsSync(path.join(profile,'creation-evaluation-budget.json'))};
  assert.equal(report.newProfile.budgetFilePresent,false,'CHECKPOINT_UNEXPECTED_EVALUATION_LEDGER');assertProofs([markerProof]);
  report.nextTrial.note='Fresh evaluator may later use limit 10. No evaluator/session/provider initialized here; inherited domain task/budget rows remain historical and untouched.';
 }
 await controller.stop();controller=null;assertProofs(source.proofs);client.assertUnchanged();report.ok=true;
}catch(error){
 report.ok=false;report.error=String(error.message);report.status=/EXPLICIT_RECOVERY_REQUIRED|LEASE|ACTIVE_TASK_EXISTS|RECOVERY|GODOT_HISTORY_READ_FAILED/.test(error.message)?'BLOCKED':'FAILED';process.exitCode=1;
}finally{
 if(controller)try{await controller.stop();}catch(error){report.ok=false;report.shutdownError=String(error.message);process.exitCode=1;}
 try{assertProofs([...source.proofs,...extraProofs]);if(options.phase==='restore'&&profile)assert.equal(fs.existsSync(path.join(profile,'creation-evaluation-budget.json')),false,'CHECKPOINT_UNEXPECTED_EVALUATION_LEDGER');report.originalEvidenceUnchanged=true;}catch(error){report.originalEvidenceUnchanged=false;report.ok=false;report.preservationError=String(error.message);process.exitCode=1;}
 try{client.assertUnchanged();}catch(error){report.ok=false;report.packageError=String(error.message);process.exitCode=1;}
 report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({phase:options.phase,ok:report.ok,status:report.status??(report.ok?'COMPLETED':'FAILED'),report:path.join(directory,'report.json'),modelRequestsAdded:0}));
}
