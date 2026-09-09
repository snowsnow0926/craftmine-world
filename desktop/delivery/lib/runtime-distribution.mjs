import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ordinarySource} from './source-bytes.mjs';

export function runtimeRepositoryPath(relative){
  const value=relative.replaceAll('\\','/');
  if(value.startsWith('resources/godot/'))return 'desktop/godot/'+value.slice('resources/godot/'.length);
  return null;
}
export function loadRuntimeDistribution(root){
  const index=new Map(),directory='desktop/delivery/base-assets';
  for(const name of fs.readdirSync(path.join(root,directory)).filter(x=>x.endsWith('.json')).sort()){
    const manifest=JSON.parse(fs.readFileSync(ordinarySource(root,directory+'/'+name),'utf8'));
    if(manifest.format!=='craftmine.base-assets/1')throw Error('RUNTIME_ASSET_MANIFEST_INVALID:'+name);
    for(const [entries,prefix]of [[manifest.entries,manifest.sourceDirectory+'/'],[manifest.externalEntries,'']])for(const entry of entries||[]){
      const relative=prefix+entry.path;
      if(relative.includes('\\')||relative.includes(':')||relative.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('RUNTIME_ASSET_PATH_INVALID');
      const existing=index.get(relative)||[];existing.push({manifest:name,...entry});index.set(relative,existing);
    }
  }
  return index;
}
export function runtimeDecision(relative,index){
  if(relative.startsWith('desktop/godot/bases/tests/'))return {include:false,reason:'reserved-development-tests'};
  const entries=index.get(relative);
  if(!entries?.length)throw Error('RUNTIME_DISTRIBUTION_UNDECLARED:'+relative);
  const included=entries.some(entry=>entry.distribution?.includes('app-bundle'));
  if(included&&entries.some(entry=>entry.distribution?.includes('app-bundle')&&['denied','unreviewed','unrevealed'].includes(entry.redistribution)))throw Error('RUNTIME_REDISTRIBUTION_DENIED:'+relative);
  return {include:included,reason:included?'app-bundle':'excluded-by-declared-distribution'};
}
// Uses the same filtering/copy routine in real staging and the small fixture.
// `sources` contains bytes already proven against the frozen Git objects.
export function stageRuntimeSourceSnapshot(sources,destination,index){
  if(!path.isAbsolute(destination))throw Error('ABSOLUTE_RUNTIME_DESTINATION_REQUIRED');
  let current=path.resolve(destination);
  while(!fs.existsSync(current))current=path.dirname(current);
  for(;;){if(fs.lstatSync(current).isSymbolicLink()||!fs.statSync(current).isDirectory())throw Error('RUNTIME_DESTINATION_LINK_DENIED');const parent=path.dirname(current);if(parent===current)break;current=parent;}
  if(fs.existsSync(destination)&&fs.readdirSync(destination).length)throw Error('EMPTY_RUNTIME_DESTINATION_REQUIRED');
  const selected=[],excluded=[];
  for(const [relative,file]of sources){
    if(!/^desktop\/godot\/(bases|shared|web)\//.test(relative))throw Error('RUNTIME_SOURCE_SCOPE_INVALID:'+relative);
    const decision=runtimeDecision(relative,index);
    if(!decision.include){excluded.push({path:relative,reason:decision.reason});continue;}
    const digest=createHash('sha256').update(file.bytes).digest('hex');
    const declarations=index.get(relative);
    if(!declarations.some(entry=>entry.distribution?.includes('app-bundle')&&entry.sha256===digest&&entry.bytes===file.bytes.length))throw Error('RUNTIME_DECLARED_PIN_MISMATCH:'+relative);
    selected.push({relative,bytes:file.bytes,sha256:digest});
  }
  // Validate the entire plan before writing any managed source.
  fs.mkdirSync(destination,{recursive:true});
  for(const file of selected){const target=path.join(destination,file.relative.slice('desktop/godot/'.length));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,file.bytes);}
  return {included:selected.map(x=>({path:x.relative,bytes:x.bytes.length,sha256:x.sha256})),excluded};
}
