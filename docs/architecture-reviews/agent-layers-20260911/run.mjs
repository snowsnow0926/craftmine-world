import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url);
const repository=process.cwd();
const {generateSequenceDoorRule}=require(path.join(repository,'plugins/craftmine-world/creation-sequence-rule.cjs'));
const {materializeCreationRuntime,advanceSequenceDoor}=await import(pathToFileURL(path.join(repository,'desktop/godot/shared/creation_runtime.mjs')).href);
const scriptDirectory=path.dirname(fileURLToPath(import.meta.url));
const output=path.join(repository,'test-results','agent-layers-review-20260911');
fs.mkdirSync(output,{recursive:true});
const isolated=fs.mkdtempSync(path.join(output,'engine-'));
const godot=path.join(repository,'desktop/build/godot/4.7.2-stable/editor/Godot_v4.7.2-stable_win64_console.exe');
const sourcePaths=[
  'desktop/godot/bases/first-person/scripts/core/creation_renderer.gd',
  'desktop/godot/shared/creation_runtime.mjs',
  'plugins/craftmine-world/creation-sequence-rule.cjs',
  'plugins/craftmine-world/creation-operations.cjs',
  'plugins/craftmine-world/world-tools.cjs',
];
const sourceHashes=Object.fromEntries(sourcePaths.map(relative=>[relative,createHash('sha256').update(fs.readFileSync(path.join(repository,relative))).digest('hex')]));
const generated=generateSequenceDoorRule({id:'audit-sequence',doorId:'door-a',sequence:['blue','red','green']});
const entity=(id,kind,position)=>({id,kind,position,rotationY:0,scale:[1,1,1],color:'#84a866',parameters:{}});
const scene={format:'craftmine.creation-scene/1',revision:3,defaults:{timeOfDay:12},entities:[
  entity('tree-a','tree',[4,0,4]),entity('door-a','door',[8,0,4]),
  entity('blue','marker',[12,0,4]),entity('red','marker',[16,0,4]),entity('green','marker',[20,0,4]),
],rules:[generated.declaration]};
fs.mkdirSync(path.join(isolated,'world'),{recursive:true});
fs.copyFileSync(path.join(repository,sourcePaths[0]),path.join(isolated,'creation_renderer.gd'));
fs.writeFileSync(path.join(isolated,'rule.gd'),generated.text);
fs.writeFileSync(path.join(isolated,'world','creation.json'),JSON.stringify(scene));
fs.writeFileSync(path.join(isolated,'project.godot'),'config_version=5\n[application]\nconfig/name="Isolated layer audit"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
fs.copyFileSync(path.join(scriptDirectory,'probe.gd'),path.join(isolated,'probe.gd'));
const executed=spawnSync(godot,['--headless','--path',isolated,'--script','res://probe.gd'],{
  windowsHide:true,encoding:'utf8',timeout:20000,
  env:{...process.env,APPDATA:path.join(isolated,'userdata'),LOCALAPPDATA:path.join(isolated,'localdata')},
});
const log=String(executed.stdout??'')+String(executed.stderr??'');
fs.writeFileSync(path.join(output,'engine.log'),log);
const line=log.split(/\r?\n/).find(line=>line.startsWith('LAYER_AUDIT_JSON='));
if(executed.error||executed.status!==0||!line||/SCRIPT ERROR|Parse Error|Assertion failed/.test(log)){
  console.error(log);throw Error(executed.error?.message??'Engine audit failed to execute');
}
const actual=JSON.parse(line.slice('LAYER_AUDIT_JSON='.length));
const sequences={normal:['blue','red','green'],repeat_first:['blue','blue','red','green'],unrelated:['blue','unrelated','red','green']};
const comparisons=Object.fromEntries(Object.entries(sequences).map(([name,events])=>{
  let state=materializeCreationRuntime(scene);
  for(const id of events)state=advanceSequenceDoor(state,id);
  return [name,{events,projectionOpen:state.rules[0].open,generatedScriptOpen:actual.sequence[name].open,agree:state.rules[0].open===actual.sequence[name].open}];
}));
const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).stdout.trim();
const report={recordedAt:new Date().toISOString(),head,scope:'Fixed isolated real Godot script and node-tree diagnostic; no model, rendered pixels, input, client application or player data',sourceHashes,
  sourceStable:sourcePaths.every(relative=>sourceHashes[relative]===createHash('sha256').update(fs.readFileSync(path.join(repository,relative))).digest('hex')),
  comparisons,renderer:actual.renderer,isolatedProject:isolated,engineExitCode:executed.status};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
