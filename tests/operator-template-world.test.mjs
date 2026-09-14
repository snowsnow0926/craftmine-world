import test from 'node:test';import assert from 'node:assert/strict';
import {validateOperatorTemplateCopy,assertOperatorTemplateSource,submitOperatorTemplateCopy,verifyOperatorTemplateCopy} from './helpers/operator-template-world.mjs';
const ref={assetId:'player.world.city',version:2,contentHash:'a'.repeat(64)},template={format:'craftmine.player-world-template/1',kind:'world',action:'create-new-world',initialState:'saved-progress',ref,archiveSha256:'b'.repeat(64)};
test('exact saved-progress template selection and ordinary form submission preserve source ref',async()=>{
  const state={assetId:ref.assetId,version:2,archiveSha256:template.archiveSha256,title:'default',createReady:true,busy:false},calls=[];
  const result=await submitOperatorTemplateCopy({read:async()=>({...state}),field:async(selector,title)=>{calls.push({selector,title});state.title=title;},submit:async selector=>calls.push({submit:selector}),until:async(read,accept)=>{const value=await read();assert(accept(value));return value;}},{ref,title:'独立副本'},template);
  assert.equal(calls.at(-1).submit,'[data-local-template-create]');assert.deepEqual(result.sourceRef,ref);assert.equal(result.initialState,'saved-progress');assert.equal(result.sentModelPrompt,false);
});
test('wrong archive/version or unsupported empty-progress intent never submits a template creation',async()=>{
  assert.throws(()=>validateOperatorTemplateCopy({ref,title:'copy',clearProgress:true}));assert.throws(()=>assertOperatorTemplateSource({...template,initialState:'empty'},ref));assert.throws(()=>assertOperatorTemplateSource({...template,ref:{...ref,version:3}},ref));
  let submitted=false;await assert.rejects(()=>submitOperatorTemplateCopy({read:async()=>({assetId:ref.assetId,version:2,archiveSha256:'c'.repeat(64)}),field:async()=>{},submit:async()=>{submitted=true;},until:async()=>{}},{ref,title:'copy'},template),/SELECTED_ARCHIVE_CHANGED/);assert.equal(submitted,false);
});
test('receipt requires a new ready world and unchanged original saved content',()=>{
  const oldIdentity={id:'old',title:'original',contentHash:'d'.repeat(64)},input={before:{worlds:[{id:'old'}]},after:{worlds:[{id:'old'},{id:'new',state:'ready'}]},oldWorldId:'old',newWorldId:'new',oldIdentity,newOldIdentity:{...oldIdentity}};
  assert.equal(verifyOperatorTemplateCopy(input).originalContentUnchanged,true);
  for(const change of [{newWorldId:'old'},{before:{worlds:[{id:'old'},{id:'new'}]}},{after:{worlds:[{id:'new',state:'ready'}]}},{newOldIdentity:{...oldIdentity,contentHash:'e'.repeat(64)}}])assert.throws(()=>verifyOperatorTemplateCopy({...input,...change}));
});
