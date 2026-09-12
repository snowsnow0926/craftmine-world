import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {materializeBase} from '../../desktop/godot/shared/materialize.mjs';
import {createGodotProbeEnvironment} from '../../desktop/godot/toolchain.mjs';
import {buildBuiltinPetPackage} from '../../desktop/build-builtin-pet-package.mjs';
import {unpackStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';

const root=process.cwd(), outputRoot=path.resolve(process.env.CRAFTMINE_TEST_OUTPUT_ROOT??path.join(root,'test-results'));
fs.mkdirSync(outputRoot,{recursive:true});
const out=fs.mkdtempSync(path.join(outputRoot,'sandbox-combat-')),project=path.join(out,'project');
const report={format:'craftmine.sandbox-combat-test/1',modelCalls:0,passed:false,phases:[]};
try{
 materializeBase({baseId:'creation-sandbox',worldId:'combat-world',out:project});
 for(const name of ['combat-vitals','sandbox-weapon','sandbox-monster'])fs.cpSync(path.join(root,'desktop/godot/components',name),path.join(project,'components',name),{recursive:true});
 const archive=unpackStaticPackage(buildBuiltinPetPackage({repository:root}).bytes);
 for(const [name,bytes]of archive.resources[0].files){const file=path.join(project,'addons/cw.module.pet-companion',name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
 fs.copyFileSync(path.join(root,'tests/godot-components/sandbox-combat.gd'),path.join(project,'driver.gd'));
 const component=(node,script,id,extra='')=>`[node name="${node}" type="${node==='Monster'?'CharacterBody3D':'Node3D'}" parent="."]\nscript = ExtResource("${script}")\nentity_id = "${id}"\n${extra}\n`;
 fs.writeFileSync(path.join(project,'combat-world.tscn'),'[gd_scene load_steps=6 format=3]\n[ext_resource type="PackedScene" path="res://scenes/creation.tscn" id="base"]\n[ext_resource type="Script" path="res://components/combat-vitals/scripts/combat_vitals.gd" id="vitals"]\n[ext_resource type="Script" path="res://components/sandbox-weapon/scripts/sandbox_weapon.gd" id="weapon"]\n[ext_resource type="Script" path="res://components/sandbox-monster/scripts/sandbox_monster.gd" id="monster"]\n[ext_resource type="PackedScene" path="res://addons/cw.module.pet-companion/scenes/pet_companion.tscn" id="pet"]\n[node name="CreationWorld" instance=ExtResource("base")]\n'+component('Vitals','vitals','player-vitals')+component('Weapon','weapon','player-weapon')+component('Monster','monster','monster-one','position = Vector3(0, 0, 2)')+'[node name="Pet" parent="." instance=ExtResource("pet")]\nentity_id = "pet-one"\nposition = Vector3(4, 0, 4)\nfollowing = false\n');
 const env=await createGodotProbeEnvironment(out);report.runs=env.runs;
 await env.run('import',['--path',project,'--editor','--import']);
 let stateFile;
 for(const phase of ['gameplay','reopen']){
  const saveFile=path.join(out,phase+'-state.json');fs.writeFileSync(path.join(project,'combat-config.json'),JSON.stringify({phase,saveFile,...(stateFile?{stateFile}:{})}));
  const stdout=await env.run(phase,['--path',project,'--script','res://driver.gd']);
  const line=stdout.split(/\r?\n/).find(line=>line.startsWith('SANDBOX_COMBAT='));assert.ok(line,'missing integration evidence');
  report.phases.push(JSON.parse(line.slice('SANDBOX_COMBAT='.length)));stateFile=saveFile;
 }
 assert.equal(report.phases[0].state.body.components['monster-one'].lootTaken,true);
 assert.equal(report.phases[1].state.body.inventory['monster-token'],1);
 report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,error:report.error}));}
