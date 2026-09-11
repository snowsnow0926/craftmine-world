// Refresh existing, reviewed distribution declarations and exact guide sources.
// This does not add a licence grant or admit an undeclared runtime file.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
execFileSync(process.execPath,[path.join(root,'desktop/godot/shared/tools/build-base-catalog.mjs')],{cwd:root,stdio:'pipe',windowsHide:true});
const catalogPath=path.join(root,'plugins/craftmine-world/guidance/catalog.json');
const catalog=JSON.parse(fs.readFileSync(catalogPath,'utf8'));
const skill=catalog.skills.find(item=>item.id==='creation-sandbox.authoring');
skill.version='1.3.0';skill.text=fs.readFileSync(path.join(root,'plugins/craftmine-world/guidance',skill.path),'utf8').replace(/\r\n/g,'\n');skill.sha256=hash(skill.text);
for(const ref of skill.references){
  const committed=execFileSync('git',['show',head+':'+ref.sourcePath],{cwd:root,windowsHide:true});
  const actual=fs.readFileSync(path.join(root,ref.sourcePath),'utf8').replace(/\r\n/g,'\n');
  if(committed.toString('utf8').replace(/\r\n/g,'\n')!==actual)throw Error('Commit source before refreshing guide: '+ref.sourcePath);
  ref.sourceCommit=head;ref.text=actual;ref.sha256=hash(actual);ref.acceptedSourceHashes=[...new Set([hash(actual),hash(actual.replace(/\n/g,'\r\n'))])];
}
skill.interfaceHash=hash(JSON.stringify(skill.references.filter(ref=>ref.requiredInterface).map(ref=>[ref.projectPath,ref.sha256])));
catalog.version='1.3.0';catalog.provenance.sourceCommits=[...new Set(catalog.skills.flatMap(item=>item.references.map(ref=>ref.sourceCommit)))];
fs.writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+'\n');
let changed=0;
const declarations=path.join(root,'desktop/delivery/base-assets');
for(const name of fs.readdirSync(declarations).filter(name=>name.endsWith('.json'))){
  const file=path.join(declarations,name),manifest=JSON.parse(fs.readFileSync(file,'utf8'));
  let dirty=false;
  for(const [entries,prefix]of [[manifest.entries,manifest.sourceDirectory+'/'],[manifest.externalEntries,'']])for(const entry of entries??[]){
    const source=path.join(root,prefix+entry.path),info=fs.lstatSync(source);
    if(!info.isFile()||info.isSymbolicLink())throw Error('Declared source is not a regular file: '+source);
    const bytes=fs.readFileSync(source),digest=hash(bytes);
    if(entry.bytes!==bytes.length||entry.sha256!==digest){entry.bytes=bytes.length;entry.sha256=digest;dirty=true;changed++;}
  }
  if(dirty)fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
}
console.log(JSON.stringify({sourceCommit:head,guide:skill.id,version:skill.version,updatedRuntimePins:changed}));
