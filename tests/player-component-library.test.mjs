import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createPlayerComponentLibrary} from '../plugins/craftmine-world/player-component-library.cjs';
import {packStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';
import {contentHash} from '../plugins/craftmine-world/package-format.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'player-library-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const args={worldId:'world-a',operationId:'publish-one',revision:3,manifestHash:'a'.repeat(64),nodePath:'Pet',assetId:'player.component.pet',version:1,displayName:'My pet',tags:['dog'],aliases:['博美'],notes:'A local component'};
 let gate=null,selected='world-a',lost=false;const calls=[];let imported;
 const source={async exportSource(a){if(gate)await gate;const files={'pet.tscn':Buffer.from('[gd_scene format=3]\n[node name="Pet" type="Node3D"]\n')};const content={assetId:a.assetId,version:a.version,kind:'object',files:Object.entries(files).map(([path,b])=>({path,bytes:b.length,sha256:hash(b)})),dependencies:[],entry:{entities:['pet'],sceneInstall:{mode:'instance',sceneFile:'pet.tscn',identityField:'entity_id'}},interfaces:{},compatibility:{},state:{},licenses:{}};const zip=packStaticPackage({root:{id:a.assetId,version:a.version},resources:[{manifest:{format:'craftmine.resource/1',content,contentHash:contentHash(content)},files}]});return {archiveBase64:zip.toString('base64'),archiveSha256:hash(zip),source:{worldId:a.worldId,revision:a.revision,manifestHash:a.manifestHash,nodePath:a.nodePath,mainScene:'world.tscn'},files:1,requiredSourceFiles:0};}};
 const call=async(method,a)=>{calls.push({method,args:a});if(method==='asset.import'){imported??={...a,hash:hash(await fs.readFile(a.sourcePath))};if(lost){lost=false;throw Error('LOST_REPLY');}return {};}
 if(method==='asset.annotate')return {};if(method==='asset.read')return {version_:{assetId:a.assetId,version:a.version,contentHash:'f'.repeat(64),files:[{sha256:imported.hash}]}};throw Error(method);};
 const create=()=>createPlayerComponentLibrary({call,source,selected:async()=>selected,directory});
 return {args,calls,create,setGate:value=>gate=value,setSelected:value=>selected=value,lose:()=>lost=true};
}
test('publication rejects forged fields, namespaces, excessive metadata and foreign selection before catalog writes',async t=>{
 const f=await fixture(t),service=f.create();
 for(const change of [{assetId:'cw.module.approved-pomeranian'},{sourcePath:'D:/foreign'},{tags:Array(30).fill('x')},{version:0},{manifestHash:'bad'},{preview:{worldId:'other'}}])await assert.rejects(service.publishSource({...f.args,...change}));
 f.setSelected('another');await assert.rejects(service.publishSource(f.args),/WORLD_CHANGED/);assert.equal(f.calls.length,0);
});
test('cancel during source extraction fences every catalog write and remains cancelled after restart',async t=>{
 const f=await fixture(t),service=f.create();let release;f.setGate(new Promise(r=>release=r));const running=assert.rejects(service.publishSource(f.args),/CANCELLED/);
 while((await service.publishSourceStatus({worldId:f.args.worldId,operationId:f.args.operationId})).status==='not-found')await new Promise(r=>setTimeout(r,1));
 await service.cancelPublishSource({worldId:f.args.worldId,operationId:f.args.operationId});release();await running;assert.equal(f.calls.length,0);
 assert.equal((await f.create().publishSource(f.args)).status,'cancelled');
});
test('lost import reply retries frozen bytes and native operation, then returns a durable receipt without reimporting',async t=>{
 const f=await fixture(t),service=f.create();f.lose();await assert.rejects(service.publishSource(f.args),/LOST_REPLY/);
 const identity={worldId:f.args.worldId,operationId:f.args.operationId};assert.equal((await service.cancelPublishSource(identity)).cancelled,false);
 const result=await f.create().publishSource(f.args);assert.equal(result.status,'completed');assert.equal(result.applied,false);assert.equal(result.previewStatus,'unavailable');
 const imports=f.calls.filter(c=>c.method==='asset.import');assert.equal(imports.length,2);assert.deepEqual(imports[0].args,imports[1].args);assert.equal(imports[0].args.source.licenseStatus,'unverified');
 assert.deepEqual(await f.create().publishSource(f.args),result);assert.equal(f.calls.filter(c=>c.method==='asset.import').length,2);
 await assert.rejects(f.create().publishSource({...f.args,displayName:'Changed retry'}),/OPERATION_CONFLICT/);assert.equal(JSON.stringify(result).includes('sourcePath'),false);
});
