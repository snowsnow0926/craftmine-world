import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
export const retryHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function retryStartupStatusReady(status){
  assert.deepEqual(status?.violations,[],'RETRY_STARTUP_VIOLATIONS');
  assert(Array.isArray(status.windows),'RETRY_STARTUP_WINDOWS_REQUIRED');
  // Controller readiness precedes window creation. Check every window that
  // exists immediately; an empty early sample is pending, not a failure.
  assert(status.windows.every(window=>window.visible===false&&window.focused===false&&window.focusable===false&&window.offscreen===true),'RETRY_UNSAFE_STARTUP_WINDOW');
  return status.windows.length>0&&status.runtime?.hostAvailable===true&&status.runtime?.plugins?.includes('craftmine.world')===true;
}
export function waitForRetryStartup({until,readStatus}){return until(readStatus,retryStartupStatusReady);}
function unlinked(directory){
  assert.equal(fs.realpathSync(directory).toLowerCase(),path.resolve(directory).toLowerCase(),'RETRY_PROFILE_LINK_DENIED');
  const walk=dir=>{for(const entry of fs.readdirSync(dir)){const file=path.join(dir,entry),stat=fs.lstatSync(file);assert(!stat.isSymbolicLink(),'RETRY_PROFILE_LINK_DENIED');if(stat.isDirectory())walk(file);}};walk(directory);
}
export function validateOperatorRetryProfile(originalFile,worldId){
  assert(path.isAbsolute(originalFile)&&/^[a-z0-9][a-z0-9-]{1,47}$/.test(worldId),'RETRY_ABSOLUTE_REPORT_WORLD_REQUIRED');
  const bytes=fs.readFileSync(originalFile),original=JSON.parse(bytes),owner=path.resolve(path.dirname(originalFile));
  assert.equal(original.format,'craftmine.product-agent-operator/1');assert.equal(path.resolve(original.out),owner);
  assert.equal(path.basename(path.dirname(owner)),'test-results');assert(path.basename(owner).startsWith('desktop-native-product-'));
  assert(original.error&&original.normalShutdown===true&&original.finalIntegrity?.status==='passed','RETRY_RETAINED_FAILED_CLOSED_REPORT_REQUIRED');
  assert(Array.isArray(original.turns)&&original.turns.length===0,'RETRY_ZERO_MODEL_PROFILE_REQUIRED');
  const priorReports=fs.readdirSync(owner).filter(name=>name==='report.json'||/^continuation-.*\.json$/.test(name));
  for(const name of priorReports){const row=JSON.parse(fs.readFileSync(path.join(owner,name)));assert.equal(path.resolve(row.out),owner);assert(row.normalShutdown===true,'RETRY_CONTROLLER_MUST_BE_CLOSED');assert(Array.isArray(row.turns)&&row.turns.length===0,'RETRY_ZERO_MODEL_PROFILE_REQUIRED');}
  const profile=path.join(owner,'profile');unlinked(profile);
  const marker=JSON.parse(fs.readFileSync(path.join(profile,'headless-profile.json')));
  assert.equal(marker.format,'craftmine.headless-profile/1');assert(typeof marker.token==='string'&&marker.token.length>0);
  assert.equal(path.resolve(marker.legacySource),path.join(owner,'legacy'),'RETRY_OWNED_LEGACY_REQUIRED');unlinked(marker.legacySource);
  const worldDirectory=path.join(profile,'godot-worlds',worldId),creation=JSON.parse(fs.readFileSync(path.join(worldDirectory,'.creation-owner.json')));
  assert.equal(creation.worldId,worldId,'RETRY_WORLD_OWNER_CHANGED');
  assert.equal(creation.baseId,'creation-sandbox','RETRY_BLANK_GODOT_WORLD_REQUIRED');assert.equal(creation.templateId,'blank','RETRY_BLANK_GODOT_WORLD_REQUIRED');
  return {owner,profile,marker,originalReportSha256:retryHash(bytes),originalFile,worldId,worldDirectory,priorReports};
}
export function retainedInitializationEvidence(profile,worldId){
  const directory=path.join(profile,'godot-worlds',worldId),managedBytes=fs.readFileSync(path.join(directory,'managed-base.json')),metadata=JSON.parse(managedBytes);
  assert.equal(metadata.worldId,worldId);assert.equal(metadata.format,'craftmine.managed-base-source/1');
  const managedFiles=metadata.files.map(file=>{
    assert(typeof file.path==='string'&&!file.path.includes('\\')&&!file.path.includes(':')&&file.path.split('/').every(part=>part&&part!=='.'&&part!=='..'),'RETRY_MANAGED_PATH_INVALID');
    const bytes=fs.readFileSync(path.join(directory,file.path));assert.equal(bytes.length,file.bytes);assert.equal(retryHash(bytes),file.sha256);
    return {path:file.path,bytes:bytes.length,sha256:file.sha256};
  });
  const db=new DatabaseSync(path.join(profile,'plugins/data/craftmine.world/tasks.sqlite'),{readOnly:true});
  let data;try{
    const source=db.prepare('SELECT revision,hash,manifest FROM craftmine_godot_projects WHERE world_id=?').get(worldId);assert(source,'RETRY_EXISTING_SOURCE_REQUIRED');
    const manifest=JSON.parse(source.manifest);
    data={source:{revision:source.revision,manifestHash:source.hash,files:Object.entries(manifest.files).map(([name,file])=>({path:name,bytes:file.bytes,sha256:file.sha256}))},
      init:db.prepare('SELECT id,world_id,status,reason,application_id,snapshot_hash FROM craftmine_godot_world_init WHERE world_id=?').get(worldId),
      jobs:db.prepare('SELECT id,world_id,kind,status,build_id,manifest_hash,source_revision,output_hash,created_at,updated_at FROM craftmine_godot_jobs WHERE world_id=? ORDER BY created_at,id').all(worldId),
      candidates:db.prepare('SELECT id,world_id,build_id,manifest_hash,source_revision,check_job_id,check_output_hash,status FROM craftmine_godot_candidates WHERE world_id=? ORDER BY created_at,id').all(worldId),
      applications:db.prepare('SELECT id,world_id,candidate_id,build_id,status,output_hash,created_at,updated_at FROM craftmine_godot_applications WHERE world_id=? ORDER BY created_at,id').all(worldId)};
  }finally{db.close();}
  const host=new DatabaseSync(path.join(profile,'pi.sqlite'),{readOnly:true});
  try{data.chat={messageIds:host.prepare('SELECT id FROM messages ORDER BY id').all().map(row=>row.id),turnIds:host.prepare('SELECT id FROM turns ORDER BY id').all().map(row=>row.id)};}finally{host.close();}
  return {...data,managed:{manifestSha256:retryHash(managedBytes),files:managedFiles}};
}
export function assertRetainedInitializationRecovery(before,after,worldId){
  assert.deepEqual(after.managed,before.managed,'RETRY_MANAGED_SOURCE_CHANGED');
  assert.deepEqual(after.source,before.source,'RETRY_CANONICAL_SOURCE_CHANGED');
  assert.deepEqual(after.chat,before.chat,'RETRY_UNEXPECTED_CHAT_OR_MODEL_TURN');
  assert.equal(after.init?.world_id,worldId);assert.equal(after.init?.id,before.init?.id,'RETRY_INITIALIZATION_ID_CHANGED');
  assert.equal(after.init?.status,'confirmed','RETRY_INITIAL_LOAD_NOT_CONFIRMED');
  const old=new Set(before.jobs.map(job=>job.id));
  const job=after.jobs.find(job=>!old.has(job.id)&&job.world_id===worldId&&job.kind==='check'&&job.status==='passed'&&job.manifest_hash===before.source.manifestHash&&job.source_revision===before.source.revision&&/^[a-f0-9]{64}$/.test(job.output_hash));assert(job,'RETRY_NEW_PASSED_CHECK_REQUIRED');
  const candidate=after.candidates.find(row=>row.world_id===worldId&&row.status==='applied'&&row.check_job_id===job.id&&row.build_id===job.build_id&&row.manifest_hash===job.manifest_hash&&row.source_revision===job.source_revision&&row.check_output_hash===job.output_hash);assert(candidate,'RETRY_MATCHING_CHECKED_CANDIDATE_REQUIRED');
  const application=after.applications.find(row=>row.world_id===worldId&&row.id===after.init.application_id&&row.candidate_id===candidate.id&&row.build_id===job.build_id&&row.status==='applied'&&/^[a-f0-9]{64}$/.test(row.output_hash));assert(application,'RETRY_CANONICAL_APPLIED_RECEIPT_REQUIRED');
  return {job,candidate,application,sourceUnchanged:true,managedUnchanged:true,chatUnchanged:true};
}
export function initializationRetryUiScript(worldId,submit=false){
  assert(/^[a-z0-9][a-z0-9-]{1,47}$/.test(worldId));
  return `(()=>{
    if(!globalThis.__craftmineHeadless)throw Error('RETRY_OWNED_RENDERER_REQUIRED');
    const rows=[...document.querySelectorAll('[data-world-recovery]')].filter(row=>row.dataset.worldRecovery===${JSON.stringify(worldId)}),row=rows[0],buttons=row?[...row.querySelectorAll('[data-world-recovery-action="retry"]')]:[],button=buttons[0];
    const props=button&&button[Object.keys(button).find(key=>key.startsWith('__reactProps$'))];
    const visible=!!button&&button.getClientRects().length>0&&getComputedStyle(button).visibility!=='hidden'&&!button.closest('[inert], [aria-hidden="true"]');
    const result={worldId:${JSON.stringify(worldId)},rows:rows.length,buttons:buttons.length,ready:rows.length===1&&buttons.length===1&&visible&&!button.disabled&&typeof props?.onClick==='function',error:row?.querySelector('[data-world-recovery-error]')?.textContent??null,text:row?.textContent??null};
    ${submit?`if(!result.ready)throw Error('RETRY_ORDINARY_BUTTON_UNAVAILABLE');props.onClick();result.submitted=true;`:''}
    return result;
  })()`;
}
export function initializationRecoveryMode(row,ui){
  if(row?.state==='ready')return 'already-ready-at-startup';
  if(row?.state==='initializing')return 'ordinary-continue-preparation';
  if(['failed','cancelled','interrupted'].includes(row?.state)&&ui?.ready)return 'ordinary-react-retry';
  return null;
}
export function initializationEntryUiScript(worldId,action='read'){
  assert(/^[a-z0-9][a-z0-9-]{1,47}$/.test(worldId));assert(['read','continue','open'].includes(action));
  return `(()=>{
    if(!globalThis.__craftmineHeadless)throw Error('RETRY_OWNED_RENDERER_REQUIRED');
    const forms=[...document.querySelectorAll('[data-world-open]')].filter(form=>form.dataset.worldOpen===${JSON.stringify(worldId)}),form=forms[0];
    const buttons=[...document.querySelectorAll('[data-world-continue]')].filter(button=>button.dataset.worldContinue===${JSON.stringify(worldId)}),button=buttons[0];
    const props=node=>node?.[Object.keys(node).find(key=>key.startsWith('__reactProps$'))];
    const visible=node=>!!node&&node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden'&&!node.closest('[inert], [aria-hidden="true"]');
    const state={entryOpen:!!document.querySelector('.app-shell.craftmine-mode-entry-open'),continueCount:buttons.length,continueReady:buttons.length===1&&visible(button)&&!button.disabled&&typeof props(button)?.onClick==='function',openCount:forms.length,openReady:forms.length===1&&visible(form)&&!form.querySelector('button:disabled')&&typeof props(form)?.onSubmit==='function'};
    ${action==='continue'?`if(!state.continueReady)throw Error('RETRY_PREPARATION_CONTROL_UNAVAILABLE');props(button).onClick();state.submitted='continue';`:action==='open'?`if(!state.openReady)throw Error('RETRY_WORLD_OPEN_UNAVAILABLE');props(form).onSubmit({preventDefault(){},target:form,currentTarget:form});state.submitted='open';`:''}
    return state;
  })()`;
}
export async function prepareAndEnterRetainedWorld({mode,continuePreparation,retry,waitReady,enter}){
  assert(['ordinary-continue-preparation','ordinary-react-retry','already-ready-at-startup'].includes(mode),'RETRY_RECOVERY_MODE_REQUIRED');
  if(mode==='ordinary-continue-preparation')await continuePreparation();
  if(mode==='ordinary-react-retry')await retry();
  await waitReady();return enter();
}
