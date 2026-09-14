import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const scripts=[
  {suffix:'/companion.gd',old:'ba1d44ff574623918a4b2c04a4c1f033def0c46c99b5392b88bbc30bd102ccc6',source:'desktop/godot/components/approved-pomeranian/companion-v3.gd'},
  {suffix:'/pet_companion.gd',old:'777ee40773f20a14dfb028ce8e131de0fab195f895a44e85dd5b631e5d8afa2a',source:'desktop/godot/components/pet-companion/scripts/pet_companion-v3.gd'},
];
/** Read-only source plan. Apply through normal source CAS/check/adoption; never
 * patch an immutable package or write runtime progress to rescue a save. */
export function planCompanionBoundsUpgrade({repository,files,bounds}){
  if(!Array.isArray(files)||files.length>16)throw Error('COMPANION_SOURCE_INVALID');
  if(!bounds||!['minimum','maximum'].every(key=>Array.isArray(bounds[key])&&bounds[key].length===3&&bounds[key].every(n=>Number.isFinite(n)&&Math.abs(n)<=100000))
    ||bounds.minimum.some((n,i)=>n>=bounds.maximum[i]))throw Error('COMPANION_BOUNDS_REQUIRED');
  const operations=[];
  for(const file of files){
    const match=scripts.find(entry=>file.path.endsWith(entry.suffix));if(!match)continue;
    if(!/^[a-zA-Z0-9_./-]+$/.test(file.path)||file.path.split('/').some(part=>!part||part==='..'||part==='.')||typeof file.text!=='string')throw Error('COMPANION_SOURCE_INVALID');
    if(sha(file.text)!==match.old)throw Error('COMPANION_SCRIPT_NOT_RELEASED');
    const text=fs.readFileSync(path.join(repository,match.source),'utf8').replace(/\r\n/g,'\n')
      .replace('Vector3(-80, -80, -80)','Vector3('+bounds.minimum.join(', ')+')')
      .replace('Vector3(80, 80, 80)','Vector3('+bounds.maximum.join(', ')+')');
    operations.push({op:'put',path:file.path,expectedHash:match.old,text});
  }
  if(!operations.length)throw Error('COMPANION_RELEASED_SOURCE_NOT_FOUND');
  return {format:'craftmine.companion-bounds-upgrade-plan/1',operations,bounds,
    stateFormat:'craftmine.pet-companion-state/1',identityPreserved:true,progressMutation:false,
    nextAction:'ordinary-source-patch-check-adopt',note:'Review bounds against the receiving world source. Exact released script recognition does not certify placement, collision or gameplay.'};
}
