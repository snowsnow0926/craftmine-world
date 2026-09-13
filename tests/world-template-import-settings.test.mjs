import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateArchive} from '../plugins/craftmine-world/player-world-library.cjs';
import {writeZip} from '../plugins/craftmine-world/package-zip.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function archive(extra){
 const sources={'project.godot':Buffer.from('config_version=5\n'),...extra};
 const initial=Buffer.from(JSON.stringify({format:'craftmine.godot-progress/1',stateVersion:1,worldId:'source-world',baseId:'creation-sandbox',baseVersion:'1.0.0',body:{worldId:'source-world'}}));
 const manifest={format:'craftmine.player-world-template/1',assetId:'player.world.import-test',version:1,displayName:'Import settings',description:'Fixture only',tags:[],initialState:'saved-progress',worldId:'source-world',sourceWorldId:'source-world',baseId:'creation-sandbox',baseVersion:'1.0.0',initialSha256:hash(initial),files:Object.entries(sources).map(([path,bytes])=>({path,bytes:bytes.length,sha256:hash(bytes)}))};
 return writeZip([{name:'world-template.json',bytes:Buffer.from(JSON.stringify(manifest))},{name:'initial.json',bytes:initial},...Object.entries(sources).map(([name,bytes])=>({name:'source/'+name,bytes}))]);
}
test('world templates preserve declared model/image/audio import settings byte-for-byte',async()=>{
 const settings=Buffer.from('[remap]\nimporter="scene"\n[params]\nmeshes/generate_lods=false\n');
 for(const extension of ['glb','png','ogg']){
  const asset='addons/saved/model.'+extension,bytes=archive({[asset]:Buffer.from('opaque source fixture'),[asset+'.import']:settings});
  const result=await validateArchive(bytes);assert.deepEqual(result.files.get('source/'+asset+'.import'),settings);assert(result.manifest.files.some(file=>file.path===asset+'.import'));
 }
});
test('unpaired or arbitrary import sidecars and imported caches remain refused',async()=>{
 for(const files of [
  {'model.glb.import':Buffer.from('orphan')},
  {'script.gd':Buffer.from('extends Node'),'script.gd.import':Buffer.from('not asset settings')},
  {'notes.txt':Buffer.from('notes'),'notes.txt.import':Buffer.from('not asset settings')},
 ])await assert.rejects(validateArchive(archive(files)),/WORLD_TEMPLATE_SOURCE_PATH_INVALID/);
 for(const name of ['.godot/imported/cache.glb','addons/.GODOT/imported/cache.glb','.import/cache.png'])await assert.rejects(validateArchive(archive({[name]:Buffer.from('cache')})),/WORLD_TEMPLATE_SOURCE_PATH_INVALID/);
});
