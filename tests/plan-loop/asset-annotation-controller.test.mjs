import assert from 'node:assert/strict';
import {register,registerHooks} from 'node:module';
import test from 'node:test';
register(new URL('../../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
registerHooks({resolve(s,c,next){return s==='react'?{url:'annotation:react',shortCircuit:true}:next(s,c);},load(u,c,next){return u==='annotation:react'?{format:'module',source:'export const useEffect=()=>{},useMemo=()=>{},useSyncExternalStore=()=>{};',shortCircuit:true}:next(u,c);}});
const {createAssetLibraryController}=await import('../../vendor/pi-desktop/apps/desktop/src/components/craftmine/assets/use-asset-library.ts');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(){
 const calls=[],operations=new Map(),data={a:{tags:['initial'],favorite:false},b:{tags:['other'],favorite:false}};
 let intercept=null;
 const body=id=>({assetId:id,version:1,contentHash:`hash-${id}`,displayName:id,kind:'raw',mediaKind:'image',files:[],source:{origin:'fixture',license:'unknown',licenseStatus:'unverified'}});
 const call=async(method,payload)=>{
  calls.push({method,payload:structuredClone(payload)});
  if(intercept){const answer=intercept(method,payload);if(answer)return answer;}
  if(method==='asset.search')return {items:Object.keys(data).map(id=>({...body(id),...data[id]})).filter(x=>!payload.favoritesOnly||x.favorite),total:2};
  if(method==='asset.read')return {version_:body(payload.assetId),state:{indexed:true}};
  if(method==='asset.versions')return {items:[{version_:body(payload.assetId),state:{indexed:true}}],total:1};
  if(method==='asset.previewRead'||method==='asset.usage')return {items:[],total:0};
  if(method==='asset.annotate'){
   const previous=operations.get(payload.operationId);
   if(previous){assert.deepEqual(previous.payload,payload);return previous.result;}
   const metadata={...(payload.tags!==undefined?{tags:[...new Set(payload.tags)].sort()}:{}),...(payload.favorite!==undefined?{favorite:payload.favorite}:{})};
   Object.assign(data[payload.assetId],metadata);
   const result={assetId:payload.assetId,operationId:payload.operationId,metadata};operations.set(payload.operationId,{payload:structuredClone(payload),result});return result;
  }
  throw Error(method);
 };
 const controller=createAssetLibraryController(call);
 return {controller,calls,data,operations,body,intercept:fn=>{intercept=fn;}};
}
test('each new edit has a fresh operation, updates only browsing metadata and can clear tags',async()=>{
 const f=fixture(),c=f.controller;await c.search({scope:'local-library'});await c.select('a',1);const before=structuredClone(c.snapshot().selected);
 await c.annotate({assetId:'a',favorite:true});await c.annotate({assetId:'a',favorite:false});await c.annotate({assetId:'a',tags:[]});
 const edits=f.calls.filter(x=>x.method==='asset.annotate');assert.equal(new Set(edits.map(x=>x.payload.operationId)).size,3);
 assert.deepEqual(c.snapshot().selected,before);assert.deepEqual(c.snapshot().selectedMetadata,{assetId:'a',tags:[],favorite:false});assert.deepEqual(c.snapshot().annotationEdits,{});
 assert.ok(edits.every(x=>Object.keys(x.payload).every(k=>['assetId','operationId','tags','favorite'].includes(k))));
});
test('lost reply retries the frozen original ID and payload and prevents overtaking',async()=>{
 const f=fixture(),c=f.controller;await c.search({scope:'local-library'});await c.select('a',1);
 const input={assetId:'a',tags:['saved']};let once=true;
 f.intercept((method)=>{if(method==='asset.annotate'&&once){once=false;return Promise.reject(Error('REPLY_LOST'));}});
 await assert.rejects(c.annotate(input),/REPLY_LOST/);input.tags.push('mutated');
 await assert.rejects(c.annotate({assetId:'a',favorite:true}),/ASSET_ANNOTATION_PENDING/);
 const held=c.snapshot().annotationEdits.a;assert.ok(Object.isFrozen(held.request));assert.ok(Object.isFrozen(held.request.tags));
 await c.retryAnnotation('a');const edits=f.calls.filter(x=>x.method==='asset.annotate');assert.equal(edits.length,2);assert.deepEqual(edits[0],edits[1]);assert.deepEqual(f.data.a.tags,['saved']);
});
test('late annotation failure stays on the original asset and can be retried after returning',async()=>{
 const f=fixture(),c=f.controller;await c.search({scope:'local-library'});await c.select('a',1);const wait=deferred();
 f.intercept(method=>method==='asset.annotate'?wait.promise:null);
 const edit=c.annotate({assetId:'a',favorite:true});await Promise.resolve();await c.select('b',1);
 wait.reject(Error('LATE_REPLY_LOST'));await assert.rejects(edit,/LATE_REPLY_LOST/);
 assert.equal(c.snapshot().selected.version_.assetId,'b');assert.equal(c.snapshot().selectedMetadata.assetId,'b');assert.equal(c.snapshot().annotationEdits.b,undefined);assert.equal(c.snapshot().error,null);
 await c.select('a',1);assert.equal(c.snapshot().annotationEdits.a.error,'LATE_REPLY_LOST');f.intercept(null);await c.retryAnnotation('a');assert.equal(c.snapshot().selectedMetadata.favorite,true);
});
test('late annotation success does not switch the selected asset',async()=>{
 const f=fixture(),c=f.controller;await c.search({scope:'local-library'});await c.select('a',1);const wait=deferred();let payload;
 f.intercept((method,p)=>{if(method==='asset.annotate'){payload=p;return wait.promise;}});
 const edit=c.annotate({assetId:'a',favorite:true});await Promise.resolve();await c.select('b',1);
 f.data.a.favorite=true;wait.resolve({assetId:'a',operationId:payload.operationId,metadata:{favorite:true}});await edit;
 assert.equal(c.snapshot().selected.version_.assetId,'b');assert.deepEqual(c.snapshot().selectedMetadata,{assetId:'b',favorite:false,tags:['other']});
});
test('a late read for the previous selection cannot restore its detail or metadata',async()=>{
 const f=fixture(),c=f.controller;await c.search({scope:'local-library'});const wait=deferred();
 f.intercept((method,p)=>method==='asset.read'&&p.assetId==='a'?wait.promise:null);
 const old=c.select('a',1);await c.select('b',1);wait.resolve({version_:f.body('a'),state:{indexed:true}});await old;
 assert.equal(c.snapshot().selected.version_.assetId,'b');assert.equal(c.snapshot().selectedMetadata.assetId,'b');
});
test('removing a favorite can remove its card without losing the selected metadata',async()=>{
 const f=fixture(),c=f.controller;f.data.a.favorite=true;await c.search({scope:'local-library',favoritesOnly:true});await c.select('a',1);await c.annotate({assetId:'a',favorite:false});
 assert.equal(c.snapshot().cards.length,0);assert.equal(c.snapshot().selectedMetadata.favorite,false);assert.equal(c.snapshot().selected.version_.assetId,'a');
});
test('late previous-selection errors cannot replace the active detail error state',async()=>{
 const f=fixture(),c=f.controller;await c.search({scope:'local-library'});const wait=deferred();
 f.intercept((method,p)=>method==='asset.read'&&p.assetId==='a'?wait.promise:null);
 const old=c.select('a',1);await c.select('b',1);wait.reject(Error('OLD_READ_FAILED'));await assert.rejects(old,/OLD_READ_FAILED/);
 assert.equal(c.snapshot().selected.version_.assetId,'b');assert.equal(c.snapshot().error,null);assert.equal(c.snapshot().status,'ready');
});
test('duplicate retry joins the same active operation and a bad receipt remains retryable',async()=>{
 const f=fixture(),c=f.controller;await c.search({scope:'local-library'});await c.select('a',1);const wait=deferred();
 f.intercept(method=>method==='asset.annotate'?wait.promise:null);
 const first=c.annotate({assetId:'a',favorite:true});await Promise.resolve();const retry=c.retryAnnotation('a');assert.equal(first,retry);
 wait.resolve({assetId:'b',operationId:'wrong',metadata:{favorite:true}});await assert.rejects(first,/ASSET_ANNOTATION_RECEIPT_MISMATCH/);
 assert.equal(f.calls.filter(x=>x.method==='asset.annotate').length,1);assert.equal(c.snapshot().selectedMetadata.favorite,false);
 assert.ok(c.snapshot().annotationEdits.a);f.intercept(null);await c.retryAnnotation('a');assert.equal(c.snapshot().selectedMetadata.favorite,true);
});
test('a logical asset named constructor is not mistaken for a pending edit',async()=>{
 const f=fixture(),c=f.controller;f.data.constructor={tags:[],favorite:false};await c.search({scope:'local-library'});await c.select('constructor',1);
 await c.annotate({assetId:'constructor',favorite:true});assert.equal(c.snapshot().selectedMetadata.favorite,true);await c.retryAnnotation('constructor');
 assert.equal(f.calls.filter(x=>x.method==='asset.annotate').length,1);
});
test('a confirmed edit releases its write slot while a slow list refresh is outstanding',async()=>{
 const f=fixture(),c=f.controller;await c.search({scope:'local-library'});await c.select('a',1);const wait=deferred();let held=false;
 f.intercept(method=>{if(method==='asset.search'&&!held){held=true;return wait.promise;}});
 const first=c.annotate({assetId:'a',favorite:true});await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.equal(c.snapshot().selectedMetadata.favorite,true);assert.equal(Object.hasOwn(c.snapshot().annotationEdits,'a'),false);
 await c.annotate({assetId:'a',favorite:false});wait.resolve({items:[],total:0});await first;
 const edits=f.calls.filter(x=>x.method==='asset.annotate');assert.equal(edits.length,2);assert.notEqual(edits[0].payload.operationId,edits[1].payload.operationId);assert.equal(c.snapshot().selectedMetadata.favorite,false);
});
test('a pending selection uses refreshed metadata after annotation acknowledgement is retired',async()=>{
 const f=fixture(),c=f.controller;await c.search({scope:'local-library'});const wait=deferred();
 f.intercept((method,p)=>method==='asset.read'&&p.assetId==='a'?wait.promise:null);
 const selection=c.select('a',1);
 await c.annotate({assetId:'a',favorite:true,tags:['refreshed']}); // Includes completed host search refresh.
 assert.equal(c.snapshot().cards.find(card=>card.assetId==='a').favorite,true);
 assert.equal(c.snapshot().selected,null);
 wait.resolve({version_:f.body('a'),state:{indexed:true}});await selection;
 assert.equal(c.snapshot().selected.version_.assetId,'a');
 assert.equal(c.snapshot().selectedMetadata.favorite,true,'late body read cannot restore metadata captured before the edit');
 assert.deepEqual(c.snapshot().selectedMetadata.tags,['refreshed']);
});
test('a refreshed old asset cannot return after a newer asset selection',async()=>{
 const f=fixture(),c=f.controller;await c.search({scope:'local-library'});const wait=deferred();
 f.intercept((method,p)=>method==='asset.read'&&p.assetId==='a'?wait.promise:null);
 const old=c.select('a',1);await c.annotate({assetId:'a',favorite:true});await c.select('b',1);
 wait.resolve({version_:f.body('a'),state:{indexed:true}});await old;
 assert.equal(c.snapshot().selected.version_.assetId,'b');assert.deepEqual(c.snapshot().selectedMetadata,{assetId:'b',tags:['other'],favorite:false});
});
