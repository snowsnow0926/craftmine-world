// Real pinned native Godot; isolated profile, --headless, windowsHide, no UI input.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {materializeBase} from '../desktop/godot/shared/materialize.mjs';
import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';
import {adjudicateGodotScenario,scenarioRequirementsHash} from '../vendor/pi-desktop/apps/desktop/electron/main/godot-scenario-verdict.ts';
import {doorScenario} from './fixtures/godot-door-scenario.mjs';

const root=path.resolve(import.meta.dirname,'..');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/godot-door-scenario-'));
const fileHash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function sourceManifest(directory,relative=''){
 return fs.readdirSync(path.join(directory,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(entry=>{
  const name=relative?relative+'/'+entry.name:entry.name;
  return entry.isDirectory()?sourceManifest(directory,name):[{path:name,sha256:fileHash(path.join(directory,name))}];
 });
}
const report={format:'craftmine.godot-door-scenario-evidence/1',out,passed:false,scope:'trusted-native-fixtures; not candidate service, Web export, Agent tool or real-player acceptance',setup:{fixtureRef:doorScenario.fixtureRef,playerPosition:[0,0.9,3],doorPosition:[0,0,0],method:'authored scene before process start; no later teleport'},requirementsHash:scenarioRequirementsHash(doorScenario),runs:[],variants:[]};
try{
 const env=await createGodotProbeEnvironment(out);report.runs=env.runs;report.engineVersion=env.actualVersion;
 for(const variant of ['correct','forged-open-with-collision']){
  const project=path.join(out,variant);
  materializeBase({baseId:'creation-sandbox',worldId:'gu4-door-fixture',out:project});
  const projectFile=path.join(project,'project.godot');
  fs.writeFileSync(projectFile,fs.readFileSync(projectFile,'utf8').replace('CraftmineRuntime="*res://craftmine_shared/runtime_bridge.gd"',''));
  const sceneFile=path.join(project,'scenes/creation.tscn');
  fs.writeFileSync(sceneFile,fs.readFileSync(sceneFile,'utf8').replace('position = Vector3(0, 0.9, 6)','position = Vector3(0, 0.9, 3)'));
  fs.writeFileSync(path.join(project,'world/creation.json'),JSON.stringify({format:'craftmine.creation-scene/1',revision:1,defaults:{timeOfDay:12},entities:[{id:'gate',kind:'door',position:[0,0,0],scale:[1,1,1],rotationY:0,color:'#84a866',parameters:{}}],rules:[]}));
  const worldFile=path.join(project,'scripts/creation_world.gd');
  if(variant==='forged-open-with-collision'){
   const source=fs.readFileSync(worldFile,'utf8'),target='shape.set_deferred("disabled", doors.get(id, false))';
   assert.equal(source.split(target).length,2,'fault injection must match exactly one collision release');
   fs.writeFileSync(worldFile,source.replace(target,'shape.set_deferred("disabled", false) # injected defect: reports open but remains solid'));
  }
  fs.copyFileSync(path.join(root,'tests/fixtures/godot-door-scenario.gd'),path.join(project,'scenario.gd'));
  // Freeze every materialized file including adapter/controller/scene/assets.
  // Generated scenario.json is excluded because it contains this very identity.
  const manifest=sourceManifest(project),sourceHash=createHash('sha256').update(JSON.stringify({engineVersion:env.actualVersion,manifest})).digest('hex');
  fs.writeFileSync(path.join(out,variant+'-source-manifest.json'),JSON.stringify({engineVersion:env.actualVersion,sourceHash,manifest},null,2));
  const identity={worldId:'gu4-door-fixture',buildId:'fixture-'+sourceHash,instanceId:'native-'+randomUUID()};
  fs.writeFileSync(path.join(project,'scenario.json'),JSON.stringify({identity,requirementsHash:report.requirementsHash,plan:doorScenario}));
  await env.run(variant+'-import',['--path',project,'--editor','--import']);
  await env.run(variant+'-parse',['--path',project,'--check-only','--script','res://scenario.gd']);
  const stdout=await env.run(variant+'-run',['--path',project,'--script','res://scenario.gd'],{timeout:30000});
  const transcript=JSON.parse(stdout.split(/\r?\n/).find(line=>line.startsWith('SCENARIO_TRANSCRIPT=')).slice('SCENARIO_TRANSCRIPT='.length));
  const verdict=adjudicateGodotScenario(doorScenario,identity,transcript);
  fs.writeFileSync(path.join(out,variant+'-transcript.json'),JSON.stringify(transcript,null,2));
  fs.writeFileSync(path.join(out,variant+'-verdict.json'),JSON.stringify(verdict,null,2));
  report.variants.push({variant,identity,sourceHash,verdict});
  assert.equal(verdict.status,variant==='correct'?'passed':'failed',JSON.stringify(verdict));
  if(variant!=='correct'){
   assert.equal(verdict.assertions.find(a=>a.id==='project-reports-open').status,'passed');
   assert.equal(verdict.assertions.find(a=>a.id==='actual-collision-released').status,'failed');
   assert.equal(verdict.assertions.find(a=>a.id==='opened-walk-passed-door').status,'failed');
  }
 }
 report.passed=true;
}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,variants:report.variants.map(v=>({variant:v.variant,status:v.verdict.status}))}));}
