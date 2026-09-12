import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {currentSceneObserverProfile,loadSceneObserverPins} from './creation-observer-pins.ts';
import type {GroundUpgradePlan} from './creation-ground-upgrade.ts';

const source='craftmine_shared/progress_collision.gd';
export const COLLISION_SUPPORT_UPGRADE='collision-support-contact-20260912-v1';
export const COLLISION_SUPPORT_OLD=Object.freeze(['c194946727f3d382821f04038614d0a38f7f7b66afdb94a3e01a6c0d787c9098','1e2bbbf7747b72fbe66bfcfbdd245ae525c8949f285f128bd242800e6e5b3c0d']);
export const COLLISION_SUPPORT_CURRENT=Object.freeze(['c447551cef401e15221d797b33a239a5f65059420cf0f8c2709475eae58594db','cb1eef1113907cbc3462e9a824764988359dde70ace7f984fbe2409b3377e1fb']);
type FilePin={path:string;sha256:string;bytes:number};
/** No tolerance inference from player data: replace only the exact shipped
 * guard within the complete reviewed native controller/observer cohort. */
export function planCreationCollisionUpgrade(input:{baseId:string;formalFiles:FilePin[];draftFiles:FilePin[];resourcesRoot:string}):GroundUpgradePlan{
  if(input.baseId!=='creation-sandbox')return {status:'skipped',reason:'different-base'};
  const files=input.formalFiles;
  if(!Array.isArray(files)||!files.length||files.length>512||new Set(files.map(f=>f.path.toLowerCase())).size!==files.length
    ||files.some(f=>!f.path||!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<0))throw Error('COLLISION_UPGRADE_MANIFEST_INVALID');
  const guard=files.find(f=>f.path===source);
  if(guard&&COLLISION_SUPPORT_CURRENT.includes(guard.sha256))return {status:'skipped',reason:'already-current'};
  if(!guard||!COLLISION_SUPPORT_OLD.includes(guard.sha256))return {status:'skipped',reason:'customized-source'};
  const pins=loadSceneObserverPins(input.resourcesRoot);
  const owned=Object.keys(pins).filter(name=>!name.startsWith('@'));
  if(files.some(file=>owned.some(name=>file.path!==name&&(file.path.toLowerCase()===name.toLowerCase()
    ||file.path.toLowerCase().startsWith(name.toLowerCase()+'.')||file.path.toLowerCase()===name.slice(0,-3).toLowerCase()+'.gdc'))))return {status:'skipped',reason:'customized-source'};
  if(currentSceneObserverProfile(files,{...pins,[source]:COLLISION_SUPPORT_OLD})!=='creation-player-collision/1')return {status:'skipped',reason:'customized-source'};
  if(!Array.isArray(input.draftFiles)||input.draftFiles.length!==files.length||!files.every(f=>input.draftFiles.some(g=>g.path===f.path&&g.sha256===f.sha256&&g.bytes===f.bytes)))return {status:'skipped',reason:'draft-conflict'};
  const text=fs.readFileSync(path.join(input.resourcesRoot,'shared/progress_collision.gd'),'utf8').replace(/\r\n/g,'\n');
  const sha256=createHash('sha256').update(text).digest('hex');
  if(!COLLISION_SUPPORT_CURRENT.includes(sha256))throw Error('COLLISION_UPGRADE_RESOURCE_CHANGED');
  return {status:'planned',id:COLLISION_SUPPORT_UPGRADE,operations:[{op:'put',path:source,text,expectedHash:guard.sha256}],
    expectedFiles:files.map(f=>f.path===source?{path:source,sha256,bytes:Buffer.byteLength(text)}:{...f})};
}
