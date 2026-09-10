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
const base='desktop/godot/bases/first-person';
const sourceCommit='9469aaa487b31ea41b839c7cd4214c2c7f3f293b';
const paths=['scripts/core/equipment_definition.gd','scripts/core/equipment_catalog.gd',
  'scripts/core/equipment_state.gd','data/equipment/pistol.tres',
  'data/equipment/equipment_catalog.tres','docs/BASE_SPEC.md','docs/STATE_FORMAT.md'];
const references=paths.map(projectPath=>{
  // Read the declared revision, not a mutable checkout carrying the old label.
  const text=execFileSync('git',['show',`${sourceCommit}:${base}/${projectPath}`],
    {cwd:root,encoding:'utf8',windowsHide:true}).replace(/\r\n/g,'\n');
  return {path:projectPath,projectPath,sourcePath:`${base}/${projectPath}`,
    requiredInterface:projectPath.startsWith('scripts/'),sha256:hash(text),
    acceptedSourceHashes:[hash(text),hash(text.replace(/\n/g,'\r\n'))],text};
});
const text=read(path.join(here,'equipment-parameters.md'));
const catalog={version:'1.0.0',provenance:{publisher:'Craftmine World bundled source',
  sourceCommit,
  textNormalization:'LF; source interface matching accepts LF or CRLF only',
  validation:'Source-derived recipe with deterministic route and reference tests; no real model efficiency evidence'},
  skills:[{id:'first-person.equipment-parameters',version:'1.0.0',
    title:'Tune existing first-person equipment damage, cooldown or range',
    path:'equipment-parameters.md',sha256:hash(text),
    applicability:{baseId:'first-person',baseVersion:'0.1.0',baseBuild:'first-person-0.1.0',engineVersion:'4.7.2-stable'},
    references,text}]};
fs.writeFileSync(path.join(here,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
