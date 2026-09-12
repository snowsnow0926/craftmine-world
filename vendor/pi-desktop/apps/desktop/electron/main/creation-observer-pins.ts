import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {SCENE_OBSERVER_UPGRADE} from './creation-managed-migrations.ts';

// Runtime fields added after old retained worlds shipped need their own source
// authority gate. An old adapter may forward authored fields it never sampled.
export const SCENE_OBSERVER_RESOURCES = Object.freeze({
  'craftmine_shared/base_adapter.gd': 'shared/adapters/creation-sandbox.gd',
  'craftmine_shared/runtime_bridge.gd': 'shared/runtime_bridge.gd',
  'craftmine_shared/state_guard.gd': 'shared/state_guard.gd',
  'craftmine_shared/headless_play_action.gd': 'shared/headless_play_action.gd',
  'craftmine_shared/scene_mesh_picker.gd': 'shared/scene_mesh_picker.gd',
});
export type SceneObserverPins = Readonly<Record<string, readonly string[]>>;
const CONTROLLER_OBSERVER_RESOURCES=Object.freeze({
  '@controllerAdapter':'shared/adapters/creation-sandbox-controller-v1.gd',
  'craftmine_shared/base_adapter_legacy.gd':'shared/adapters/creation-sandbox.gd',
  'craftmine_shared/controller_evidence.gd':'shared/controller_evidence.gd',
  'craftmine_shared/scene_mesh_picker_v2.gd':'shared/scene_mesh_picker_v2.gd',
});
const COLLISION_OBSERVER_RESOURCES=Object.freeze({
  '@collisionAdapter':'shared/adapters/creation-sandbox-controller-v2.gd',
  'craftmine_shared/base_adapter_controller_v1.gd':'shared/adapters/creation-sandbox-controller-v1.gd',
  'craftmine_shared/progress_collision.gd':'shared/progress_collision.gd',
  'scripts/reused/player_controller.gd':'bases/creation-sandbox/scripts/reused/player_controller.gd',
  'scripts/reused/camera_rig.gd':'bases/creation-sandbox/scripts/reused/camera_rig.gd',
});
const ENGINE_OBSERVER_RESOURCES=Object.freeze({
  '@engineBridge':'shared/runtime_bridge_engine_v1.gd',
  'craftmine_shared/runtime_bridge_base.gd':'shared/runtime_bridge.gd',
  'craftmine_shared/engine_performance.gd':'shared/engine_performance.gd',
});
export function loadSceneObserverPins(resourcesRoot: string): SceneObserverPins {
  const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
  const resources={...SCENE_OBSERVER_RESOURCES,...(Object.values(CONTROLLER_OBSERVER_RESOURCES).every(relative=>fs.existsSync(path.join(resourcesRoot,relative)))?CONTROLLER_OBSERVER_RESOURCES:{}),...(Object.values(COLLISION_OBSERVER_RESOURCES).every(relative=>fs.existsSync(path.join(resourcesRoot,relative)))?COLLISION_OBSERVER_RESOURCES:{}),...(Object.values(ENGINE_OBSERVER_RESOURCES).every(relative=>fs.existsSync(path.join(resourcesRoot,relative)))?ENGINE_OBSERVER_RESOURCES:{})};
  return Object.freeze(Object.fromEntries(Object.entries(resources).map(([name,relative])=>{
    const text=fs.readFileSync(path.join(resourcesRoot,relative),'utf8').replace(/\r\n/g,'\n');
    return [name,Object.freeze([hash(text),hash(text.replace(/\n/g,'\r\n'))])];
  })));
}
export type SceneObserverProfile='legacy'|'creation-fixed-controller/1'|'creation-player-collision/1';
const controllerMembers=Object.keys(CONTROLLER_OBSERVER_RESOURCES).filter(name=>!name.startsWith('@'));
const collisionMembers=Object.keys(COLLISION_OBSERVER_RESOURCES).filter(name=>!name.startsWith('@'));
// Player/camera scripts also exist in legacy worlds; only versioned shared
// members distinguish an incomplete modern cohort from an old migration input.
export function hasVersionedSceneObserverFiles(files:unknown):boolean {
  const reserved=[...controllerMembers,...collisionMembers.filter(name=>name.startsWith('craftmine_shared/')),'craftmine_shared/runtime_bridge_base.gd','craftmine_shared/engine_performance.gd'];
  return Array.isArray(files)&&files.some(file=>reserved.includes(file?.path));
}
export function currentSceneObserverProfile(input: unknown, pins: SceneObserverPins | undefined): SceneObserverProfile|null {
  if(!pins||!Array.isArray(input))return null;
  let files=input;
  // A complete fixed extension delegates to the original bridge. Validate that
  // chain before interpreting the unchanged controller/collision profile.
  const members=['craftmine_shared/runtime_bridge_base.gd','craftmine_shared/engine_performance.gd'];
  if(files.some(file=>members.includes(file?.path))){
    for(const name of ['craftmine_shared/runtime_bridge.gd',...members]){
      const found=files.filter(file=>file?.path===name);
      if(found.length!==1||!pins[name==='craftmine_shared/runtime_bridge.gd'?'@engineBridge':name]?.includes(found[0].sha256))return null;
      if(files.some(file=>typeof file?.path==='string'&&file.path!==name&&
        (file.path.toLowerCase()===name||file.path.toLowerCase().startsWith(name+'.remap')||file.path.toLowerCase().startsWith(name.slice(0,-3)+'.gdc'))))return null;
    }
    const inherited=files.find(file=>file?.path==='craftmine_shared/runtime_bridge_base.gd');
    files=files.filter(file=>file?.path!=='craftmine_shared/runtime_bridge.gd'&&!members.includes(file?.path))
      .concat({...inherited,path:'craftmine_shared/runtime_bridge.gd'});
  }
  const adapter=files.filter(file=>file?.path==='craftmine_shared/base_adapter.gd');
  const collision=adapter.length===1&&pins['@collisionAdapter']?.includes(adapter[0].sha256);
  const controller=collision||adapter.length===1&&pins['@controllerAdapter']?.includes(adapter[0].sha256);
  if(!collision&&files.some(file=>collisionMembers.filter(name=>name.startsWith('craftmine_shared/')).includes(file?.path)))return null;
  if(!controller&&files.some(file=>controllerMembers.includes(file?.path)))return null;
  const current=[...Object.keys(SCENE_OBSERVER_RESOURCES),...(controller?controllerMembers:[]),...(collision?collisionMembers:[])].every(name=>{
    const matches=files.filter(file=>file?.path===name);
    const expected=pins[controller&&name==='craftmine_shared/base_adapter.gd'?(collision?'@collisionAdapter':'@controllerAdapter'):name];
    return matches.length===1&&Array.isArray(expected)&&expected.includes(matches[0].sha256);
  });
  return current?(collision?'creation-player-collision/1':controller?'creation-fixed-controller/1':'legacy'):null;
}
export function hasCurrentSceneObserver(files: unknown, pins: SceneObserverPins | undefined): boolean {
  return currentSceneObserverProfile(files,pins)!==null;
}
export function hasCurrentCollisionGuard(files:unknown,pins:SceneObserverPins|undefined):boolean {
  return currentSceneObserverProfile(files,pins)==='creation-player-collision/1';
}


/** A review hint grants maintenance only, never trust in old sampled fields. */
export function canUpgradeSceneObserver(files: unknown, pins: SceneObserverPins | undefined): boolean {
  if(!pins||!Array.isArray(files)||hasCurrentSceneObserver(files,pins))return false;
  return SCENE_OBSERVER_UPGRADE.files.length===Object.keys(SCENE_OBSERVER_RESOURCES).length&&SCENE_OBSERVER_UPGRADE.files.every(file=>{
    const matches=files.filter(entry=>entry?.path===file.source);
    return matches.length===1&&file.from.includes(matches[0].sha256)&&file.to.every(hash=>pins[file.source]?.includes(hash))&&
      !files.some(entry=>entry?.path!==file.source&&typeof entry?.path==='string'&&(entry.path.toLowerCase()===file.source.toLowerCase()||entry.path.toLowerCase().startsWith(file.source.toLowerCase()+'.')));
  });
}
