// Official, complete portable runtime. Never discovers an executable on PATH.
import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {extractBlenderArchive} from './extract-toolchain.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
export const blenderLock=JSON.parse(await fs.readFile(path.join(here,'toolchain.lock.json'),'utf8'));
export async function blenderFileHash(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
export function safeBlenderPath(value){
  if(typeof value!=='string'||!value||value.includes('\\')||value.includes(':')||value.startsWith('/')||value.split('/').some(x=>!x||x==='.'||x==='..'||/[\x00-\x1f]|[. ]$/.test(x)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(x)))throw Error('BLENDER_PATH_INVALID');
  return value;
}
export async function ordinaryBlenderDirectory(directory){
  let current=path.resolve(directory);
  for(;;){const stat=await fs.lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('BLENDER_DIRECTORY_LINK_DENIED');const parent=path.dirname(current);if(parent===current)break;current=parent;}
}
export async function blenderInventory(directory,prefix=''){
  await ordinaryBlenderDirectory(directory);
  const files=[];
  for(const name of(await fs.readdir(directory)).sort()){
    const relative=safeBlenderPath(prefix?prefix+'/'+name:name),file=path.join(directory,name),stat=await fs.lstat(file);
    if(stat.isSymbolicLink())throw Error('BLENDER_LINK_DENIED:'+relative);
    if(stat.isDirectory())files.push(...await blenderInventory(file,relative));
    else if(stat.isFile())files.push({path:relative,bytes:stat.size,sha256:await blenderFileHash(file)});
    else throw Error('BLENDER_SPECIAL_FILE_DENIED:'+relative);
  }
  return files;
}
export async function verifyBlenderArtifact(file,pin){
  await ordinaryBlenderDirectory(path.dirname(file));const stat=await fs.lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==pin.bytes||await blenderFileHash(file)!==pin.sha256)throw Error('BLENDER_ARTIFACT_PIN_MISMATCH:'+file);
}
export async function verifyBlenderRuntime(directory,lock=blenderLock){
  const files=await blenderInventory(directory);
  if(JSON.stringify(files)!==JSON.stringify(lock.files))throw Error('BLENDER_RUNTIME_INVENTORY_MISMATCH');
  return {version:lock.version,files:files.length,totalBytes:files.reduce((sum,file)=>sum+file.bytes,0)};
}
async function downloadPinned(cache,pin){
  const target=path.join(cache,safeBlenderPath(pin.file));
  try{await fs.lstat(target);}catch(error){
    if(error.code!=='ENOENT')throw error;
    const partial=target+'.partial-'+randomUUID();
    const response=await fetch(pin.url);if(!response.ok)throw Error('BLENDER_DOWNLOAD_FAILED:'+response.status);
    await pipeline(Readable.fromWeb(response.body),createWriteStream(partial,{flags:'wx'}));
    await verifyBlenderArtifact(partial,pin);await fs.rename(partial,target);
  }
  await verifyBlenderArtifact(target,pin);return target;
}
export async function prepareBlenderToolchain(cache=path.resolve(here,'../build/blender')){
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('BLENDER_WINDOWS_X64_REQUIRED');
  if(!path.isAbsolute(cache))throw Error('BLENDER_CACHE_MUST_BE_ABSOLUTE');
  await fs.mkdir(cache,{recursive:true});await ordinaryBlenderDirectory(cache);
  const archive=await downloadPinned(cache,blenderLock.archive);
  await downloadPinned(cache,blenderLock.source);
  const runtime=path.join(cache,'runtime');
  try{await fs.lstat(runtime);}catch(error){
    if(error.code!=='ENOENT')throw error;
    const pending=path.join(cache,'extract-'+randomUUID());await fs.mkdir(pending);
    await extractBlenderArchive(archive,pending,blenderLock.archive.root,safeBlenderPath);
    const extracted=path.join(pending,blenderLock.archive.root);await verifyBlenderRuntime(extracted);
    await fs.rename(extracted,runtime);await fs.rmdir(pending);
  }
  const result=await verifyBlenderRuntime(runtime);
  await fs.copyFile(path.join(here,'toolchain.lock.json'),path.join(cache,'toolchain.lock.json'));
  return {cache,runtime,...result};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length!==0&&(args.length!==2||args[0]!=='--cache'||!path.isAbsolute(args[1])))throw Error('Usage: node desktop/blender/toolchain.mjs [--cache ABSOLUTE_PATH]');
  console.log(JSON.stringify(await prepareBlenderToolchain(args[1])));
}
