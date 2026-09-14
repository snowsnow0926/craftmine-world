import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {exportOperatorTemplate} from './helpers/product-template-export.mjs';

function fixture({oldNotice=false,cancel=false,error=false,changed=false,badHash=false,priorCompleteFile=false}={}){
 const complete=Buffer.from('unit fixture complete archive bytes'),partial=complete.subarray(0,7);
 const hash=createHash('sha256').update(complete).digest('hex');
 let state={assetId:'player.world.city',version:2,archiveSha256:hash,busy:false,completed:oldNotice,error:null},file=priorCompleteFile?complete:null,submitted=false,polls=0;
 const events=[];
 return {events,read:async()=>({...state}),submit:async()=>{events.push('submit');submitted=true;file=partial;state={...state,busy:true,completed:false};},
  until:async(read,accept)=>{for(let i=0;i<5;i++){
   const value=await read();events.push(state.busy?'ui-busy':'ui-terminal');if(accept(value))return value;
   assert(submitted);if(++polls===2){file=badHash?partial:complete;state={...state,busy:false,completed:!cancel&&!error,error:error?'EXPORT_WRITE_FAILED':null,...(changed?{version:3}:{})};}
  }throw Error('UNIT_POLL_EXHAUSTED');},
  readBytes:async()=>{events.push('read-bytes');assert(state.completed&&!state.busy);return file;},
  archive:async bytes=>{events.push('archive');assert.deepEqual(bytes,complete);return {file:'unit-archive.zip'};},
 };
}
test('partial target existence cannot trigger read or copy before actual export completion',async()=>{
 const ui=fixture(),result=await exportOperatorTemplate(ui,{assetId:'player.world.city',version:2});
 assert.deepEqual(ui.events,['submit','ui-busy','ui-busy','ui-terminal','read-bytes','archive']);
 assert.equal(result.version,2);assert(result.uiCompletion.completed);assert.equal(result.bytes,35);
});
test('old complete file is not reused before the new operation finishes',async()=>{
 const ui=fixture({priorCompleteFile:true});await exportOperatorTemplate(ui,{assetId:'player.world.city'});
 assert(ui.events.indexOf('read-bytes')>ui.events.lastIndexOf('ui-busy'));
});
test('old completion notice is refused until caller remounts the real template tab',async()=>{
 const ui=fixture({oldNotice:true,priorCompleteFile:true});await assert.rejects(exportOperatorTemplate(ui,{assetId:'player.world.city'}),/FRESH_UI_STATE/);assert.deepEqual(ui.events,[]);
});
test('export error, cancellation and changed selected version never read or archive bytes',async()=>{
 for(const option of [{error:true},{cancel:true},{changed:true}]){
  const ui=fixture(option);await assert.rejects(exportOperatorTemplate(ui,{assetId:'player.world.city'}));assert(!ui.events.includes('read-bytes'));assert(!ui.events.includes('archive'));
 }
});
test('UI completion alone cannot approve wrong final archive bytes',async()=>{
 const ui=fixture({badHash:true});await assert.rejects(exportOperatorTemplate(ui,{assetId:'player.world.city'}),/ARCHIVE_HASH_MISMATCH/);assert(ui.events.includes('read-bytes'));assert(!ui.events.includes('archive'));
});
