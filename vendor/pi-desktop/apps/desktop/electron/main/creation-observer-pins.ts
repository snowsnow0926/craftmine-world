import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

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
export function loadSceneObserverPins(resourcesRoot: string): SceneObserverPins {
  const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
  const resources={...SCENE_OBSERVER_RESOURCES,...(Object.values(CONTROLLER_OBSERVER_RESOURCES).every(relative=>fs.existsSync(path.join(resourcesRoot,relative)))?CONTROLLER_OBSERVER_RESOURCES:{}),...(Object.values(COLLISION_OBSERVER_RESOURCES).every(relative=>fs.existsSync(path.join(resourcesRoot,relative)))?COLLISION_OBSERVER_RESOURCES:{})};
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
  const reserved=[...controllerMembers,...collisionMembers.filter(name=>name.startsWith('craftmine_shared/'))];
  return Array.isArray(files)&&files.some(file=>reserved.includes(file?.path));
}
export function currentSceneObserverProfile(files: unknown, pins: SceneObserverPins | undefined): SceneObserverProfile|null {
  if(!pins||!Array.isArray(files))return null;
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
