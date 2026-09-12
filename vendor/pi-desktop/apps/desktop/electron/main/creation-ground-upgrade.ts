import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

type FilePin={path:string;sha256:string;bytes:number};
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const WORLD_SCRIPT='scripts/creation_world.gd';
export const CREATION_GROUND_UPGRADE_ID='stock-ground-lighting-20260912-v1';
// Exact released stock world, including LF and CRLF. Never learn trust from a
// managed-base manifest inside a player's project or match only color snippets.
export const CREATION_GROUND_OLD_PINS=Object.freeze([
 'f599887d0ebe4c17c37fec16ac8821d1e0f97da2cbac88758ae71870c2d5ce9a',
 '8ee492897f407ca02aa193be1ff36cf69e31545abc9ebc4176ef2a01f78c2012',
]);
export const CREATION_GROUND_CURRENT_PINS=Object.freeze([
 '77f10dffb771464e13f77301fa9dcba180f431b80dc34b1b3e396dc55c84f615',
 '83011755993e07253e3792be98ffc1d731d86cfea7c04089c22e9d1ff5dffcc5',
]);
function validFiles(files:FilePin[]):boolean{
 return Array.isArray(files)&&files.length>0&&files.length<=512&&new Set(files.map(f=>f.path)).size===files.length&&
  new Set(files.map(f=>f.path.toLowerCase())).size===files.length&&files.every(f=>typeof f.path==='string'&&/^[a-f0-9]{64}$/.test(f.sha256)&&Number.isSafeInteger(f.bytes)&&f.bytes>=0);
}
function sameFiles(a:FilePin[],b:FilePin[]):boolean{
 return validFiles(a)&&validFiles(b)&&a.length===b.length&&a.every(f=>b.some(g=>g.path===f.path&&g.sha256===f.sha256&&g.bytes===f.bytes));
}
export type GroundUpgradePlan={status:'planned';id:string;operations:{op:'put';path:string;text:string;expectedHash:string}[];expectedFiles:FilePin[]}|{status:'skipped';reason:'different-base'|'already-current'|'customized-source'|'draft-conflict'};

/** Read-only maintenance planner. Its operation must go through the normal
 * content Git transaction, check build and candidate apply coordinator. This
 * function never changes project files, artifacts, formal deployment or saves.
 * All draft files must equal the formal snapshot; even an unrelated draft edit
 * defers maintenance so its authored work is never folded into an auto apply. */
export function planCreationGroundUpgrade(input:{baseId:string;formalFiles:FilePin[];draftFiles:FilePin[];resourcesRoot:string}):GroundUpgradePlan{
 if(input.baseId!=='creation-sandbox')return {status:'skipped',reason:'different-base'};
 if(!validFiles(input.formalFiles)||!validFiles(input.draftFiles))throw Error('GROUND_UPGRADE_MANIFEST_INVALID');
 const source=input.formalFiles.find(f=>f.path===WORLD_SCRIPT);
 if(source&&CREATION_GROUND_CURRENT_PINS.includes(source.sha256))return {status:'skipped',reason:'already-current'};
 if(!source||!CREATION_GROUND_OLD_PINS.includes(source.sha256)||input.formalFiles.some(f=>f.path.toLowerCase().startsWith(WORLD_SCRIPT+'.')||f.path.toLowerCase()==='scripts/creation_world.gdc'))return {status:'skipped',reason:'customized-source'};
 if(!sameFiles(input.formalFiles,input.draftFiles))return {status:'skipped',reason:'draft-conflict'};
 const text=fs.readFileSync(path.join(input.resourcesRoot,'bases/creation-sandbox',WORLD_SCRIPT),'utf8').replace(/\r\n/g,'\n');
 const sha256=digest(text);
 if(!CREATION_GROUND_CURRENT_PINS.includes(sha256))throw Error('GROUND_UPGRADE_RESOURCE_CHANGED');
 return {status:'planned',id:CREATION_GROUND_UPGRADE_ID,operations:[{op:'put',path:WORLD_SCRIPT,text,expectedHash:source.sha256}],
  expectedFiles:input.formalFiles.map(f=>f.path===WORLD_SCRIPT?{path:WORLD_SCRIPT,sha256,bytes:Buffer.byteLength(text)}:{...f})};
}

/** Call this after patch and immediately before checked apply. Verifies every
 * file, including unchanged user scene/rules, against the planned snapshot. */
export function verifyCreationGroundUpgrade(plan:Extract<GroundUpgradePlan,{status:'planned'}>,actualFiles:FilePin[]):void{
 if(!sameFiles(plan.expectedFiles,actualFiles))throw Error('GROUND_UPGRADE_SOURCE_CHANGED');
}
