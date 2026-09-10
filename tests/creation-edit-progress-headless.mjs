import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {materializeBase} from '../desktop/godot/shared/materialize.mjs';import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';
const require=createRequire(import.meta.url),{compileCreationOperation}=require('../plugins/craftmine-world/creation-operations.cjs');
fs.mkdirSync('test-results',{recursive:true});const out=fs.mkdtempSync(path.resolve('test-results/edit-progress-')),project=path.join(out,'project');
materializeBase({baseId:'creation-sandbox',worldId:'edit-world',out:project});
const hash=text=>createHash('sha256').update(text).digest('hex'),file=text=>({text,sha256:hash(text)});
const chest={id:'chest-a',kind:'chest',position:[4,0,4],rotationY:0,scale:[1,1,1],color:'#884422',parameters:{rewardId:'wood',rewardCount:3}};
const source={worldId:'edit-world',buildId:'build-a',instanceId:'instance-a',revision:1,manifestHash:'a'.repeat(64),files:{'world/creation.json':file(JSON.stringify({format:'craftmine.creation-scene/1',revision:1,defaults:{timeOfDay:12},entities:[chest]}))}};
const targetSnapshot={snapshotId:'capture-a',worldId:source.worldId,buildId:source.buildId,instanceId:source.instanceId,sourceRevision:1,manifestHash:source.manifestHash,playerPosition:[0,1,0],target:{entityId:'chest-a',revision:1}};
const expected={worldId:source.worldId,buildId:source.buildId,instanceId:source.instanceId,revision:1,manifestHash:source.manifestHash,targetSnapshotId:'capture-a'};
fs.writeFileSync(path.join(project,'world/creation.json'),source.files['world/creation.json'].text);
fs.writeFileSync(path.join(project,'probe.gd'),`extends SceneTree
func _initialize() -> void: run.call_deferred()
func run() -> void:
    change_scene_to_file(ProjectSettings.get_setting("application/run/main_scene"))
    var bridge = root.get_node("CraftmineRuntime")
    for frame in range(600):
        await process_frame
        if bridge.initialized: break
    await bridge.handle_request({"worldId":"edit-world","buildId":"build-a","instanceId":"instance-a","op":"load","args":{}})
    var world = current_scene
    var failures = []
    if FileAccess.file_exists("res://saved.json"):
        var saved = JSON.parse_string(FileAccess.get_file_as_string("res://saved.json"))
        var error = world.restore(saved)
        if not error.is_empty(): failures.append(error)
        if JSON.stringify(world.capture()) != JSON.stringify(saved):
            for key in ["inventory","openedChests","player","doors","rules"]:
                if world.capture()[key] != saved[key]: failures.append("restore differs " + key)
    else:
        world.inventory["kept-token"] = 7
    var interaction = {}
    if world.entities.has("chest-a"):
        world.player.position = Vector3(4,0.9,6)
        await physics_frame
        await process_frame
        world.player.camera_rig.camera.look_at(Vector3(4,0.55,4))
        interaction = world.interact_target()
    print("EDIT_PROGRESS=" + JSON.stringify({"failures":failures,"interaction":interaction,"snapshot":world.capture(),"headless":DisplayServer.get_name()=="headless","captured":world.player.captured,"entities":world.entities.keys()}))
    quit(0 if failures.is_empty() else 1)
`);
const env=await createGodotProbeEnvironment(out);await env.run('import',['--path',project,'--editor','--import']);
const run=async name=>{const log=await env.run(name,['--path',project,'--script','res://probe.gd']);const row=log.split(/\r?\n/).find(line=>line.startsWith('EDIT_PROGRESS='));assert.ok(row);const result=JSON.parse(row.slice(14));assert.deepEqual(result.failures,[]);assert.equal(result.headless,true);assert.equal(result.captured,false);return result;};
const first=await run('open-chest');assert.equal(first.interaction.interacted,true);assert.equal(first.snapshot.inventory.wood,3);assert.equal(first.snapshot.inventory['kept-token'],7);
fs.writeFileSync(path.join(project,'saved.json'),JSON.stringify(first.snapshot));
const apply=result=>{for(const op of result.operations){source.files[op.path]=file(op.text);fs.writeFileSync(path.join(project,op.path),op.text);}targetSnapshot.target.revision=result.document.revision;};
const deleted=compileCreationOperation({source,targetSnapshot,request:{operationId:'delete-a',action:'delete',targetId:'chest-a',expected}});apply(deleted);
const absent=await run('deleted-reopen');assert.deepEqual(absent.entities,[]);assert.deepEqual(absent.snapshot.inventory,first.snapshot.inventory);assert.deepEqual(absent.snapshot.openedChests,first.snapshot.openedChests);assert.deepEqual(absent.snapshot.player,first.snapshot.player);
apply(compileCreationOperation({source,targetSnapshot,request:{operationId:'undo-a',action:'undo',undoOperationId:'delete-a',expected}}));
const restored=await run('undo-reopen');assert.deepEqual(restored.entities,['chest-a']);assert.equal(restored.interaction.reason,'already-opened');assert.deepEqual(restored.snapshot.inventory,first.snapshot.inventory);assert.deepEqual(restored.snapshot.openedChests,first.snapshot.openedChests);
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,first,absent,restored,runs:env.runs,scope:'真实Godot源码删除/撤销与跨进程进度，不替代host candidate采用验收'},null,2));console.log('删除撤销进度证据：'+out);
