import assert from 'node:assert/strict';
import {register,createRequire} from 'node:module';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const sha=b=>createHash('sha256').update(b).digest('hex');
register(new URL('../../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {invokeCraftmineNavigation,NAVIGATION_READ_CHANNELS}=await import('../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-navigation-host.ts');
const {createCraftminePanelGateway}=await import('../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-panel-gateway.ts');
const {assetsProbeScript,unwrapAssetsProbeResult}=await import('../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-assets-acceptance.ts');
const deps=createRequire(path.join(process.env.ASSET_TEST_DEPS,'package.json')), {build}=deps('esbuild');
const bundled=await build({entryPoints:[new URL('../../plugins/craftmine-world/host-requests.cjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,platform:'node',format:'cjs',write:false,alias:{'@babel/parser':deps.resolve('@babel/parser')},plugins:[{name:'actual-domain',setup(b){b.onResolve({filter:/domain\.cjs$/},()=>({path:new URL('../../plugins/craftmine-world/domain-adapter.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')}));b.onResolve({filter:/behavior-syntax\.mjs$/},()=>({path:new URL('../../plugins/craftmine-world/behavior-syntax.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')}));}}]});
const module={exports:{}};new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);const {createHostRequests}=module.exports;
const {createAssetService}=await import('../../plugins/craftmine-world/asset-service.mjs');
function setup(core) {
 if(!core.start)core.start=async()=>{};
 const owner={worldId:null,session:null};const calls=[];
 const privateRequest=createHostRequests(core,{getSettings:async()=>({activeWorldId:owner.worldId}),assetService:createAssetService({call:(m,p)=>core.call(m,p),runPreview:()=>{throw Error('NO_PREVIEW');}})});
 const domain=async(m,p)=>{calls.push({m,p:structuredClone(p)});return privateRequest(m,p);};
 const gateway=createCraftminePanelGateway({domain,viewingSession:()=>owner.session});
 const invoke=(channel,payload)=>invokeCraftmineNavigation({pluginId:'craftmine.world',channel,payload},{invoke:gateway,navigate:()=>{throw Error('NO_NAVIGATION');}});
 return {owner,calls,invoke};
}
const edit={ownerWorldId:null,operationId:'asset-annotate:test',assetId:'asset-a',favorite:true};
test('exact Main function chain rejects unsupported methods, unsafe fields and bounded edits before core',async()=>{
 const f=setup({call(){throw Error('CORE_MUST_NOT_RUN');}});
 assert.equal(NAVIGATION_READ_CHANNELS.has('asset.annotate'),false);
 for(const channel of ['asset.import','asset.preview','asset.recordUsage','asset.anything'])await assert.rejects(f.invoke(channel,edit),/PERMISSION_DENIED/);
 for(const patch of [{notes:'x'},{displayName:'x'},{sourcePath:'C:/x'},{context:{}},{sessionId:'fake'}])await assert.rejects(f.invoke('asset.annotate',{...edit,...patch}),/INVALID|HOST_IDENTITY/);
 for(const patch of [{tags:Array(33).fill('x')},{tags:['界'.repeat(14)]},{favorite:1},{operationId:'x'.repeat(241)},{tags:['x\n']}])await assert.rejects(f.invoke('asset.annotate',{...edit,...patch}),/INVALID_ASSET/);
 assert.equal(f.calls.length,0);
});
test('old selected-world owner and changed trusted session never receive a confirmed receipt',async()=>{
 let writes=0;const f=setup({async call(m,p){assert.equal(m,'asset.annotate');writes++;f.owner.session='new';return {operationId:p.operationId,assetId:p.assetId,metadata:{favorite:true,notes:'private'}};}});
 await assert.rejects(f.invoke('asset.annotate',{...edit,ownerWorldId:'world-old'}),/OWNER_CHANGED/);assert.equal(writes,0);
 await assert.rejects(f.invoke('asset.annotate',edit),/OWNER_CHANGED/);assert.equal(writes,1,'already-submitted write is not represented as cancelled');
});
test('headless finite asset probe rejects arbitrary selectors/scripts/RPC and unbounded fields',()=>{
 for(const x of [{action:'evaluate',script:'1'},{action:'read',selector:'body'},{action:'read',rpc:'world.create'},{action:'favorite',assetId:'x"#'}])assert.throws(()=>assetsProbeScript({ownerWorldId:null,...x}),/INVALID_ASSET_PROBE/);
 assert.throws(()=>assetsProbeScript({action:'saveTags',ownerWorldId:null,assetId:'asset-a',tags:['x;other']}),/INVALID/);
 assert.throws(()=>unwrapAssetsProbeResult(vm.runInNewContext(assetsProbeScript({action:'read',ownerWorldId:null}))),/HEADLESS_ASSET_GUARD_REQUIRED/);
});
test('navigation → panel gateway → actual private asset service → existing Core persists only metadata',async()=>{
 const executable=process.env.ASSET_TEST_CORE;assert(executable&&path.isAbsolute(executable),'ASSET_TEST_CORE must name the existing compatible core; no build fallback');
 const {CoreClient}=createRequire(import.meta.url)('../../plugins/craftmine-world/core-client.cjs');
 const out=fs.mkdtempSync(new URL('../../test-results/asset-main-route-',import.meta.url));const core=new CoreClient(executable,path.join(out,'core'));
 const raw={out,core:executable,coreSha256:sha(fs.readFileSync(executable)),sourceFiles:['craftmine-navigation-host.ts','craftmine-panel-gateway.ts','craftmine-asset-panel.ts'].map(file=>({path:'vendor/pi-desktop/apps/desktop/electron/main/'+file,sha256:sha(fs.readFileSync(new URL('../../vendor/pi-desktop/apps/desktop/electron/main/'+file,import.meta.url)))})),passed:false,steps:[]};const persist=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(raw,null,2));
 try{await core.start();const input=path.join(out,'input');fs.mkdirSync(input);const file=path.join(input,'pixel.png');fs.writeFileSync(file,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64'));
 await core.call('asset.import',{operationId:'seed-a',assetId:'asset-a',version:1,sourceRoot:input,sourcePath:file,path:'pixel.png',kind:'raw',mediaKind:'image',mediaType:'image/png',displayName:'asset-a',source:{origin:'fixed-test',author:'test',license:'unknown',licenseStatus:'unverified'},tags:[]});
 const f=setup(core),before={body:await core.call('asset.read',{assetId:'asset-a',version:1}),versions:await core.call('asset.versions',{assetId:'asset-a',offset:0,limit:20}),worlds:await core.call('world.list')};
 const search={ownerWorldId:null,scope:'local-library',query:'',tags:[],favoritesOnly:false,latestOnly:true,offset:0,limit:20};
 assert.equal((await f.invoke('asset.search',search)).items[0].favorite,false);
 const request={...edit,tags:['建筑','常用']};const receipt=await f.invoke('asset.annotate',request);assert.deepEqual(Object.keys(receipt).sort(),['assetId','metadata','operationId']);assert.equal(receipt.metadata.favorite,true);
 assert.deepEqual(await f.invoke('asset.annotate',request),receipt);await assert.rejects(f.invoke('asset.annotate',{...request,favorite:false}),/OPERATION_CONFLICT/);
 assert.equal((await f.invoke('asset.search',{...search,favoritesOnly:true})).items[0].favorite,true);
 assert.deepEqual(await f.invoke('asset.read',{ownerWorldId:null,assetId:'asset-a',version:1}),before.body);
 assert.deepEqual(await core.call('asset.versions',{assetId:'asset-a',offset:0,limit:20}),before.versions);assert.deepEqual(await core.call('world.list'),before.worlds);
 for(const channel of ['asset.usage','asset.previewRead'])await f.invoke(channel,{ownerWorldId:null,assetId:'asset-a',version:1});
 raw.calls=f.calls;raw.receipt=receipt;raw.passed=true;persist();
 }catch(e){raw.error=String(e);persist();throw e;}finally{await core.stop();}
 console.log('asset main route evidence:',out);
});

test('native runner requires explicit mode and sealed package identity without fallback',async()=>{
 const {assetClientArguments}=await import('./asset-client-arguments.mjs');
 const base=['--source-root','C:/source','--deps-app','C:/deps','--output-parent','C:/output/test-results'];
 assert.throws(()=>assetClientArguments(base),/MODE_REQUIRED/);
 assert.equal(assetClientArguments([...base,'--mode','development'])['--mode'],'development');
 assert.throws(()=>assetClientArguments([...base,'--mode','packaged']),/PACKAGE_EXPECTED/);
 assert.throws(()=>assetClientArguments([...base,'--mode','development','--packaged-root','C:/package']),/OVERRIDE_DENIED/);
 assert.throws(()=>assetClientArguments([...base,'--mode','packaged','--packaged-root','C:/package','--expected-commit','a'.repeat(40)]),/PACKAGE_EXPECTED/);
 assert.equal(assetClientArguments([...base,'--mode','packaged','--packaged-root','C:/package','--expected-commit','a'.repeat(40),'--expected-build-manifest-sha256','b'.repeat(64)])['--packaged-root'],'C:/package');
 assert.throws(()=>assetClientArguments([...base,'--mode','development','--source-core','C:/other']),/INVALID/);
});
