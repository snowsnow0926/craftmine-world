import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const defaultRoot=path.join(import.meta.dirname,'promo-templates');
const fail=()=>{throw Error('WORLD_TEMPLATE_INVALID');};
function read(root,relative,max){
 if(typeof relative!=='string'||relative.includes('\\')||relative.includes(':')||relative.split('/').some(p=>!p||p==='.'||p==='..'))fail();
 let full=root;if(fs.lstatSync(full).isSymbolicLink())fail();
 for(const part of relative.split('/')){full=path.join(full,part);if(fs.lstatSync(full).isSymbolicLink())fail();}
 const stat=fs.statSync(full);if(!stat.isFile()||stat.size>max)fail();return fs.readFileSync(full);
}
export function readWorldTemplates(root=defaultRoot){
 if(!fs.existsSync(path.join(root,'catalog.json')))return [];
 const catalog=JSON.parse(read(root,'catalog.json',65536));if(catalog.format!=='craftmine.authored-world-templates/1'||!Array.isArray(catalog.templates)||catalog.templates.length>32)fail();
 return catalog.templates.map(entry=>{
  if(!/^promo-[a-z]+$/.test(entry.id)||entry.kind!=='example'||typeof entry.label!=='string')fail();
  const bytes=read(root,entry.id+'/manifest.json',2*1024*1024);if(hash(bytes)!==entry.sha256)fail();const manifest=JSON.parse(bytes);
  if(manifest.format!=='craftmine.authored-world-template/1'||manifest.id!==entry.id||manifest.version!==entry.version||manifest.baseId!=='creation-sandbox')fail();
  const preview=read(root,entry.id+'/'+manifest.preview.file,2*1024*1024);
  if(preview.length!==manifest.preview.bytes||hash(preview)!==manifest.preview.sha256||preview.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')fail();
  return {id:entry.id,label:entry.label,description:entry.description,kind:'example',delivered:true,
   preview:'data:image/png;base64,'+preview.toString('base64'),source:{id:entry.id,version:entry.version,sha256:entry.sha256},initialState:'authored-defaults'};
 });
}
/** A fixed creation-sandbox binding transform. Object identities are world-local
 * as in native world copy; scripts and binary models keep their original bytes. */
export function materializeWorldTemplate({worldId,template,out,root=defaultRoot}){
 if(!/^[a-z0-9][a-z0-9-]{1,47}$/.test(worldId)||!path.isAbsolute(out)||fs.existsSync(out))fail();
 const option=readWorldTemplates(root).find(x=>x.id===template);if(!option)throw Error('WORLD_STARTER_UNAVAILABLE');
 const directory=path.join(root,template),manifest=JSON.parse(read(directory,'manifest.json',2*1024*1024));
 if(!Array.isArray(manifest.files)||manifest.files.length>4096||manifest.initial.authority!=='authored-runtime-defaults')fail();
 const files=new Map();let total=0;
 for(const file of manifest.files){
  if(files.has(file.path.toLowerCase())||['managed-base.json','.creation-owner.json'].includes(file.path))fail();
  const bytes=read(directory,'source/'+file.path,4*1024*1024);total+=bytes.length;
  if(total>64*1024*1024||bytes.length!==file.bytes||hash(bytes)!==file.sha256)fail();files.set(file.path.toLowerCase(),{path:file.path,bytes});
 }
 const config=files.get('project.godot');if(!config)fail();let count=0,section='';
 config.bytes=Buffer.from(config.bytes.toString('utf8').split(/(?<=\n)/).map(line=>{
  if(/^\s*\[.*\]\s*$/.test(line))section=line.trim();
  if(section==='[craftmine]'&&/^runtime\/world_id\s*=/.test(line)){
   const old=JSON.parse(line.slice(line.indexOf('=')+1).trim());if(old!==manifest.worldId)fail();count++;
   return line.replace(JSON.stringify(old),JSON.stringify(worldId));
  }return line;
 }).join(''));if(count!==1)fail();
 const journal=files.get('world/creation-operations.json');if(journal){
  const value=JSON.parse(journal.bytes);if(value.format!=='craftmine.creation-operations/1'||!Array.isArray(value.operations))fail();
  for(const operation of value.operations){if(operation.receipt.worldId!==manifest.worldId)fail();operation.receipt.originWorldId??=manifest.worldId;operation.receipt.worldId=worldId;}
  journal.bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
 }
 const initialBytes=read(directory,manifest.initial.file,1024*1024);if(hash(initialBytes)!==manifest.initial.sha256)fail();const snapshot=JSON.parse(initialBytes);
 if(snapshot.format!=='craftmine.godot-progress/1'||snapshot.worldId!==manifest.worldId||snapshot.body.worldId!==manifest.worldId||snapshot.baseId!==manifest.baseId)fail();
 snapshot.worldId=worldId;snapshot.body.worldId=worldId;
 // These are newly generated host envelopes, not imported progress/history.
 files.set('craftmine_initial_state.json',{path:'craftmine_initial_state.json',bytes:Buffer.from(JSON.stringify({format:'craftmine.materialized-initial-state/1',worldId,baseId:manifest.baseId,template,initialProgress:snapshot.body},null,2)+'\n')});
 fs.mkdirSync(out);
 for(const file of files.values()){const target=path.join(out,file.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,file.bytes,{flag:'wx'});}
 const result={format:'craftmine.managed-base-source/1',baseId:manifest.baseId,baseVersion:manifest.baseVersion,worldId,template,
  protocol:'craftmine.godot-runtime/2',progressFormat:'craftmine.godot-progress/1',stateVersion:1,templateSource:option.source,
  files:[...files.values()].map(f=>({path:f.path,bytes:f.bytes.length,sha256:hash(f.bytes)})).sort((a,b)=>a.path.localeCompare(b.path))};
 fs.writeFileSync(path.join(out,'managed-base.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
}
