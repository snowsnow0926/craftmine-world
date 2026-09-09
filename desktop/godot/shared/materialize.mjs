import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const here=path.dirname(fileURLToPath(import.meta.url));
const bases=path.resolve(here,'../bases');
const configs={
  'first-person':{version:'0.1.0',examples:['blank','training-range']},
  'top-down':{version:'1.0.0',examples:['blank','town']},
  'side-view':{version:'1.0.0',examples:['blank','ruins']},
  'mining-sandbox':{version:'1.0.0',examples:['blank','mine-camp']},
};
// Bases whose tools/new-world.mjs takes --template; the others take --world.
const TEMPLATE_BASES=['top-down','mining-sandbox'];

/** Materialize trusted authored base source in a new directory, never execute it. */
export function materializeBase({baseId,worldId,template='blank',out}) {
  const config=configs[baseId];
  if(!config || !config.examples.includes(template)) throw Error('Unknown base/template');
  if(typeof worldId!=='string'||!/^[a-z0-9][a-z0-9-]{1,47}$/.test(worldId)) throw Error('World identity must be a portable lowercase id');
  if(!path.isAbsolute(out)) throw Error('Output must be absolute');
  if(fs.existsSync(out)) throw Error('Output must be a fresh managed directory');
  fs.mkdirSync(path.dirname(out),{recursive:true});
  if(baseId==='first-person') {
    fs.cpSync(path.join(bases,baseId),out,{recursive:true,filter:p=>!['.godot','tests','docs','tools'].includes(path.basename(p))});
    const project=path.join(out,'project.godot');
    if(template==='blank') fs.writeFileSync(project,fs.readFileSync(project,'utf8').replace('res://scenes/training_range.tscn','res://scenes/blank_start.tscn'));
  } else {
    const args=TEMPLATE_BASES.includes(baseId)?['--template',template,'--world-id',worldId,'--name',worldId]:['--world',template,'--world-id',worldId];
    const result=spawnSync(process.execPath,[path.join(bases,baseId,'tools/new-world.mjs'),...args,'--out',out],{encoding:'utf8',windowsHide:true});
    if(result.status!==0) throw Error(result.stderr||result.stdout||'Base materialization failed');
  }
  const shared=path.join(out,'craftmine_shared');
  fs.mkdirSync(shared,{recursive:true});
  for(const file of ['runtime_bridge.gd','state_guard.gd']) fs.copyFileSync(path.join(here,file),path.join(shared,file));
  fs.copyFileSync(path.join(here,'adapters',baseId+'.gd'),path.join(shared,'base_adapter.gd'));
  const project=path.join(out,'project.godot');
  let text=fs.readFileSync(project,'utf8');
  const autoload='CraftmineRuntime="*res://craftmine_shared/runtime_bridge.gd"';
  text=text.includes('[autoload]')?text.replace('[autoload]','[autoload]\n'+autoload):text+'\n[autoload]\n'+autoload+'\n';
  text+='\n[craftmine]\nruntime/enabled=true\nruntime/world_id='+JSON.stringify(worldId)+'\nruntime/adapter="res://craftmine_shared/base_adapter.gd"\n';
  fs.writeFileSync(project,text);
  const files=[];
  for(const relative of fs.readdirSync(out,{recursive:true}).sort()) {
    const file=path.join(out,relative);
    if(fs.statSync(file).isFile()) {const bytes=fs.readFileSync(file);files.push({path:relative.replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
  }
  const manifest={format:'craftmine.managed-base-source/1',baseId,baseVersion:config.version,worldId,template,protocol:'craftmine.godot-runtime/2',progressFormat:'craftmine.godot-progress/1',stateVersion:1,files};
  fs.writeFileSync(path.join(out,'managed-base.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
