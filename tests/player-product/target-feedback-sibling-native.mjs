// Reproduces a negative baseline. Passing this test means the mismatch exists,
// not that the production runtime-expectation guard has passed.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {addTargetFeedbackSiblingOverride,siblingOverridePath} from './fixtures/target-feedback-sibling-override.mjs';

const ownRoot=path.resolve(import.meta.dirname,'../..'),engine=process.argv[2],sourceRoot=path.resolve(process.argv[3]??ownRoot);
if(!engine)throw Error('Provide the pinned Godot editor path and optionally the integrated source root');
const hash=value=>createHash('sha256').update(value).digest('hex');
const adapterPath=path.join(sourceRoot,'desktop/godot/shared/target-feedback-configuration.mjs');
const {describeTargetFeedback,patchTargetFeedback}=await import(pathToFileURL(adapterPath));
const lock=JSON.parse(await fs.readFile(path.join(sourceRoot,'desktop/godot/toolchain.lock.json'),'utf8'));
assert.equal(hash(await fs.readFile(engine)),lock.editor.executableSha256,'fixed editor identity');
await fs.mkdir(path.join(ownRoot,'test-results'),{recursive:true});
const out=await fs.mkdtemp(path.join(ownRoot,'test-results/target-sibling-')),project=path.join(out,'project');
await fs.cp(path.join(sourceRoot,'desktop/godot/bases/first-person'),project,{recursive:true});
const scenePath='scenes/training_range.tscn',original=await fs.readFile(path.join(project,scenePath),'utf8');
const fixture=addTargetFeedbackSiblingOverride(original);
assert.throws(()=>addTargetFeedbackSiblingOverride(fixture.sceneText),/EXPECTED_UNMODIFIED/);
const files=new Map();
async function readTree(dir,relative='') {
  for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
    const name=relative?relative+'/'+entry.name:entry.name;
    if(entry.isDirectory())await readTree(path.join(dir,entry.name),name);
    else files.set(name,await fs.readFile(path.join(dir,entry.name)));
  }
}
await readTree(project);files.set(scenePath,Buffer.from(fixture.sceneText));
for(const [name,body] of fixture.files){files.set(name,body);await fs.mkdir(path.dirname(path.join(project,name)),{recursive:true});await fs.writeFile(path.join(project,name),body);}
const args={sceneText:fixture.sceneText,scenePath,targetId:'target_a',files};
const before=describeTargetFeedback(args),patched=patchTargetFeedback({...args,binding:before.binding,values:{hitFlashMilliseconds:500}});
assert.equal(patched.changed,true);assert.equal(patched.values.hitFlashMilliseconds,500);
await fs.writeFile(path.join(project,scenePath),patched.text);
await fs.writeFile(path.join(project,'verify_sibling.gd'),`extends SceneTree
func _initialize() -> void:
 call_deferred("run")
func run() -> void:
 var world = load("res://scenes/training_range.tscn").instantiate()
 root.add_child(world)
 await process_frame
 var target = world.get_node("Targets/TargetA")
 var material_before = target.mesh_instance.material_override
 target.apply_damage(1.0)
 var remaining_start = target._flash_remaining
 var visual_started = target.mesh_instance.material_override != material_before
 target._process(0.501)
 var active_after_requested_duration = target._flash_remaining > 0.0 and target.mesh_instance.material_override != material_before
 target._process(0.2)
 var restored_after_actual_duration = target._flash_remaining == 0.0 and target.mesh_instance.material_override == material_before
 print("SIBLING_RESULT " + JSON.stringify({"runtimeMs": target.hit_flash_seconds * 1000, "actualFlashMs": remaining_start * 1000, "visualStarted": visual_started, "activeAfter501ms": active_after_requested_duration, "restoredAfter701ms": restored_after_actual_duration, "targetSnapshot":target.snapshot()}))
 world.queue_free()
 await process_frame
 quit(0)
`);
const bin=path.join(out,'engine.exe');await fs.copyFile(engine,bin);
const env={...process.env,APPDATA:path.join(out,'appdata'),LOCALAPPDATA:path.join(out,'local'),USERPROFILE:path.join(out,'home')};
for(const dir of [env.APPDATA,env.LOCALAPPDATA,env.USERPROFILE])await fs.mkdir(dir,{recursive:true});
let runtime;
for(const [phase,args] of [['import',['--headless','--path',project,'--editor','--import']],['verify',['--headless','--path',project,'--script','res://verify_sibling.gd']]]) {
  const result=spawnSync(bin,args,{env,windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
  await fs.writeFile(path.join(out,phase+'.log'),String(result.stdout??'')+'\n'+String(result.stderr??''));
  assert.equal(result.error,undefined,phase+' process failure: '+out);assert.equal(result.status,0,phase+' exit: '+out);
  assert.doesNotMatch(result.stdout+result.stderr,/SCRIPT ERROR|Parse Error/);
  if(phase==='verify')runtime=JSON.parse(result.stdout.split(/\r?\n/).find(line=>line.startsWith('SIBLING_RESULT ')).slice(15));
}
assert.equal(runtime.runtimeMs,700);assert.equal(runtime.actualFlashMs,700);
assert.equal(runtime.visualStarted,true);assert.equal(runtime.activeAfter501ms,true);assert.equal(runtime.restoredAfter701ms,true);
assert.equal(runtime.targetSnapshot.id,'target_a');assert.equal(runtime.targetSnapshot.hitCount,1);assert.equal(runtime.targetSnapshot.damageTaken,1);
const commit=spawnSync('git',['-C',sourceRoot,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true});
const report={negativeBaselineReproduced:true,productionGuardVerified:false,createdAt:new Date().toISOString(),sourceRoot,sourceCommit:commit.status===0?commit.stdout.trim():null,adapterSha256:hash(await fs.readFile(adapterPath)),engineSha256:lock.editor.executableSha256,originalSceneSha256:hash(original),patchedSceneSha256:hash(patched.text),siblingScriptSha256:hash(fixture.files.get(siblingOverridePath)),declaredMs:patched.values.hitFlashMilliseconds,...runtime,out};
await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
