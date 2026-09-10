import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{generateSequenceDoorRule}=require('../plugins/craftmine-world/creation-sequence-rule.cjs');
test('generated GDScript executes ordered signals, wrong-order reset, one-shot latch and restore in headless Godot',{skip:!process.env.CREATION_GODOT_EXE},async()=>{
  const output=resolve('test-results');await mkdir(output,{recursive:true});const directory=await mkdtemp(join(output,'creation-rule-'));
  const generated=generateSequenceDoorRule({id:'custom-sequence',doorId:'door-alpha',sequence:['violet','gold','azure']});
  await writeFile(join(directory,'rule.gd'),generated.text);
  await writeFile(join(directory,'project.godot'),'config_version=5\n[application]\nconfig/name="Isolated generated sequence rule test"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
  await writeFile(join(directory,'probe.gd'),`extends SceneTree
class Host extends Node:
\tvar calls: Array = []
\tfunc set_door_open(id: String, opened: bool) -> void:
\t\tcalls.append([id, opened])
func _initialize() -> void:
\tvar host = Host.new()
\tvar source = load("res://rule.gd")
\tif source == null:
\t\tquit(1)
\t\treturn
\tvar rule = source.new()
\trule.configure(host, {})
\trule.on_entity_interacted("gold")
\tassert(rule.snapshot().cursor == 0)
\trule.on_entity_interacted("violet")
\trule.on_entity_interacted("wrong")
\tassert(rule.snapshot().cursor == 0)
\tfor id in ["violet", "gold", "azure"]:
\t\trule.on_entity_interacted(id)
\tassert(host.calls == [["door-alpha", true]])
\trule.on_entity_interacted("azure")
\tassert(host.calls.size() == 1)
\tvar restored = source.new()
\trestored.configure(host, {})
\tassert(restored.validate_state(rule.snapshot()) == "")
\trestored.restore(rule.snapshot())
\tassert(restored.snapshot().completed)
\tassert(host.calls.size() == 2)
\tassert(restored.validate_state({"cursor": 2, "completed": true}) != "")
\tassert(restored.validate_state({"cursor": -1, "completed": false}) != "")
\tassert(restored.validate_state({"cursor": 1.5, "completed": false}) != "")
\tassert(restored.validate_state({"cursor": 0, "completed": false, "extra": 1}) != "")
\trule.free()
\trestored.free()
\thost.free()
\tprint("CREATION_SEQUENCE_RULE_OK")
\tquit(0)
`);
  const result=spawnSync(process.env.CREATION_GODOT_EXE,['--headless','--path',directory,'--script','res://probe.gd'],{windowsHide:true,encoding:'utf8',timeout:20000,env:{...process.env,APPDATA:join(directory,'userdata'),LOCALAPPDATA:join(directory,'localdata')}});
  const log=String(result.stdout??'')+String(result.stderr??'');await writeFile(join(directory,'result.log'),log);
  assert.equal(result.error,undefined);assert.equal(result.status,0,log);assert.match(log,/CREATION_SEQUENCE_RULE_OK/);assert.doesNotMatch(log,/SCRIPT ERROR|Parse Error|Assertion failed/);
  assert.equal(await readFile(join(directory,'rule.gd'),'utf8'),generated.text);
});
