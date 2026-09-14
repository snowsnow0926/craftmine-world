import assert from 'node:assert/strict';
import {templateExportReadScript} from './product-template-export.mjs';
export function validateOperatorTemplateCopy(input){
  assert(input&&Object.keys(input).every(key=>['ref','title'].includes(key)),'TEMPLATE_COPY_ARGUMENTS_REQUIRED');
  const ref=input.ref;assert(ref&&Object.keys(ref).every(key=>['assetId','version','contentHash'].includes(key)),'TEMPLATE_COPY_REF_REQUIRED');
  assert(/^player\.world\.[a-z0-9_-]+$/.test(ref.assetId)&&Number.isSafeInteger(ref.version)&&ref.version>0&&/^[a-f0-9]{64}$/.test(ref.contentHash),'TEMPLATE_COPY_EXACT_REF_REQUIRED');
  assert(typeof input.title==='string'&&input.title.trim()&&input.title.trim().length<=80,'TEMPLATE_COPY_TITLE_REQUIRED');
  return {ref:{...ref},title:input.title.trim()};
}
export function assertOperatorTemplateSource(template,ref){
  assert.equal(template?.format,'craftmine.player-world-template/1');assert.equal(template.kind,'world');assert.equal(template.action,'create-new-world');assert.equal(template.initialState,'saved-progress','TEMPLATE_COPY_SAVED_PROGRESS_REQUIRED');
  assert.deepEqual(template.ref,ref,'TEMPLATE_COPY_REF_CHANGED');assert(/^[a-f0-9]{64}$/.test(template.archiveSha256),'TEMPLATE_COPY_ARCHIVE_HASH_REQUIRED');return template;
}
export const templateCopyReadScript=`(()=>{const identity=${templateExportReadScript};const form=document.querySelector('[data-local-template-create]');return {...identity,title:form?.querySelector('[data-template-world-title]')?.value??null,createReady:!!form&&!form.querySelector('button:disabled'),entryError:document.querySelector('[data-world-entry-error]')?.textContent??null};})()`;
export async function submitOperatorTemplateCopy({read,field,submit,until},input,template){
  const {ref,title}=validateOperatorTemplateCopy(input);assertOperatorTemplateSource(template,ref);
  const check=state=>{if(state.error||state.entryError)throw Error(state.error||state.entryError);assert.equal(state.assetId,ref.assetId,'TEMPLATE_COPY_SELECTED_ASSET_CHANGED');assert.equal(state.version,ref.version,'TEMPLATE_COPY_SELECTED_VERSION_CHANGED');assert.equal(state.archiveSha256,template.archiveSha256,'TEMPLATE_COPY_SELECTED_ARCHIVE_CHANGED');return state;};
  check(await read());await field('[data-template-world-title]',title);
  const selection=await until(async()=>check(await read()),state=>state.title===title&&state.createReady&&!state.busy);
  await submit('[data-local-template-create]');return {sourceRef:{...ref},archiveSha256:template.archiveSha256,initialState:template.initialState,title,selection,submission:'ordinary-world-template-create',sentModelPrompt:false};
}
export function verifyOperatorTemplateCopy({before,after,oldWorldId,newWorldId,oldIdentity,newOldIdentity}){
  assert(newWorldId&&newWorldId!==oldWorldId,'TEMPLATE_COPY_MUST_CREATE_DISTINCT_WORLD');
  assert(!before.worlds.some(row=>row.id===newWorldId),'TEMPLATE_COPY_TARGET_ALREADY_EXISTED');
  assert(after.worlds.some(row=>row.id===oldWorldId),'TEMPLATE_COPY_ORIGINAL_WORLD_MISSING');
  assert(after.worlds.some(row=>row.id===newWorldId&&row.state==='ready'),'TEMPLATE_COPY_TARGET_NOT_READY');
  assert.equal(oldIdentity.id,oldWorldId);assert.equal(newOldIdentity.id,oldWorldId);assert.equal(newOldIdentity.contentHash,oldIdentity.contentHash,'TEMPLATE_COPY_ORIGINAL_CONTENT_CHANGED');
  assert.equal(newOldIdentity.title,oldIdentity.title,'TEMPLATE_COPY_ORIGINAL_TITLE_CHANGED');
  return {oldWorldId,newWorldId,originalWorldRetained:true,originalContentUnchanged:true,oldIdentity,newOldIdentity};
}
