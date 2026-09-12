// Rebuild reviewed snapshots explicitly; never invoked by a model tool.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
const read=file=>fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
const snapshot=({sourceCommit,sourcePath,projectPath,path:referencePath=projectPath,requiredInterface=false})=>{
  const text=sourceCommit?execFileSync('git',['show',`${sourceCommit}:${sourcePath}`],
    {cwd:root,encoding:'utf8',windowsHide:true}).replace(/\r\n/g,'\n'):read(path.join(root,sourcePath));
  return {path:referencePath,...(projectPath?{projectPath}:{}),sourcePath,
    ...(sourceCommit?{sourceCommit}: {sourceKind:'bundled-reviewed-example'}),
    requiredInterface,sha256:hash(text),acceptedSourceHashes:[hash(text),hash(text.replace(/\n/g,'\r\n'))],text};
};
const fpsCommit='9469aaa487b31ea41b839c7cd4214c2c7f3f293b';
const creationCommit='314c27d5baf65bf6c89679fcdfb3756bc4bd3a77';
const creationManagedCommit='db0a42eae38c4e97f373f4d268993ff10ed1b21f';
const makeSkill=({id,title,baseId,baseVersion,file,references,version='1.0.0'})=>{
 const text=read(path.join(here,file));
 return {id,version,title,path:file,sha256:hash(text),
   interfaceHash:hash(JSON.stringify(references.filter(ref=>ref.requiredInterface).map(({projectPath,sha256})=>({projectPath,sha256})))),
   applicability:{baseId,baseVersion,baseBuild:`${baseId}-${baseVersion}`,engineVersion:'4.7.2-stable'},references,text};
};
const fpsReferences=['scripts/core/equipment_definition.gd','scripts/core/equipment_catalog.gd',
  'scripts/core/equipment_state.gd','data/equipment/pistol.tres','data/equipment/equipment_catalog.tres',
  'docs/BASE_SPEC.md','docs/STATE_FORMAT.md'].map(projectPath=>snapshot({sourceCommit:fpsCommit,
    sourcePath:`desktop/godot/bases/first-person/${projectPath}`,projectPath,requiredInterface:projectPath.startsWith('scripts/')}));
const creationReferences=['scripts/creation_world.gd','scripts/scene_contract.gd','creation-scene.schema.json','README.md'].map(projectPath=>snapshot({
 sourceCommit:creationCommit,sourcePath:`desktop/godot/bases/creation-sandbox/${projectPath}`,projectPath,requiredInterface:projectPath.startsWith('scripts/')}));
creationReferences.push(snapshot({sourceCommit:creationManagedCommit,sourcePath:'desktop/godot/shared/adapters/creation-sandbox.gd',
 projectPath:'craftmine_shared/base_adapter.gd',requiredInterface:true}));
creationReferences.push(snapshot({sourceCommit:creationManagedCommit,sourcePath:'desktop/godot/shared/component_state.gd',
 projectPath:'craftmine_shared/component_state.gd',requiredInterface:true}));
creationReferences.push(snapshot({sourcePath:'plugins/craftmine-world/guidance/references/double-press-rule.gd',path:'examples/double-press-rule.gd'}));
const catalog={version:'1.8.0',requiredInterfacePolicy:{
 meaning:'Source-hash applicability check for this guidance only; not a read-only marker or an immutable-file list.',
 writeAuthority:'Actual godot_project_patch and host write/build policies; existing permissions, managed bridges and frozen checks are unchanged.',
 afterSourceChange:'GUIDANCE_INTERFACE_UNSUPPORTED means this recipe does not cover the current source. Reinspect that source; do not revert a legitimate edit just to regain guidance coverage.'},provenance:{publisher:'Craftmine World bundled source',
 sourceCommits:[fpsCommit,creationCommit,creationManagedCommit],textNormalization:'LF; source interface matching accepts LF or CRLF only',
 validation:'Source-derived guidance; exact reference hashes, broker routing and authored examples are tested. No real model efficiency comparison is established.'},
 skills:[makeSkill({id:'first-person.equipment-parameters',version:'1.0.1',title:'Tune existing first-person equipment damage, cooldown or range',
   baseId:'first-person',baseVersion:'0.1.0',file:'equipment-parameters.md',references:fpsReferences}),
 makeSkill({id:'creation-sandbox.authoring',version:'1.8.0',title:'沉浸式造物：稳定对象编辑、普通源码规则与完整进度',
   baseId:'creation-sandbox',baseVersion:'1.0.0',file:'creation-sandbox.md',references:creationReferences})]};
fs.writeFileSync(path.join(here,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
