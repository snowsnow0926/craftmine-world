import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {compileScene,INITIAL_SNAPSHOT} from '../../../app/scene.mjs';
const require=createRequire(import.meta.url);
const {CoreClient}=require('../../../plugins/craftmine-world/core-client.cjs');
const {readCapabilityContext,buildInventory}=require('../../../plugins/craftmine-world/godot-capability.cjs');
const {GODOT_METHODS,LOCAL_TOOLS}=require('../../../plugins/craftmine-world/godot-routing.cjs');
const {createLibraryBinding}=require('../../../plugins/craftmine-world/godot-library.cjs');
const {createHistoryService}=require('../../../plugins/craftmine-world/godot-history.cjs');
const manifest=require('../../../plugins/craftmine-world/manifest.json');
const binary=process.env.CRAFTMINE_CORE_BIN;
test('real core capabilities follow project creation and asset/package read adapters',{skip:binary?false:'Set CRAFTMINE_CORE_BIN to the baseline core binary'},async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'craftmine-capability-truth-'));
 const core=new CoreClient(binary,directory);t.after(()=>core.stop());
 const handshake=await core.start();
 for(const flag of ['contentHistory','assetCatalog','creationPackages'])assert.equal(handshake[flag],true,flag);
 const context={projectId:'cap-project',sessionId:'cap-session',turnId:'cap-turn'};
 const scene=compileScene({format:'craftmine.scene/3',title:'Capability probe',night:false,objects:[],systems:[],behaviors:[]});
 const world={build:{...scene,id:'v-'+scene.hash.slice(0,20)},snapshot:INITIAL_SNAPSHOT,extensions:[]};
 await core.call('world.create',{id:'alpha',title:'alpha',world});
 const workspace=await core.call('workspace.open',{context,selectedWorld:'alpha'});
 const inventory=async()=>buildInventory({manifest,routing:GODOT_METHODS,localTools:LOCAL_TOOLS,handshake,
  executionContext:await readCapabilityContext(core,context,handshake)});
 const before=await inventory();
 assert.equal(before.executionContext.worldId,'alpha');
 assert.equal(before.tools.find(tool=>tool.name==='godot_history').modes.find(mode=>mode.mode==='history').reachable,false);
 const library=createLibraryBinding({core,context,worldId:'alpha'});
 assert.equal((await library.assetSearch({scope:'local-library'})).available,true);
 assert.equal((await library.packageList({})).available,true);
 await core.call('godotProject.create',{context,worldId:'alpha',toolCallId:'create-probe',
  baseBuild:workspace.task.binding.baseBuild,baseId:'first-person',files:[
   {path:'project.godot',text:'config_version=5\n[application]\nconfig/name="Capability probe"\nrun/main_scene="res://world.tscn"\n'},
   {path:'world.tscn',text:'[gd_scene format=3]\n[node name="World" type="Node3D"]\n'}]},30000);
 await core.call('content.migrate.apply',{worldId:'alpha'},30000);
 const after=await inventory();
 assert.equal(after.tools.find(tool=>tool.name==='godot_history').modes.find(mode=>mode.mode==='history').reachable,true);
 const history=createHistoryService({core,context,workspace});
 assert.equal((await history.history({})).available,true);
 const status=await core.call('content.status',{worldId:'alpha'});
 const contentRef={repoId:status.repoId,commitOid:status.headOid,assetLockHash:'a'.repeat(64)};
 assert.equal((await history.version({contentRef})).available,true);
 assert.equal((await history.diff({from:contentRef,to:contentRef})).available,true);
 console.log('isolated_core_data='+directory);
});
