import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createGodotProbeEnvironment} from '../../desktop/godot/toolchain.mjs';
import {materializeBase} from '../../desktop/godot/shared/materialize.mjs';
import {buildReusableJ20Package,APPROVED_J20_SHA256} from '../../desktop/build-reusable-j20-package.mjs';
import {unpackStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';
const root=path.resolve(import.meta.dirname,'../..'),sha=b=>createHash('sha256').update(b).digest('hex');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/reusable-j20-')),project=path.join(out,'project');
materializeBase({baseId:'creation-sandbox',worldId:'reusable-j20-test',out:project});
const originalFiles=['scripts/creation_world.gd','scripts/reused/player_controller.gd','world/creation.json','scenes/creation.tscn'];
const originalHashes=Object.fromEntries(originalFiles.map(file=>[file,sha(fs.readFileSync(path.join(project,file)))]));
const packaged=buildReusableJ20Package({repository:root}),resource=unpackStaticPackage(packaged.bytes).resources[0];
const addon=path.join(project,'addons/cw.module.reusable-j20');for(const [file,bytes]of resource.files){const target=path.join(addon,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
assert.equal(sha(fs.readFileSync(path.join(addon,'model.glb'))),APPROVED_J20_SHA256);
for(const item of resource.manifest.content.entry.sourceRequirements)assert.equal(sha(fs.readFileSync(path.join(project,item.path))),item.sha256);
fs.copyFileSync(path.join(root,'tests/godot-components/reusable-j20.gd'),path.join(project,'probe.gd'));
fs.writeFileSync(path.join(project,'open-flight-area.gd'),`extends "res://scripts/creation_world.gd"
func _build_environment() -> void:
 var environment := WorldEnvironment.new()
 environment.environment = Environment.new()
 environment.environment.background_mode = Environment.BG_COLOR
 environment.environment.background_color = Color("719abb")
 add_child(environment)
 sun = DirectionalLight3D.new()
 add_child(sun)
 _box(self,Vector3(5000,0.4,5000),Vector3(0,-0.2,0),Color("4f6b5a"))
 _solid(self,Vector3(5000,0.4,5000),Vector3(0,-0.2,0),"ground")
 _box(self,Vector3(56,0.01,2400),Vector3(-6,0.005,-800),Color("555b62"))
 marker = MeshInstance3D.new()
 marker.mesh = SphereMesh.new()
 marker.visible = false
 add_child(marker)
 var statue := Node3D.new()
 statue.name = "ExistingStatue"
 statue.position = Vector3(100,0,10)
 add_child(statue)
 _box(statue,Vector3(2,4,2),Vector3(0,2,0),Color("d89c41"))
`);
const scene=wide=>`[gd_scene load_steps=${wide?5:4} format=3]
[ext_resource type="PackedScene" path="res://scenes/creation.tscn" id="base"]
[ext_resource type="PackedScene" path="res://addons/cw.module.reusable-j20/aircraft.tscn" id="jet"]
${wide?'[ext_resource type="Script" path="res://open-flight-area.gd" id="wide"]':''}
[node name="CreationWorld" instance=ExtResource("base")]
${wide?'script = ExtResource("wide")':''}
[node name="FirstJet" parent="." instance=ExtResource("jet")]
entity_id = "j20-first"
[node name="SecondJet" parent="." instance=ExtResource("jet")]
position = Vector3(32,2.18,0)
entity_id = "j20-second"
`;
const engine=await createGodotProbeEnvironment(out),report={format:'craftmine.reusable-j20-engine-test/1',out,modelCalls:0,productProfilesOpened:0,physicalInputSent:false,engine:engine.actualVersion,archiveSha256:sha(packaged.bytes),phases:[],ok:false};
async function phase(name,{wide=true,stateFile}={}){
 fs.writeFileSync(path.join(project,'aircraft-world.tscn'),scene(wide));fs.writeFileSync(path.join(project,'probe-config.json'),JSON.stringify({phase:name,output:path.join(out,name+'.json'),saveFile:path.join(out,name+'-save.json'),worldId:'reusable-j20-test',buildId:'j20-component-native',instanceId:randomUUID(),...(stateFile?{stateFile}:{})}));
 await engine.run(name+'-import',['--path',project,'--editor','--import']);await engine.run(name,['--path',project,'--script','res://probe.gd','--fixed-fps','60'],{timeout:180000});
 const result=JSON.parse(fs.readFileSync(path.join(out,name+'.json')));assert.equal(result.ok,true);report.phases.push({phase:name,result});return path.join(out,name+'-save.json');
}
try{
 await phase('stock-refused',{wide:false});const airborne=await phase('flight');const parked=await phase('reopen-flight',{stateFile:airborne});await phase('reopen-parked',{stateFile:parked});await phase('crash');
 for(const [file,expected]of Object.entries(originalHashes))assert.equal(sha(fs.readFileSync(path.join(project,file))),expected,'Existing target source changed: '+file);
 for(const [file,bytes]of resource.files)if(!file.endsWith('.import'))assert.equal(sha(fs.readFileSync(path.join(addon,file))),sha(bytes));
 report.originalTargetSourceUnchanged=true;report.ok=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}finally{report.runs=engine.runs;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,ok:report.ok,error:report.error?.split('\n')[0],phases:report.phases.map(p=>({phase:p.phase,checks:p.result.checks.length}))}));}
