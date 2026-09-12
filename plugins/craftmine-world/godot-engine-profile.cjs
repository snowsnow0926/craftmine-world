'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {readPck4,readCreationProjectSelectors}=require('./godot-creation-pack.cjs');
const PROFILE='engine-monitor/1';
const RESOURCES=Object.freeze({
  'craftmine_shared/runtime_bridge.gd':'shared/runtime_bridge_engine_v1.gd',
  'craftmine_shared/runtime_bridge_base.gd':'shared/runtime_bridge.gd',
  'craftmine_shared/engine_performance.gd':'shared/engine_performance.gd',
  'craftmine_shared/state_guard.gd':'shared/state_guard.gd',
  'craftmine_shared/headless_play_action.gd':'shared/headless_play_action.gd',
});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Error(code);};
const alias=(candidate,name)=>typeof candidate==='string'&&(candidate.toLowerCase()===name||candidate.toLowerCase().startsWith(name+'.')||candidate.toLowerCase()===name.slice(0,-3)+'.gdc'||candidate.toLowerCase().startsWith(name.slice(0,-3)+'.gdc.'));

// Only app-owned resource paths define authority. A source manifest cannot
// elect its own collector hash. Missing versioned resources mean unsupported.
function loadEnginePerformancePins(root){
  if(!Object.values(RESOURCES).every(relative=>fs.existsSync(path.join(root,relative))))return null;
  return Object.freeze(Object.fromEntries(Object.entries(RESOURCES).map(([name,relative])=>{
    const text=fs.readFileSync(path.join(root,relative),'utf8').replace(/\r\n/g,'\n');
    const variants=[text,text.replace(/\n/g,'\r\n')].map(value=>Object.freeze({bytes:Buffer.byteLength(value),sha256:hash(value)}));
    return [name,Object.freeze(variants)];
  })));
}

function hasEnginePerformanceSource(files,pins){
  if(!pins||!Array.isArray(files))return false;
  for(const name of Object.keys(RESOURCES)){
    const entries=files.filter(file=>file?.path===name);
    if(entries.length!==1||!pins[name]?.some(pin=>pin.sha256===entries[0].sha256&&pin.bytes===entries[0].bytes))return false;
    if(files.some(file=>file?.path!==name&&alias(file?.path,name)))return false;
  }
  return true;
}

function verifyEnginePerformancePack(buffer,sourceFiles,pins){
  if(!hasEnginePerformanceSource(sourceFiles,pins))fail('ENGINE_MONITOR_SOURCE_UNVERIFIED');
  const pack=readPck4(buffer),verified=[];
  for(const name of Object.keys(RESOURCES)){
    const source=sourceFiles.find(file=>file.path===name),entry=pack.files.get(name);
    if([...pack.files.keys()].some(candidate=>candidate!==name&&alias(candidate,name)))fail('ENGINE_MONITOR_PACK_ALIAS');
    if(!entry||entry.bytes!==source.bytes||entry.sha256!==source.sha256)fail('ENGINE_MONITOR_PACK_MISMATCH');
    verified.push({path:name,bytes:entry.bytes,sha256:entry.sha256});
  }
  if([...pack.files.keys()].some(name=>name.toLowerCase()==='override.cfg'))fail('ENGINE_MONITOR_PACK_OVERRIDE');
  const project=pack.files.get('project.binary');if(!project)fail('ENGINE_MONITOR_PACK_PROJECT_REQUIRED');
  const selectors=readCreationProjectSelectors(project.data);
  return {format:'craftmine.engine-monitor-pack-proof/1',profile:PROFILE,packSha256:hash(buffer),packBytes:buffer.length,
    files:verified,project:{sha256:project.sha256,selectors},
    boundary:'Proves fixed resource bytes and bootstrap selectors, not isolation from other scripts in the running process.'};
}
module.exports={PROFILE,RESOURCES,loadEnginePerformancePins,hasEnginePerformanceSource,verifyEnginePerformancePack};
