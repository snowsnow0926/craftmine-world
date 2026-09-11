import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createManagedPackageSourceService} from '../../plugins/craftmine-world/godot-package-source.mjs';
import {unpackStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture({declared=true,declaration,missingLicense=false}={}){
  const files=new Map(Object.entries({
    'project.godot':'[application]\nrun/main_scene="res://world.tscn"\n',
    'world.tscn':'[gd_scene format=3]\n[node name="World" type="Node3D"]\n[node name="Module" type="StaticBody3D" parent="."]\nentity_id = "module"\n'+(declared?'metadata/craftmine_attribution = "res://attribution.json"\n':''),
    'attribution.json':declaration??JSON.stringify({format:'craftmine.resource-attribution/1',licenses:{code:{spdx:'MIT',text:'res://LICENSE.md'}}}),
    ...(!missingLicense?{'LICENSE.md':'Exact original copyright text.\n'}:{})
  }).map(([name,text])=>[name,Buffer.from(text)]));
  const manifestHash='a'.repeat(64);
  const call=async(method,args)=>{
    if(method==='godotProject.index')return {worldId:'source',revision:1,manifestHash,baseId:'creation-sandbox',engineVersion:'4.7.2-stable',files:[...files].map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)})),nextOffset:null};
    if(method==='godotProject.read'){const bytes=files.get(args.path);return {sha256:hash(bytes),text:bytes.toString('utf8'),nextOffset:null};}
    throw Error('unexpected call');
  };
  const service=createManagedPackageSourceService({call,bind:async()=>({context:{},worldRecord:{id:'source',world:{snapshot:{baseVersion:'1.0.0'}}}})});
  const exportPackage=async()=>unpackStaticPackage(Buffer.from((await service.exportSource({worldId:'source',revision:1,manifestHash,nodePath:'Module',assetId:'copy',version:1})).archiveBase64,'base64')).resources[0];
  return {exportPackage,files};
}
test('source export binds explicit attribution to included rewritten bytes and preserves original license text',async()=>{
  const {exportPackage,files}=fixture();const resource=await exportPackage();const refs=resource.manifest.content.licenses.sourceDeclarations;
  assert.equal(refs.length,1);assert.equal(refs[0].status,'source-declared');assert.equal(refs[0].sha256,hash(resource.files.get(refs[0].path)));
  assert.deepEqual(resource.files.get('LICENSE.md'),files.get('LICENSE.md'));
  assert.equal(JSON.parse(resource.files.get('attribution.json')).licenses.code.text,'res://addons/copy/LICENSE.md');
});
test('unreferenced sidecars are not inferred as a license',async()=>{
  const resource=await fixture({declared:false}).exportPackage();assert.deepEqual(resource.manifest.content.licenses,{});assert.equal(resource.files.has('LICENSE.md'),false);
});
test('missing license dependencies and malformed explicit declarations fail instead of losing attribution',async()=>{
  await assert.rejects(fixture({missingLicense:true}).exportPackage(),/PACKAGE_SOURCE_DEPENDENCY_MISSING/);
  await assert.rejects(fixture({declaration:'{}'}).exportPackage(),/PACKAGE_ATTRIBUTION_INVALID/);
  await assert.rejects(fixture({declaration:'not json'}).exportPackage(),/PACKAGE_ATTRIBUTION_INVALID/);
});
