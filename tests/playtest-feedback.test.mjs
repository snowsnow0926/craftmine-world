import test from 'node:test';import assert from 'node:assert/strict';
import {register} from 'node:module';import {pathToFileURL} from 'node:url';import {join,resolve} from 'node:path';
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
test('world progress changed after preview cannot be exported, and oversized imports fail before parsing',async()=>{
 const f=await fixture();const p=await f.service.request('playtest.preview',{worldId:'world-one',description:'One',expected:'Two',includeScreenshot:false});
 context.worldRevision++;try{await assert.rejects(f.service.request('playtest.export',{worldId:'world-one',previewId:p.previewId}),/WORLD_CHANGED/);}finally{context.worldRevision--;}
 await writeFile(f.file,'x'.repeat(800001));await assert.rejects(f.service.request('playtest.importPreview',{worldId:'world-one'}),/TOO_LARGE/);
});
