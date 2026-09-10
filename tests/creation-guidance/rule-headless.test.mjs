// 固定 Godot 引擎执行指南中的普通规则源码；不连接模型，不模拟输入。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {materializeBase} from '../../desktop/godot/shared/materialize.mjs';
import {createGodotProbeEnvironment} from '../../desktop/godot/toolchain.mjs';
const root=path.resolve(import.meta.dirname,'../..');
test('指南普通双按规则在真实世界加载、拒绝错误进度并跨进程保留自定义状态',async()=>{
 fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
 const out=fs.mkdtempSync(path.join(root,'test-results/guidance-rule-')),project=path.join(out,'project');
 materializeBase({baseId:'creation-sandbox',worldId:'guidance-world',out:project});
 const source=fs.readFileSync(path.join(root,'plugins/craftmine-world/guidance/references/double-press-rule.gd'));
 fs.mkdirSync(path.join(project,'scripts/creation/rules'),{recursive:true});
 fs.writeFileSync(path.join(project,'scripts/creation/rules/example.gd'),source);
 const entity=(id,kind,x)=>({id,kind,position:[x,0,0],rotationY:0,scale:[1,1,1],color:'#84aa66',parameters:{}});
 fs.writeFileSync(path.join(project,'world/creation.json'),JSON.stringify({format:'craftmine.creation-scene/1',revision:2,defaults:{timeOfDay:12},
  entities:[entity('door','door',0),entity('first','marker',3),entity('second','marker',5)],
  rules:[{id:'example',kind:'sequence-door',doorId:'door',sequence:['first','second'],script:'scripts/creation/rules/example.gd',sha256:createHash('sha256').update(source).digest('hex')}]}));
 fs.writeFileSync(path.join(project,'guidance_probe.gd'),`extends SceneTree
var failures: Array[String] = []
func check(value: bool, label: String) -> void:
    if not value: failures.append(label)
func _initialize() -> void:
    run.call_deferred()
func run() -> void:
    change_scene_to_file(ProjectSettings.get_setting("application/run/main_scene"))
    var bridge = root.get_node("CraftmineRuntime")
    for frame in range(600):
        await process_frame
        if bridge.initialized: break
    check(bridge.initialized, "世界初始化")
    if not bridge.initialized:
        print("GUIDANCE_RESULT=" + JSON.stringify({"failures":failures}))
        quit(1)
        return
    var loaded = await bridge.handle_request({"worldId":"guidance-world","buildId":"guidance-build","instanceId":"guidance-instance","op":"load","args":{}})
    check(not loaded.has("error"), "桥绑定")
    var world = current_scene
    var rule = world.rule_nodes.example
    var partial: Dictionary
    if "restore" in OS.get_cmdline_user_args():
        partial = JSON.parse_string(FileAccess.get_file_as_string("res://partial.json"))
        check(world.restore(partial).is_empty(), "跨进程恢复自定义规则")
        check(JSON.parse_string(JSON.stringify(world.capture())) == JSON.parse_string(JSON.stringify(partial)), "恢复不丢字段或改变值")
    else:
        rule.on_entity_interacted("first")
        rule.on_entity_interacted("second")
        check(not world.doors.door and rule.snapshot().presses == 0, "一次第一标记不能开门")
        rule.on_entity_interacted("first")
        rule.on_entity_interacted("first")
        rule.on_entity_interacted("unrelated")
        check(rule.snapshot().presses == 0, "无关互动重置")
        rule.on_entity_interacted("first")
        partial = world.capture()
    check(rule.snapshot().presses == 1, "保留部分进度")
    var invalid = partial.duplicate(true)
    invalid.rules.example.presses = 99
    check(not world.restore(invalid).is_empty(), "拒绝越界自定义进度")
    check(JSON.parse_string(JSON.stringify(world.capture())) == JSON.parse_string(JSON.stringify(partial)), "失败恢复保持原状态")
    rule.on_entity_interacted("first")
    rule.on_entity_interacted("second")
    await process_frame
    check(world.doors.door and rule.snapshot().completed, "普通源码行为真实开门")
    check(world.entity_nodes.door.get_node("Body").get_child(0).disabled, "真实阻挡关闭")
    var final = world.capture()
    rule.on_entity_interacted("first")
    check(JSON.parse_string(JSON.stringify(world.capture())) == JSON.parse_string(JSON.stringify(final)), "完成状态不重复改变")
    print("GUIDANCE_RESULT=" + JSON.stringify({"failures":failures,"partial":partial,"final":final,"headless":DisplayServer.get_name() == "headless","captured":world.player.captured}))
    quit(0 if failures.is_empty() else 1)
`);
 const env=await createGodotProbeEnvironment(out,{web:true,threads:true});
 await env.run('import',['--path',project,'--editor','--import']);
 const result=async(label,args=[])=>{
  const log=await env.run(label,['--path',project,'--script','res://guidance_probe.gd',...args]);
  const row=log.split(/\r?\n/).find(line=>line.startsWith('GUIDANCE_RESULT='));assert.ok(row);
  const body=JSON.parse(row.slice('GUIDANCE_RESULT='.length));assert.deepEqual(body.failures,[]);assert.equal(body.headless,true);assert.equal(body.captured,false);return body;
 };
 const first=await result('first');fs.writeFileSync(path.join(project,'partial.json'),JSON.stringify(first.partial));
 const restarted=await result('restarted',['--','restore']);
 assert.deepEqual(restarted.final,first.final);
 assert.deepEqual(restarted.final.rules.example,{presses:2,completed:true});
 const host=fs.readFileSync(path.join(root,'vendor/pi-desktop/crates/craftmine-core/src/godot_host_resources.rs'),'utf8');
 const serialized=host.match(/const EXPORT_PRESET: &str = ("(?:[^"\\]|\\.)*");/);
 assert.ok(serialized,'生产Web预设必须可以按真实字节读取');
 const webPreset=JSON.parse(serialized[1]);
 assert.match(webPreset,/script_export_mode=0/);assert.match(webPreset,/include_filter="\*\.json,\*\.txt"/);
 fs.copyFileSync(path.join(root,'desktop/godot/web/shell.html'),path.join(project,'craftmine_host_shell.html'));
 const windowsPreset=fs.readFileSync(path.join(root,'desktop/godot/shared/windows-export.cfg'),'utf8');
 assert.match(windowsPreset,/script_export_mode=0/);
 assert.equal(windowsPreset,fs.readFileSync(path.join(root,'desktop/godot/sandbox/windows-export.cfg'),'utf8').replace(/\r\n/g,'\n'));
 const packages={};
 for(const [label,preset,platform] of [['web',webPreset,'Web'],['windows',windowsPreset,'Windows Desktop']]){
  const fixed=preset.replace('custom_template/release=""','custom_template/release='+JSON.stringify(env.webTemplate.replaceAll('\\','/')));
  fs.writeFileSync(path.join(project,'export_presets.cfg'),label==='web'?fixed:preset);
  const pack=path.join(out,label+'.pck');
  await env.run(label+'-pack-export',['--path',project,'--export-pack',platform,pack]);
  const output=await env.run(label+'-pack-restore',['--main-pack',pack,'--script','res://guidance_probe.gd','--','restore']);
  const line=output.split(/\r?\n/).find(line=>line.startsWith('GUIDANCE_RESULT='));
  packages[label]=JSON.parse(line.slice('GUIDANCE_RESULT='.length));
  assert.deepEqual(packages[label].failures,[]);assert.deepEqual(packages[label].final,first.final);
 }
 // 编译模式修复不能放松规则字节完整性检查。
 fs.appendFileSync(path.join(project,'scripts/creation/rules/example.gd'),'\n# deliberate integrity mismatch\n');
 const tampered=path.join(out,'tampered.pck');
 await env.run('tampered-pack-export',['--path',project,'--export-pack','Windows Desktop',tampered]);
 await assert.rejects(env.run('tampered-pack-probe',['--main-pack',tampered,'--quit-after','2']));
 assert.match(fs.readFileSync(path.join(out,'tampered-pack-probe.log'),'utf8'),/Authored rule source hash mismatch: example/);
 const report={tamperedRuleRejected:true,packages,format:'craftmine.guidance-rule-evidence/1',engine:env.actualVersion,runs:env.runs,first,restarted,
  coverage:'真实 Godot 普通规则源码和自定义进度往返；不代表模型首次成功率、玩家输入手感或完整主机采用。'};
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log('双按规则证据：'+out);
});
