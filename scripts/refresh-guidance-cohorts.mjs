// Developer-only reviewed corpus refresh. No project code is executed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {materializeBase} from '../desktop/godot/shared/materialize.mjs';
import {loadSceneObserverPins,currentSceneObserverProfile} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-observer-pins.ts';
const root=path.resolve(import.meta.dirname,'..'),hash=text=>createHash('sha256').update(text).digest('hex');
const catalogPath=path.join(root,'plugins/craftmine-world/guidance/catalog.json');
const catalog=JSON.parse(fs.readFileSync(catalogPath)),skill=catalog.skills.find(item=>item.id==='creation-sandbox.authoring');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'guidance-cohorts-'));
const profiles=['creation-fixed-controller/1','creation-player-collision/1'];
try{
 const variants=profiles.map((profile,index)=>{
  const out=path.join(temp,String(index)),manifest=materializeBase({baseId:'creation-sandbox',worldId:'guidance-cohort',out,controllerProfile:profile});
  if(currentSceneObserverProfile(manifest.files,loadSceneObserverPins(path.join(root,'desktop/godot')))!==profile)throw Error('Observer cohort mismatch');
  // Include all materialized shared scripts and both native controller scripts:
  // Include the component-state interface as well as the top-level adapter.
  const files=manifest.files.filter(file=>file.path.startsWith('craftmine_shared/')||['scripts/reused/player_controller.gd','scripts/reused/camera_rig.gd'].includes(file.path)).sort((a,b)=>a.path.localeCompare(b.path)).map(file=>{
   const text=fs.readFileSync(path.join(out,file.path),'utf8').replace(/\r\n/g,'\n');
   return {path:file.path,acceptedSourceHashes:[...new Set([hash(text),hash(text.replace(/\n/g,'\r\n'))])]};
  });
  const inherited=files.find(file=>file.path==='craftmine_shared/base_adapter_legacy.gd');
  const ref=skill.references.find(ref=>ref.projectPath==='craftmine_shared/base_adapter.gd');
  if(!inherited.acceptedSourceHashes.every(h=>ref.acceptedSourceHashes.includes(h)))throw Error('Guidance inherited interface is no longer identical');
  return {profile,files,referencePaths:{'craftmine_shared/base_adapter.gd':'craftmine_shared/base_adapter_legacy.gd'}};
 });
 const legacyNames=['base_adapter.gd','runtime_bridge.gd','state_guard.gd','headless_play_action.gd','scene_mesh_picker.gd','component_state.gd'].map(name=>'craftmine_shared/'+name);
 const cohorts={format:'craftmine.guidance-interface-cohorts/1',scope:'source-applicability-not-runtime-evidence',variants,
  reservedPaths:[...new Set(variants.flatMap(v=>v.files.map(f=>f.path)))].filter(name=>name.startsWith('craftmine_shared/')&&!legacyNames.includes(name)).sort()};
 const interfaceHash=hash(JSON.stringify({references:skill.references.filter(ref=>ref.requiredInterface).map(ref=>[ref.projectPath,ref.sha256]),cohorts}));
 if(process.argv.includes('--check')){
  if(JSON.stringify(skill.interfaceCohorts)!==JSON.stringify(cohorts)||skill.interfaceHash!==interfaceHash)throw Error('Guidance cohort corpus drift; review and refresh required');
 }else{skill.interfaceCohorts=cohorts;skill.interfaceHash=interfaceHash;fs.writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+'\n');}
 console.log(JSON.stringify({profiles:variants.map(v=>({profile:v.profile,files:v.files.length})),checked:process.argv.includes('--check')}));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
