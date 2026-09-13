import test from 'node:test';import assert from 'node:assert/strict';
import {register,stripTypeScriptTypes} from 'node:module';import {pathToFileURL} from 'node:url';import {join,resolve} from 'node:path';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
register(pathToFileURL(resolve('vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs')));
const {createPlaytestFeedbackPanel}=await import('../vendor/pi-desktop/apps/desktop/electron/main/playtest-feedback-panel.ts');
const sha=value=>createHash('sha256').update(value).digest('hex');
const context={worldId:'world-one',buildId:'build-one',worldRevision:0,contentHash:'a'.repeat(64),baseId:'creation-sandbox',baseVersion:'1',engineVersion:'4.7.2',progressFormat:'craftmine.godot-progress/1'};
async function fixture(){const root=await mkdtemp(join(tmpdir(),'playtest-feedback-')),file=join(root,'feedback.json');const records=new Map();let selected='world-one',captures=0;
 const domain=async(method,args)=>{if(method==='playtest.context')return structuredClone(context);if(method==='playtest.validate')return args.report;if(method==='playtest.record'){const reused=records.has(args.report.id);records.set(args.report.id,args.report);return {status:'recorded',id:args.report.id,reused};}if(method==='playtest.read')return records.get(args.id);};
 const service=createPlaytestFeedbackPanel({domain,selection:async()=>selected,blocked:()=>false,client:{version:'0.14.4-preview.22'},capture:async()=>{captures++;const bytes=Buffer.from('89504e470d0a1a0a','hex');return {worldId:'world-one',buildId:'build-one',pngBase64:bytes.toString('base64'),sha256:sha(bytes)};},pick:async()=>file});
 return {root,file,service,records,captures:()=>captures,select:value=>selected=value};}
test('preview is opt-in; exported reviewed bytes can be previewed and imported idempotently',async()=>{
 const f=await fixture();const preview=await f.service.request('playtest.preview',{worldId:'world-one',description:'Door blocked',expected:'Walk through',includeScreenshot:false});
 assert.equal(f.records.size,0);assert.equal(f.captures(),0);assert.equal(preview.report.screenshot,null);
 const result=await f.service.request('playtest.export',{worldId:'world-one',previewId:preview.previewId});const bytes=await readFile(f.file);assert.equal(result.sha256,sha(bytes));assert.deepEqual(JSON.parse(bytes),preview.report);
 f.select('author-world');const incoming=await f.service.request('playtest.importPreview',{worldId:'author-world'});assert(incoming.unverifiedPlayerStatement);assert.equal(f.records.size,1);
 assert.equal((await f.service.request('playtest.importCommit',{worldId:'author-world',previewId:incoming.previewId})).status,'recorded');
 assert((await f.service.request('playtest.importCommit',{worldId:'author-world',previewId:incoming.previewId})).reused);
});
test('world changes, renderer file paths and mismatched grants are refused',async()=>{
 const f=await fixture();await assert.rejects(f.service.request('playtest.importPreview',{worldId:'world-one',path:f.file}),/INVALID_PARAMS/);
 const p=await f.service.request('playtest.preview',{worldId:'world-one',description:'One',expected:'Two',includeScreenshot:true});assert.equal(f.captures(),1);assert(p.report.screenshot);
 f.select('other');await assert.rejects(f.service.request('playtest.export',{worldId:'other',previewId:p.previewId}),/PREVIEW_EXPIRED/);
 await assert.rejects(f.service.request('playtest.export',{worldId:'world-one',previewId:p.previewId}),/WORLD_CHANGED/);
});
test('later autosave preserves exact reviewed bytes; a new formal build requires review',async()=>{
 const f=await fixture();const p=await f.service.request('playtest.preview',{worldId:'world-one',description:'One',expected:'Two',includeScreenshot:false});
 const oldHash=context.contentHash;context.worldRevision++;context.contentHash='c'.repeat(64);
 try{assert.equal((await f.service.request('playtest.export',{worldId:'world-one',previewId:p.previewId})).status,'completed');assert.deepEqual(JSON.parse(await readFile(f.file)),p.report);assert.equal(p.report.context.worldRevision,0);assert.equal(p.report.context.contentHash,oldHash);}finally{context.worldRevision--;context.contentHash=oldHash;}
 context.buildId='build-two';try{await assert.rejects(f.service.request('playtest.export',{worldId:'world-one',previewId:p.previewId}),/WORLD_CHANGED/);}finally{context.buildId='build-one';}
 await writeFile(f.file,'x'.repeat(800001));await assert.rejects(f.service.request('playtest.importPreview',{worldId:'world-one'}),/TOO_LARGE/);
});
test('repeated abandoned previews evict old grants and keep the current review usable',async()=>{
 const f=await fixture();let first,last;
 for(let i=0;i<10;i++){last=await f.service.request('playtest.preview',{worldId:'world-one',description:'Review '+i,expected:'',includeScreenshot:false});first??=last;}
 await assert.rejects(f.service.request('playtest.export',{worldId:'world-one',previewId:first.previewId}),/PREVIEW_EXPIRED/);
 assert.equal((await f.service.request('playtest.export',{worldId:'world-one',previewId:last.previewId})).status,'completed');
});
test('the actual private plugin-runtime bridge admits exact feedback and world-brief domain methods',async()=>{
 const source=await readFile(resolve('vendor/pi-desktop/apps/desktop/electron/main/plugin-runtime.ts'),'utf8');
 const begin=source.indexOf('  async requestCraftmineHost('),end=source.indexOf('\n  }',begin)+4;
 assert(begin>0&&end>begin);
 // Compile the actual method independently of Electron startup dependencies;
 // retain its entire allowlist and routing implementation, not a copied guard.
 const method=stripTypeScriptTypes('class Bridge {\n'+source.slice(begin,end)+'\n}');
 const Bridge=new Function('apiError',method+';return Bridge;')((code,message)=>Object.assign(Error(message),{code}));
 const instance=new Bridge();instance.loaded=new Map([['craftmine.world',{child:{}}]]);instance.sendToChild=async(_loaded,envelope)=>envelope;
 for(const method of ['playtest.context','playtest.validate','playtest.record','playtest.list','playtest.read','world.brief'])assert.equal((await instance.requestCraftmineHost(method,{worldId:'world-one'})).payload.method,method);
 for(const method of ['playtest.export','playtest.execute','playtest.readFile','playtest.anything','world.brief.execute','worldBrief.anything'])await assert.rejects(instance.requestCraftmineHost(method,{}),/Unsupported Craftmine host request/);
});
