import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {materializeArchive} from '../plugins/craftmine-world/player-world-library.cjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const out=path.resolve('test-results');fs.mkdirSync(out,{recursive:true});
const ref={assetId:'player.world.instance-copy',version:1,contentHash:'a'.repeat(64)};
function fixture(binding='source-world'){
 const instances={format:'craftmine.godot-draft-instances/1',worldId:binding,operationId:'source-world-operation',assetLockHash:'b'.repeat(64),instances:[{instanceId:'source-world-pet',assetId:'cw.module.approved-pomeranian',version:1,entityMap:{pet:'source-world-pet-e0'},sourceDeclaration:{format:'craftmine.instance-source-declaration/1',status:'source-declared',resourceRef:{assetId:'cw.module.approved-pomeranian',version:1,contentHash:'c'.repeat(64)},notes:'source-world is data, not a replacement target'}}]};
 const source={'project.godot':Buffer.from('config_version=5\n[craftmine]\nruntime/world_id="source-world"\n'),'craftmine.instances.json':Buffer.from(JSON.stringify(instances)),'script.gd':Buffer.from('const ORIGINAL_NAME = "source-world"\n')};
 const archive={manifest:{worldId:'published-world',sourceWorldId:'source-world',baseId:'creation-sandbox',baseVersion:'1.0.0',initialState:'saved-progress',files:Object.entries(source).map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)}))},files:new Map(Object.entries(source).map(([name,bytes])=>['source/'+name,bytes])),snapshot:{stateVersion:1,body:{worldId:'published-world',components:{'source-world-pet-e0':{entityId:'source-world-pet-e0',settings:{name:'source-world'}}}}}};
 return {archive,instances,source};
}
test('template materialization remaps only instance registry world scope, preserving identities and declarations',async()=>{
 for(const binding of ['source-world','published-world']){
  const {archive,instances,source}=fixture(binding),parent=fs.mkdtempSync(path.join(out,'instance-rebind-')),directory=path.join(parent,'copy');
  const before=JSON.stringify(archive.manifest),manifest=await materializeArchive(archive,'copied-world',directory,ref);
  const actual=JSON.parse(fs.readFileSync(path.join(directory,'craftmine.instances.json')));
  assert.deepEqual(actual,{...instances,worldId:'copied-world'});assert.equal(JSON.stringify(archive.manifest),before);
  assert.deepEqual(fs.readFileSync(path.join(directory,'script.gd')),source['script.gd']);
  const mapFile=manifest.files.find(file=>file.path==='craftmine.instances.json');assert.equal(mapFile.sha256,hash(fs.readFileSync(path.join(directory,mapFile.path))));
  const initial=JSON.parse(fs.readFileSync(path.join(directory,'craftmine_initial_state.json')));assert.equal(initial.worldId,'copied-world');assert.equal(initial.initialProgress.worldId,'copied-world');assert.deepEqual(initial.initialProgress.components,archive.snapshot.body.components);
  assert.deepEqual(await materializeArchive(archive,'copied-world',directory,ref),manifest,'same create operation remains idempotent');
 }
});
test('foreign, missing, invalid-format and malformed instance maps reject before writing a project',async()=>{
 for(const mutate of [map=>{map.worldId='foreign-world';},map=>{delete map.worldId;},map=>{map.format='other/1';},map=>{map.instances={};},map=>{map.instances=Array(1025).fill({});}]){
  const {archive,instances}=fixture();mutate(instances);archive.files.set('source/craftmine.instances.json',Buffer.from(JSON.stringify(instances)));
  if(!Object.hasOwn(instances,'worldId')){delete archive.manifest.sourceWorldId;archive.files.set('source/project.godot',Buffer.from('config_version=5\n[craftmine]\nruntime/world_id="published-world"\n'));}
  const directory=path.join(fs.mkdtempSync(path.join(out,'instance-rebind-reject-')),'copy');
  await assert.rejects(materializeArchive(archive,'copied-world',directory,ref),/WORLD_TEMPLATE_INSTANCE_MAP_INVALID/);assert.equal(fs.existsSync(directory),false);
 }
 const {archive}=fixture();archive.files.set('source/craftmine.instances.json',Buffer.from('{invalid-json'));
 await assert.rejects(materializeArchive(archive,'copied-world',path.join(fs.mkdtempSync(path.join(out,'instance-rebind-json-')),'copy'),ref),/WORLD_TEMPLATE_INSTANCE_MAP_INVALID/);
});
