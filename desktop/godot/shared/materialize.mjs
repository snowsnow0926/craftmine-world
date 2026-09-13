import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {materializeWorldTemplate} from './world-templates.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const bases=path.resolve(here,'../bases');
const configs={
  'creation-sandbox':{version:'1.0.0',examples:['blank']},
  'first-person':{version:'0.1.0',examples:['blank','training-range']},
  'top-down':{version:'1.0.0',examples:['blank','town']},
  'side-view':{version:'1.0.0',examples:['blank','ruins']},
  'mining-sandbox':{version:'1.0.0',examples:['blank','mine-camp']},
};
// Bases whose tools/new-world.mjs takes --template; the others take --world.
const TEMPLATE_BASES=['top-down','mining-sandbox'];

/** Materialize trusted authored base source in a new directory, never execute it. */
export function materializeBase({baseId,worldId,template='blank',out,controllerProfile='creation-player-collision/1',enginePerformanceProfile}) {
  // New creation worlds provide visual editing without a performance opt-in.
  // The collector remains request-driven; retained templates keep their source.
  if(baseId==='creation-sandbox'&&enginePerformanceProfile===undefined)enginePerformanceProfile='engine-monitor/1';
  if(baseId==='creation-sandbox'&&template.startsWith('promo-'))return materializeWorldTemplate({worldId,template,out});
  const config=configs[baseId];
  if(!config || !config.examples.includes(template)) throw Error('Unknown base/template');
  if(enginePerformanceProfile!==undefined&&enginePerformanceProfile!=='engine-monitor/1')throw Error('Unknown engine performance profile');
  if(typeof worldId!=='string'||!/^[a-z0-9][a-z0-9-]{1,47}$/.test(worldId)) throw Error('World identity must be a portable lowercase id');
  if(!path.isAbsolute(out)) throw Error('Output must be absolute');
  if(fs.existsSync(out)) throw Error('Output must be a fresh managed directory');
  fs.mkdirSync(path.dirname(out),{recursive:true});
  if(baseId==='first-person'||baseId==='creation-sandbox') {
    fs.cpSync(path.join(bases,baseId),out,{recursive:true,filter:p=>!['.godot','tests','docs','tools'].includes(path.basename(p))});
    const project=path.join(out,'project.godot');
    if(baseId==='first-person'&&template==='blank') fs.writeFileSync(project,fs.readFileSync(project,'utf8').replace('res://scenes/training_range.tscn','res://scenes/blank_start.tscn'));
  } else {
    const args=TEMPLATE_BASES.includes(baseId)?['--template',template,'--world-id',worldId,'--name',worldId]:['--world',template,'--world-id',worldId];
    const result=spawnSync(process.execPath,[path.join(bases,baseId,'tools/new-world.mjs'),...args,'--out',out],{encoding:'utf8',windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
    if(result.status!==0) throw Error(result.stderr||result.stdout||'Base materialization failed');
  }
  const shared=path.join(out,'craftmine_shared');
  fs.mkdirSync(shared,{recursive:true});
  for(const file of ['runtime_bridge.gd','state_guard.gd','headless_play_action.gd','scene_mesh_picker.gd','component_state.gd']) fs.copyFileSync(path.join(here,file),path.join(shared,file));
  if(enginePerformanceProfile==='engine-monitor/1') {
    fs.copyFileSync(path.join(here,'runtime_bridge.gd'),path.join(shared,'runtime_bridge_base.gd'));
    fs.copyFileSync(path.join(here,'runtime_bridge_engine_v1.gd'),path.join(shared,'runtime_bridge.gd'));
    fs.copyFileSync(path.join(here,'engine_performance.gd'),path.join(shared,'engine_performance.gd'));
  }
  fs.copyFileSync(path.join(here,'adapters',baseId+'.gd'),path.join(shared,'base_adapter.gd'));
  if(baseId==='creation-sandbox') {
    if(!['legacy','creation-fixed-controller/1','creation-player-collision/1'].includes(controllerProfile))throw Error('Unknown creation controller profile');
    if(controllerProfile!=='legacy') {
      fs.copyFileSync(path.join(here,'adapters/creation-sandbox.gd'),path.join(shared,'base_adapter_legacy.gd'));
      fs.copyFileSync(path.join(here,'controller_evidence.gd'),path.join(shared,'controller_evidence.gd'));
      fs.copyFileSync(path.join(here,'scene_mesh_picker_v2.gd'),path.join(shared,'scene_mesh_picker_v2.gd'));
      fs.copyFileSync(path.join(here,'adapters/creation-sandbox-controller-v1.gd'),path.join(shared,'base_adapter.gd'));
      if(controllerProfile==='creation-player-collision/1') {
        fs.copyFileSync(path.join(here,'adapters/creation-sandbox-controller-v1.gd'),path.join(shared,'base_adapter_controller_v1.gd'));
        fs.copyFileSync(path.join(here,'progress_collision.gd'),path.join(shared,'progress_collision.gd'));
        fs.copyFileSync(path.join(here,'adapters/creation-sandbox-controller-v2.gd'),path.join(shared,'base_adapter.gd'));
      }
    }
  }
  const project=path.join(out,'project.godot');
  let text=fs.readFileSync(project,'utf8');
  const autoload='CraftmineRuntime="*res://craftmine_shared/runtime_bridge.gd"';
  text=text.includes('[autoload]')?text.replace('[autoload]','[autoload]\n'+autoload):text+'\n[autoload]\n'+autoload+'\n';
  text+='\n[craftmine]\nruntime/enabled=true\nruntime/world_id='+JSON.stringify(worldId)+'\nruntime/adapter="res://craftmine_shared/base_adapter.gd"\n';
  fs.writeFileSync(project,text);
  // The starting state is captured from the authored scene with our fixed
  // engine. Rebind only its world identity; gameplay fields remain unchanged.
  const initialFile=path.join(here,'initial-states',baseId+'-'+template+'.json');
  if(fs.existsSync(initialFile)) {
    const initial=JSON.parse(fs.readFileSync(initialFile,'utf8'));
    if(initial.format!=='craftmine.authored-initial-state/1'||initial.baseId!==baseId||initial.template!==template||!initial.snapshot?.body)throw Error('Invalid authored initial state');
    const body=structuredClone(initial.snapshot.body);
    body.worldId=worldId;
    if(baseId==='mining-sandbox') {
      if(body.state?.worldId!==initial.worldId)throw Error('Invalid authored mining state identity');
      body.state.worldId=worldId;
    }
    fs.writeFileSync(path.join(out,'craftmine_initial_state.json'),JSON.stringify({
      format:'craftmine.materialized-initial-state/1',baseId,template,worldId,
      sourceDigest:initial.sourceDigest,engine:initial.engine,initialProgress:body,
    },null,2)+'\n');
  }
  const files=[];
  for(const relative of fs.readdirSync(out,{recursive:true}).sort()) {
    const file=path.join(out,relative);
    if(fs.statSync(file).isFile()) {const bytes=fs.readFileSync(file);files.push({path:relative.replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
  }
  const manifest={format:'craftmine.managed-base-source/1',baseId,baseVersion:config.version,worldId,template,protocol:'craftmine.godot-runtime/2',progressFormat:'craftmine.godot-progress/1',stateVersion:1,files,...(enginePerformanceProfile!==undefined?{enginePerformanceProfile}:{})};
  fs.writeFileSync(path.join(out,'managed-base.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
