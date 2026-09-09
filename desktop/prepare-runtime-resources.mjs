// Fixed Windows release resources. No downloads, user PATH Git discovery or
// caller-selected export commands. Invoked after a clean-source release build.
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readGitSnapshot} from './delivery/lib/source-bytes.mjs';
import {loadRuntimeDistribution,stageRuntimeSourceSnapshot} from './delivery/lib/runtime-distribution.mjs';
import {GPL3_TEXT} from './delivery/lib/gpl-text-pin.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const OWNER='.craftmine-runtime-stage.json';
const FORMAT='craftmine.runtime-resources/1';
const hash=value=>createHash('sha256').update(value).digest('hex');
export const REQUIRED_WEB_TEMPLATE_KEYS=Object.freeze(['webDebug','webThreadedRelease','webRelease']);
export async function fileHash(file){const digest=createHash('sha256');for await(const part of createReadStream(file))digest.update(part);return digest.digest('hex');}
export function safeResourcePath(value){
  if(typeof value!=='string'||!value||value.includes('\\')||value.includes(':')||value.startsWith('/')||value.includes('\0'))throw Error('RUNTIME_RESOURCE_PATH_INVALID');
  if(value.split('/').some(part=>!part||part==='.'||part==='..'||/[\x00-\x1f]|[. ]$/.test(part)||/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)))throw Error('RUNTIME_RESOURCE_PATH_INVALID');
  return value;
}
async function ordinaryAncestors(target){
  let current=path.resolve(target);
  for(;;){const stat=await fs.lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('RUNTIME_LINK_OR_NON_DIRECTORY:'+current);
    const parent=path.dirname(current);if(parent===current)break;current=parent;}
}
export async function resourceInventory(directory,prefix=''){
  const files=[];
  for(const name of(await fs.readdir(directory)).sort()){
    const relative=prefix?prefix+'/'+name:name;
    safeResourcePath(relative);
    if(relative===OWNER||relative==='runtime-resources.json')continue;
    const target=path.join(directory,name),stat=await fs.lstat(target);
    if(stat.isSymbolicLink())throw Error('RUNTIME_LINK_DENIED:'+relative);
    if(stat.isDirectory())files.push(...await resourceInventory(target,relative));
    else if(stat.isFile())files.push({path:relative,bytes:stat.size,sha256:await fileHash(target)});
    else throw Error('RUNTIME_SPECIAL_FILE_DENIED:'+relative);
  }
  return files;
}
export async function verifyRuntimeResources(directory,expectedCommit,{packaged=false}={}){
  await ordinaryAncestors(directory);
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'runtime-resources.json'),'utf8'));
  if(manifest.format!==FORMAT||manifest.sourceCommit!==expectedCommit)throw Error('RUNTIME_SOURCE_IDENTITY_MISMATCH');
  const files=packaged?(await Promise.all(['git','godot','licenses/godot','licenses/gpl'].map(async prefix=>resourceInventory(path.join(directory,prefix),prefix)))).flat():await resourceInventory(directory);
  if(JSON.stringify(files)!==JSON.stringify(manifest.files))throw Error('RUNTIME_RESOURCE_HASH_MISMATCH');
  if(hash(JSON.stringify(files))!==manifest.filesDigest)throw Error('RUNTIME_RESOURCE_DIGEST_MISMATCH');
  return manifest;
}
function command(binary,args,options={}){return execFileSync(binary,args,{cwd:root,windowsHide:true,encoding:'utf8',maxBuffer:32*1024*1024,...options}).trim();}
function sourceCommit(){
  if(command('git',['status','--porcelain','--untracked-files=normal']))throw Error('RUNTIME_SOURCE_NOT_CLEAN');
  return command('git',['rev-parse','HEAD']);
}
async function verifiedCopy(source,target,pin={}){
  await ordinaryAncestors(path.dirname(source));
  const stat=await fs.lstat(source);
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('RUNTIME_SOURCE_NOT_REGULAR:'+source);
  const sha256=await fileHash(source);
  if((pin.sha256&&sha256!==pin.sha256)||(pin.bytes!==undefined&&stat.size!==pin.bytes))throw Error('RUNTIME_INPUT_PIN_MISMATCH:'+source);
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(source,target);
  if(await fileHash(target)!==sha256)throw Error('RUNTIME_COPY_HASH_MISMATCH');
  return {bytes:stat.size,sha256};
}
export async function stageGplText(sourceRoot,staging){
  return verifiedCopy(path.join(sourceRoot,GPL3_TEXT.source),path.join(staging,GPL3_TEXT.resource),GPL3_TEXT);
}
async function verifyArchive(file,pin){
  await ordinaryAncestors(path.dirname(file));const stat=await fs.lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==pin.bytes||await fileHash(file)!==pin.sha256)throw Error('RUNTIME_ARCHIVE_PIN_MISMATCH:'+file);
}
async function copyTracked(relative,target){
  const files=readGitSnapshot(root,sourceCommit(),[relative]);
  if(!files.size)throw Error('RUNTIME_TRACKED_SOURCE_MISSING:'+relative);
  for(const [file,entry]of files){
    safeResourcePath(file);const destination=path.join(target,path.relative(relative,file));
    await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,entry.bytes);
    if(await fileHash(destination)!==entry.sha256)throw Error('RUNTIME_SOURCE_COPY_CHANGED:'+file);
  }
}
async function replaceOwned(staging,output,commit){
  const build=path.resolve(root,'desktop/build');
  await ordinaryAncestors(build);
  if(path.dirname(output)!==build||path.basename(output)!=='runtime-resources'||path.dirname(staging)!==build)throw Error('RUNTIME_OUTPUT_ESCAPE');
  if(sourceCommit()!==commit)throw Error('RUNTIME_SOURCE_CHANGED');
  try{
    await ordinaryAncestors(output);
    const owner=JSON.parse(await fs.readFile(path.join(output,OWNER),'utf8'));
    if(owner.format!==FORMAT||owner.workspace!==await fs.realpath(root))throw Error('RUNTIME_OUTPUT_NOT_OWNED');
    // Enumerate and reject every link before recursive removal of this exact
    // build output. Never follow a reparse point into another workspace.
    await resourceInventory(output);
    await fs.rm(output,{recursive:true});
  }catch(error){if(error.code!=='ENOENT')throw error;const present=await fs.lstat(output).catch(()=>null);if(present)throw Error('RUNTIME_OUTPUT_NOT_OWNED');}
  if(sourceCommit()!==commit)throw Error('RUNTIME_SOURCE_CHANGED');
  await fs.rename(staging,output);
}
export async function prepareRuntimeResources({godotCache,gitZip,brokerBin}){
  if(process.platform!=='win32')throw Error('WINDOWS_BUILD_REQUIRED');
  const commit=sourceCommit();
  for(const value of [godotCache,gitZip,brokerBin])if(typeof value!=='string'||!path.isAbsolute(value))throw Error('ABSOLUTE_BUILD_INPUT_REQUIRED');
  const lock=JSON.parse(await fs.readFile(path.join(root,'desktop/godot/toolchain.lock.json'),'utf8'));
  const git=JSON.parse(await fs.readFile(path.join(root,'desktop/delivery/git-bundle.json'),'utf8'));
  const tpz=path.join(godotCache,lock.exportTemplates.file);
  await verifyArchive(tpz,lock.exportTemplates);await verifyArchive(gitZip,git.archive);
  const build=path.join(root,'desktop/build');await fs.mkdir(build,{recursive:true});await ordinaryAncestors(build);
  const staging=path.join(build,'runtime-resources.pending-'+randomUUID());await fs.mkdir(staging);
  await fs.writeFile(path.join(staging,OWNER),JSON.stringify({format:FORMAT,workspace:await fs.realpath(root),sourceCommit:commit}));
  // A failed attempt is retained with its owner marker for diagnosis.
  const engine=path.join(staging,'godot/engine',lock.version);
  await verifiedCopy(path.join(godotCache,'editor',lock.editor.executable),path.join(engine,'editor',lock.editor.executable),{sha256:lock.editor.executableSha256});
  const templates=path.join(engine,'templates');await fs.mkdir(templates,{recursive:true});
  command('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'desktop/extract-runtime-resources.ps1'),'-Archive',tpz,'-Destination',templates,'-Kind','GodotWindows']);
  for(const key of REQUIRED_WEB_TEMPLATE_KEYS){const pin=lock.exportTemplates[key];if(!pin)throw Error('RUNTIME_TEMPLATE_PIN_MISSING:'+key);await verifiedCopy(path.join(godotCache,'templates',pin.file),path.join(templates,pin.file),pin);}
  await fs.writeFile(path.join(templates,'version.txt'),lock.version.replace('-stable','.stable')+'\n');
  const broker=path.join(staging,'godot/broker/godot-host-broker.exe');await verifiedCopy(brokerBin,broker);
  const brokerIdentity=JSON.parse(command(process.execPath,[path.join(root,'desktop/godot/sandbox/broker-identity.mjs'),broker],{
    env:{...process.env,CRAFTMINE_BROKER_PROFILE:'release',CRAFTMINE_BROKER_SOURCE_COMMIT:commit}}));
  brokerIdentity.builtFrom=path.resolve(brokerBin);
  await fs.writeFile(path.join(staging,'godot/broker/broker-identity.json'),JSON.stringify(brokerIdentity,null,2)+'\n');
  // Engine/broker already live in godot/, so build the validated source subset
  // separately before moving only these three managed source directories.
  const sourceStage=path.join(staging,'managed-source');
  const sourceDistribution=stageRuntimeSourceSnapshot(readGitSnapshot(root,commit,['desktop/godot/bases','desktop/godot/shared','desktop/godot/web']),sourceStage,loadRuntimeDistribution(root));
  for(const relative of ['bases','shared','web'])await fs.rename(path.join(sourceStage,relative),path.join(staging,'godot',relative));
  await fs.rmdir(sourceStage);
  await copyTracked('desktop/godot/licenses',path.join(staging,'godot','licenses'));
  for(const pin of lock.licenses)if(await fileHash(path.join(staging,'godot',pin.file))!==pin.sha256)throw Error('GODOT_NOTICE_PIN_MISMATCH');
  await copyTracked('desktop/godot/licenses',path.join(staging,'licenses/godot'));
  await stageGplText(root,staging);
  await verifiedCopy(path.join(root,'desktop/godot/toolchain.lock.json'),path.join(staging,'godot/toolchain.lock.json'));
  const gitRoot=path.join(staging,'git');await fs.mkdir(gitRoot);
  command('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'desktop/extract-runtime-resources.ps1'),'-Archive',gitZip,'-Destination',gitRoot,'-Kind','MinGit']);
  await verifiedCopy(path.join(gitRoot,git.layout.sourceEntry),path.join(gitRoot,git.layout.entry));
  const version=command(path.join(gitRoot,git.layout.entry),['--version']);
  if(version!=='git version '+git.version)throw Error('BUNDLED_GIT_VERSION_MISMATCH:'+version);
  if(!(await fs.stat(path.join(gitRoot,git.licence.file))).isFile())throw Error('GIT_LICENSE_MISSING');
  await verifiedCopy(path.join(root,'desktop/delivery/git-bundle.json'),path.join(gitRoot,'GIT-BUNDLE-PIN.json'));
  const gitFiles=await resourceInventory(gitRoot);
  await fs.writeFile(path.join(gitRoot,'GIT-BUNDLE.json'),JSON.stringify({format:'craftmine.git-bundle-staged/1',
    sourceCommit:commit,pin:{id:git.id,version:git.version,archiveSha256:git.archive.sha256,url:git.archive.url},
    entry:'resources/git/'+git.layout.entry,versionOutput:version,files:gitFiles,fileCount:gitFiles.length,
    totalBytes:gitFiles.reduce((sum,file)=>sum+file.bytes,0)},null,2)+'\n');
  const files=await resourceInventory(staging);
  const manifest={format:FORMAT,sourceCommit:commit,sourceDate:command('git',['show','-s','--format=%cI','HEAD']),
    sourceDistribution,
    toolchain:{godot:lock.version,templatesArchiveSha256:lock.exportTemplates.sha256,git:git.version,gitArchiveSha256:git.archive.sha256,
      brokerSha256:brokerIdentity.sha256,brokerSourceDigest:brokerIdentity.sourceDigest},
    files,filesDigest:hash(JSON.stringify(files)),totalBytes:files.reduce((sum,file)=>sum+file.bytes,0),
    limits:['Resource byte/source identity; no claim of install, clean-machine, model or game acceptance.']};
  await fs.writeFile(path.join(staging,'runtime-resources.json'),JSON.stringify(manifest,null,2)+'\n');
  const output=path.join(build,'runtime-resources');await replaceOwned(staging,output,commit);
  await verifyRuntimeResources(output,commit);
  return {output,sourceCommit:commit,files:files.length,totalBytes:manifest.totalBytes,filesDigest:manifest.filesDigest};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),options={};
  const names={'--godot-cache':'godotCache','--git-zip':'gitZip','--broker-bin':'brokerBin'};
  for(let i=0;i<args.length;i+=2){if(!names[args[i]]||!args[i+1]||Object.hasOwn(options,names[args[i]]))throw Error('INVALID_RUNTIME_BUILD_ARGUMENT');options[names[args[i]]]=path.resolve(args[i+1]);}
  console.log(JSON.stringify(await prepareRuntimeResources(options)));
}
