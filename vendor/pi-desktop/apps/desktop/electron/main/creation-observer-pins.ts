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
export function loadSceneObserverPins(resourcesRoot: string): SceneObserverPins {
  const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
  return Object.freeze(Object.fromEntries(Object.entries(SCENE_OBSERVER_RESOURCES).map(([name,relative])=>{
    const text=fs.readFileSync(path.join(resourcesRoot,relative),'utf8').replace(/\r\n/g,'\n');
    return [name,Object.freeze([hash(text),hash(text.replace(/\n/g,'\r\n'))])];
  })));
}
export function hasCurrentSceneObserver(files: unknown, pins: SceneObserverPins | undefined): boolean {
  if(!pins||!Array.isArray(files))return false;
  return Object.keys(SCENE_OBSERVER_RESOURCES).every(name=>{
    const matches=files.filter(file=>file?.path===name);
    return matches.length===1&&Array.isArray(pins[name])&&pins[name].includes(matches[0].sha256);
  });
}
