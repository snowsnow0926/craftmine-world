import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Read visible product state only; never replace React state or invoke a bridge.
export const templateExportReadScript=`(()=>{
 const section=document.querySelector('[data-local-world-templates]');
 const selected=section?.querySelector('[data-local-template-selected]');
 const details=selected?.querySelector('[data-template-compatibility]');
 const lines=Array.from(details?.querySelectorAll('p')??[],node=>node.textContent??'');
 const assetId=selected?.getAttribute('data-local-template-selected')??null;
 const ref=lines.find(line=>line.startsWith(assetId+' · v'));
 const version=ref?Number(ref.slice((assetId+' · v').length)):null;
 const archiveSha256=lines.find(line=>/^SHA256: [a-f0-9]{64}$/.test(line))?.slice(8)??null;
 const notices=Array.from(section?.querySelectorAll('[role="status"]')??[],node=>node.textContent??'');
 const error=section?.querySelector('[role="alert"]')?.textContent??null;
 const button=selected?.querySelector('[data-template-export] button');
 return {assetId,version,archiveSha256,error,busy:!button||button.disabled,completed:notices.includes('已导出世界模板 ZIP。')||notices.includes('World template ZIP exported.')};
})()`;

// Await a painted React update after the actual form submission, so cancellation
// cannot be confused with the pre-submit idle state. No real input is sent.
export const templateExportSubmitScript=`(async()=>{
 const form=document.querySelector('[data-template-export]');
 const button=form?.querySelector('button');if(!form||!button||button.disabled)throw Error('EXPORT_FORM_NOT_READY');
 form.requestSubmit();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true;
})()`;

/** The caller first remounts the ordinary template tab and reselects the version.
 * This gives the new operation an empty notice, even when exporting the same
 * asset again and the previous complete ZIP still exists. */
export async function exportOperatorTemplate(ui,{assetId,version}){
 const before=await ui.read();
 assert.equal(before.assetId,assetId,'EXPORT_SELECTED_ASSET_MISMATCH');
 assert(Number.isSafeInteger(before.version)&&before.version>0,'EXPORT_SELECTED_VERSION_REQUIRED');
 if(version!==undefined)assert.equal(before.version,version,'EXPORT_SELECTED_VERSION_MISMATCH');
 assert.match(before.archiveSha256??'',/^[a-f0-9]{64}$/,'EXPORT_SELECTED_ARCHIVE_HASH_REQUIRED');
 assert(!before.busy&&!before.completed&&!before.error,'EXPORT_REQUIRES_FRESH_UI_STATE');
 const identity={assetId:before.assetId,version:before.version,archiveSha256:before.archiveSha256};
 const verify=value=>{
  if(value.error)throw Error(value.error);
  for(const key of Object.keys(identity))assert.equal(value[key],identity[key],'EXPORT_SELECTION_CHANGED:'+key);
 };
 await ui.submit();
 const completed=await ui.until(async()=>{
  const value=await ui.read();verify(value);
  if(value.busy)return null;
  if(!value.completed)throw Error('EXPORT_CANCELLED_OR_NOT_COMPLETED');
  return value;
 },Boolean);
 // Files can exist while the native export is still writing. Do not read even
 // one byte until this operation has displayed the actual completion notice.
 const bytes=await ui.readBytes();assert(Buffer.isBuffer(bytes),'EXPORT_BYTES_REQUIRED');
 assert.equal(createHash('sha256').update(bytes).digest('hex'),identity.archiveSha256,'EXPORT_FINAL_ARCHIVE_HASH_MISMATCH');
 const confirmed=await ui.read();verify(confirmed);assert(confirmed.completed&&!confirmed.busy,'EXPORT_COMPLETION_CHANGED');
 const archived=await ui.archive(bytes);
 return {...archived,assetId:identity.assetId,version:identity.version,sha256:identity.archiveSha256,bytes:bytes.length,uiCompletion:completed};
}
