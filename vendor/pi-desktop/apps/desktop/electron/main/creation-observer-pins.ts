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

/** A review hint grants maintenance only, never trust in old sampled fields. */
export function canUpgradeSceneObserver(files: unknown, pins: SceneObserverPins | undefined): boolean {
  if(!pins||!Array.isArray(files)||hasCurrentSceneObserver(files,pins))return false;
  return SCENE_OBSERVER_UPGRADE.files.length===Object.keys(SCENE_OBSERVER_RESOURCES).length&&SCENE_OBSERVER_UPGRADE.files.every(file=>{
    const matches=files.filter(entry=>entry?.path===file.source);
    return matches.length===1&&file.from.includes(matches[0].sha256)&&file.to.every(hash=>pins[file.source]?.includes(hash))&&
      !files.some(entry=>entry?.path!==file.source&&typeof entry?.path==='string'&&(entry.path.toLowerCase()===file.source.toLowerCase()||entry.path.toLowerCase().startsWith(file.source.toLowerCase()+'.')));
  });
}
