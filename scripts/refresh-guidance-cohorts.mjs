// Developer-only publication of reviewed, retained cohorts. Never learns pins
// from the mutable materializer or the player's current source.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),hash=text=>createHash('sha256').update(text).digest('hex');
const catalogPath=path.join(root,'plugins/craftmine-world/guidance/catalog.json');
const catalog=JSON.parse(fs.readFileSync(catalogPath)),skill=catalog.skills.find(item=>item.id==='creation-sandbox.authoring');
const cohorts=JSON.parse(fs.readFileSync(path.join(root,'plugins/craftmine-world/guidance/interface-cohorts.json')));
if(cohorts.format!=='craftmine.guidance-interface-cohorts/1'||new Set(cohorts.variants.map(v=>v.profile)).size!==cohorts.variants.length)throw Error('Reviewed cohort registry invalid');
for(const variant of cohorts.variants){
 if(new Set(variant.files.map(f=>f.path)).size!==variant.files.length)throw Error('Duplicate cohort path');
 for(const file of variant.files)if(!file.acceptedSourceHashes.length||file.acceptedSourceHashes.some(value=>!/^[a-f0-9]{64}$/.test(value)))throw Error('Invalid reviewed source hash');
 for(const ref of skill.references.filter(ref=>ref.requiredInterface)){
  const mapped=variant.referencePaths[ref.projectPath];if(!mapped)continue;
  const inherited=variant.files.find(file=>file.path===mapped);
  if(!inherited||!inherited.acceptedSourceHashes.every(value=>ref.acceptedSourceHashes.includes(value)))throw Error('Guidance inherited interface changed');
 }
}
const interfaceHash=hash(JSON.stringify({references:skill.references.filter(ref=>ref.requiredInterface).map(ref=>[ref.projectPath,ref.sha256]),cohorts}));
if(process.argv.includes('--check')){
 if(JSON.stringify(skill.interfaceCohorts)!==JSON.stringify(cohorts)||skill.interfaceHash!==interfaceHash)throw Error('Guidance reviewed cohort corpus drift');
}else{
 for(const old of skill.interfaceCohorts?.variants??[])if(JSON.stringify(cohorts.variants.find(v=>v.profile===old.profile))!==JSON.stringify(old))throw Error('Released guidance cohort would change');
 skill.interfaceCohorts=cohorts;skill.interfaceHash=interfaceHash;fs.writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+'\n');
}
console.log(JSON.stringify({profiles:cohorts.variants.map(v=>({profile:v.profile,files:v.files.length})),checked:process.argv.includes('--check')}));
