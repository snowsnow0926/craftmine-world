import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {packStaticPackage} from '../plugins/craftmine-world/package-zip.mjs';import {contentHash} from '../plugins/craftmine-world/package-format.mjs';
import {BUILTIN_DEMO_PLAN,readBuiltinDemoCatalog,validateBuiltinDemoCall} from './helpers/builtin-demo-contract.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('default demonstration includes environmental preset, two independently placed copies and a small castle corner',()=>{
 assert.equal(BUILTIN_DEMO_PLAN[0].assetId,'cw.environment.natural-daylight');const trees=BUILTIN_DEMO_PLAN.filter(p=>p.assetId==='cw.nature.tree-oak');assert.equal(trees.length,2);assert.notDeepEqual(trees[0].position,trees[1].position);assert.equal(BUILTIN_DEMO_PLAN.length,5);
});
test('controller contract rejects model setup, evaluation, source mutation and foreign-world operations',()=>{
 for(const method of ['playerSetup','playerPrompt','agentPrompt','evaluation','godotProject.patch'])assert.throws(()=>validateBuiltinDemoCall(method,{},'world'));
 assert.throws(()=>validateBuiltinDemoCall('worldPanel',{channel:'package.request',payload:{worldId:'other',method:'importSource',params:{worldId:'other'}}},'world'));
 assert.throws(()=>validateBuiltinDemoCall('worldPanel',{channel:'package.request',payload:{worldId:'world',method:'installSource',params:{worldId:'world',archiveBase64:'source'}}},'world'));
 assert.throws(()=>validateBuiltinDemoCall('worldNavigation',{channel:'task.resume',payload:{}},'world'));
 assert.throws(()=>validateBuiltinDemoCall('primaryMode',{payload:{action:'arbitrary'}},'world'));
 validateBuiltinDemoCall('worldPanel',{channel:'package.request',payload:{worldId:'world',method:'importSource',params:{worldId:'world',operationId:'opaque-operation'}}},'world');
});
test('catalog preflight verifies original ZIP/root hashes and refuses tampering or invented placement',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'builtin-demo-contract-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const bytes=Buffer.from('fixture'),files={'fixture.txt':bytes},content={assetId:'fixture',version:1,kind:'raw',files:[{path:'fixture.txt',bytes:bytes.length,sha256:sha(bytes)}],dependencies:[],entry:{},interfaces:{},compatibility:{},state:{},licenses:{}};
 const manifest={format:'craftmine.resource/1',content,contentHash:contentHash(content)},zip=packStaticPackage({root:{id:'fixture',version:1},resources:[{manifest,files}]});
 fs.writeFileSync(path.join(root,'fixture.zip'),zip);fs.writeFileSync(path.join(root,'catalog.json'),JSON.stringify({format:'craftmine.builtin-source-library/1',entries:[{assetId:'fixture',version:1,file:'fixture.zip',bytes:zip.length,sha256:sha(zip),rootContentHash:manifest.contentHash}]}));
 const plan=[{assetId:'fixture',version:1}];assert.equal(readBuiltinDemoCatalog(root,plan)[0].archiveSha256,sha(zip));
 assert.throws(()=>readBuiltinDemoCatalog(root,[{...plan[0],position:{x:99,y:0,z:0}}]));fs.writeFileSync(path.join(root,'fixture.zip'),Buffer.alloc(zip.length));assert.throws(()=>readBuiltinDemoCatalog(root,plan));
});
