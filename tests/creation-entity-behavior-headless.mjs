import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {materializeBase} from '../desktop/godot/shared/materialize.mjs';import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';
import {assertCreationScene} from '../desktop/godot/shared/creation-scene.mjs';
fs.mkdirSync('test-results',{recursive:true});const out=fs.mkdtempSync(path.resolve('test-results/entity-behavior-')),project=path.join(out,'project');
materializeBase({baseId:'creation-sandbox',worldId:'behavior-world',out:project});
// This fixture only toggles entity presence. It is not a harvest/regrowth implementation.
const code=`extends Node
var world
var entity_id = ""
var hidden = false
var refuse_restore = false
func configure(value, declaration):
    world = value
    entity_id = declaration.entityIds[0]
func on_entity_interacted(id):
    if id == entity_id:
        hidden = not hidden
        world.set_entity_presence(entity_id, not hidden, not hidden)
func snapshot(): return {"hidden":hidden}
func validate_state(state):
    return "" if state is Dictionary and state.size() == 1 and state.get("hidden") is bool else "bad state"
func project_entities(state): return {entity_id:{"visible":not state.hidden,"solid":not state.hidden}}
func restore(state):
    hidden = state.hidden
    if not refuse_restore: world.set_entity_presence(entity_id, not hidden, not hidden)
`;
fs.mkdirSync(path.join(project,'scripts/creation/rules'),{recursive:true});fs.writeFileSync(path.join(project,'scripts/creation/rules/toggle.gd'),code);
const scene={format:'craftmine.creation-scene/1',revision:2,defaults:{timeOfDay:12},entities:[{id:'tree-a',kind:'tree',position:[4,0,4],rotationY:0,scale:[1,1,1],color:'#84aa66',parameters:{}}],rules:[{id:'toggle',kind:'entity-behavior',entityIds:['tree-a'],script:'scripts/creation/rules/toggle.gd',sha256:createHash('sha256').update(code).digest('hex')}]};
assertCreationScene(scene);fs.writeFileSync(path.join(project,'world/creation.json'),JSON.stringify(scene));
fs.writeFileSync(path.join(project,'probe.gd'),`extends SceneTree
var failures = []
func check(ok, label):
    if not ok: failures.append(label)
func _initialize(): run.call_deferred()
func run():
    change_scene_to_file(ProjectSettings.get_setting("application/run/main_scene"))
    var bridge = root.get_node("CraftmineRuntime")
    for frame in range(600):
        await process_frame
        if bridge.initialized: break
    var loaded = await bridge.handle_request({"worldId":"behavior-world","buildId":"build-a","instanceId":"instance-a","op":"load","args":{}})
    check(not loaded.has("error"), "load")
    var world = current_scene
    if FileAccess.file_exists("res://saved.json"):
        var saved = JSON.parse_string(FileAccess.get_file_as_string("res://saved.json"))
        check(world.restore(saved).is_empty(), "restore hidden tree while player occupies its old collider")
        check(world.capture().rules == saved.rules, "custom state restored")
        check(not world.observe().creation.entities[0].visible and not world.observe().creation.entities[0].solid, "hidden and nonsolid persist")
    else:
        world.player.position = Vector3(4,0.9,6)
        await physics_frame
        await process_frame
        world.player.camera_rig.camera.look_at(Vector3(4,1,4))
        var interaction = world.interact_target()
        check(interaction.get("interacted", false), "real E-target dispatch to registered tree")
        var observation = world.observe().creation
        check(not observation.entities[0].visible and not observation.entities[0].solid and observation.obstacles.is_empty(), "actual presence and obstacle removal")
        var saved = world.capture()
        saved.player.position = [4,0.9,4]
        check(world.restore(saved).is_empty(), "projection allows player in hidden object location")
        saved = world.capture()
        var bad = saved.duplicate(true)
        bad.rules.toggle.hidden = false
        check(world.restore(bad).contains("overlaps"), "solid projection rejects player collision")
        check(world.capture().rules == saved.rules, "failed collision keeps previous rule state")
        bad.player.position = [0,0.9,0]
        world.rule_nodes.toggle.refuse_restore = true
        check(world.restore(bad).contains("differs from projection"), "lying restore rejected")
        check(world.capture().rules == saved.rules and world.capture().player == saved.player, "failed projection rolls back snapshot")
        world.rule_nodes.toggle.refuse_restore = false
    print("ENTITY_BEHAVIOR=" + JSON.stringify({"failures":failures,"snapshot":world.capture(),"observation":world.observe(),"headless":DisplayServer.get_name()=="headless","captured":world.player.captured}))
    quit(0 if failures.is_empty() else 1)
`);
const env=await createGodotProbeEnvironment(out);await env.run('import',['--path',project,'--editor','--import']);
const run=async name=>{const log=await env.run(name,['--path',project,'--script','res://probe.gd']);const row=log.split(/\r?\n/).find(line=>line.startsWith('ENTITY_BEHAVIOR='));assert.ok(row);const result=JSON.parse(row.slice(16));assert.deepEqual(result.failures,[]);assert.equal(result.headless,true);assert.equal(result.captured,false);return result;};
const first=await run('first');fs.writeFileSync(path.join(project,'saved.json'),JSON.stringify(first.snapshot));const restarted=await run('restarted');assert.deepEqual(restarted.snapshot,first.snapshot);
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,first,restarted,runs:env.runs,scope:'真实通用entity-behavior交互/投影/恢复；无采集重生逻辑、无模型'},null,2));console.log('通用实体行为证据：'+out);
