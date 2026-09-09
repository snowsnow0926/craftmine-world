import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileHash,resourceInventory} from './prepare-runtime-resources.mjs';

export function within(parent,target){
  const rel=path.relative(path.resolve(parent),path.resolve(target));
  if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('RELEASE_PATH_OUTSIDE_OWNER');
  return path.resolve(target);
}
export async function noLinks(target){
  let current=path.resolve(target);
  while(true){const info=await fs.lstat(current);if(info.isSymbolicLink())throw Error('RELEASE_LINK_DENIED');const next=path.dirname(current);if(next===current)break;current=next;}
}
export async function verifyArchiveTool(tool){
  if(!tool||typeof tool.path!=='string'||!path.isAbsolute(tool.path)||!/^([a-f0-9]{64})$/.test(tool.sha256)||!/^([a-f0-9]{64})$/.test(tool.librarySha256))throw Error('RELEASE_FULL_ARCHIVE_TOOL_PIN_REQUIRED');
  await noLinks(tool.path);const library=path.join(path.dirname(tool.path),'7z.dll');await noLinks(library);
  if(await fileHash(tool.path)!==tool.sha256||await fileHash(library)!==tool.librarySha256)throw Error('RELEASE_ARCHIVE_TOOL_PIN_MISMATCH');
  const formats=execFileSync(tool.path,['i'],{encoding:'utf8',windowsHide:true,timeout:30000});
  if(!/\bNsis\b/i.test(formats))throw Error('RELEASE_ARCHIVE_TOOL_NSIS_UNSUPPORTED');
  return tool;
}
export async function beginRelease(root,manifest,{installer=false,archiveTool=null}={}){
  if(installer&&archiveTool)await verifyArchiveTool(archiveTool);
  const parent=path.join(root,'desktop/build/releases');await fs.mkdir(parent,{recursive:true});await noLinks(parent);
  const directory=path.join(parent,manifest.commit.slice(0,12)+'-'+randomUUID());
  await fs.mkdir(directory);const output=path.join(directory,'output');await fs.mkdir(output);
  const record={format:'craftmine.release-run/1',root:path.resolve(root),commit:manifest.commit,installer,archiveTool,output,
    buildManifestSha256:await fileHash(path.join(root,'desktop/build/build-manifest.json')),createdAt:new Date().toISOString()};
  const runFile=path.join(directory,'run.json');await fs.writeFile(runFile,JSON.stringify(record,null,2)+'\n',{flag:'wx'});
  return {...record,runFile};
}
export async function readRelease(root,runFile){
  const filename=within(path.join(root,'desktop/build/releases'),runFile);await noLinks(filename);
  const run=JSON.parse(await fs.readFile(filename,'utf8'));
  if(run.format!=='craftmine.release-run/1'||path.resolve(run.root)!==path.resolve(root)||path.resolve(run.output)!==path.join(path.dirname(filename),'output')||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(run.commit)||typeof run.installer!=='boolean')throw Error('RELEASE_OWNER_MISMATCH');
  await noLinks(run.output);
  if(await fileHash(path.join(root,'desktop/build/build-manifest.json'))!==run.buildManifestSha256)throw Error('RELEASE_BUILD_MANIFEST_CHANGED');
  return {...run,runFile:filename};
}
export function selectInstaller(files,installer,version){
  const expected=`Craftmine-World-Setup-${version}.exe`;
  const artifacts=files.filter(f=>!f.path.includes('/')&&(/\.exe$/i.test(f.path)||/\.blockmap$/i.test(f.path)));
  if(!installer){if(artifacts.length)throw Error('RELEASE_UNEXPECTED_INSTALLER');return null;}
  if(artifacts.length!==2||!artifacts.some(f=>f.path===expected)||!artifacts.some(f=>f.path===expected+'.blockmap')||artifacts.some(f=>!f.bytes))throw Error('RELEASE_INSTALLER_PAIR_MISMATCH');
  return {installer:artifacts.find(f=>f.path===expected),blockmap:artifacts.find(f=>f.path===expected+'.blockmap')};
}
export async function sealRelease(run,version){
  const files=await resourceInventory(run.output);selectInstaller(files,run.installer,version);
  if(!files.some(f=>f.path==='win-unpacked/resources/source/build-manifest.json'))throw Error('RELEASE_UNPACKED_ABSENT');
  const seal={format:'craftmine.release-seal/1',runSha256:await fileHash(run.runFile),sealedAt:new Date().toISOString(),files};
  await fs.writeFile(path.join(path.dirname(run.runFile),'seal.json'),JSON.stringify(seal,null,2)+'\n',{flag:'wx'});
  return seal;
}
export async function verifySeal(run){
  const sealFile=path.join(path.dirname(run.runFile),'seal.json');await noLinks(sealFile);
  const seal=JSON.parse(await fs.readFile(sealFile,'utf8'));
  if(seal.format!=='craftmine.release-seal/1'||seal.runSha256!==await fileHash(run.runFile)||JSON.stringify(seal.files)!==JSON.stringify(await resourceInventory(run.output)))throw Error('RELEASE_OUTPUT_CHANGED_AFTER_SEAL');
  return seal;
}
// 7-Zip technical listing is inspected BEFORE extraction. Reject Windows aliases,
// traversal, ADS and links so extraction cannot escape its fresh owned directory.
export function archiveEntries(listing){
  const body=listing.split(/^----------\s*$/m).slice(1).join('\n');if(!body)throw Error('RELEASE_ARCHIVE_LIST_INVALID');
  const entries=[];const seen=new Set();
  for(const block of body.trim().split(/\r?\n\s*\r?\n/)){
    const values={};for(const line of block.split(/\r?\n/)){const i=line.indexOf(' = ');if(i>0)values[line.slice(0,i)]=line.slice(i+3);}
    if(!values.Path)continue;
    const name=values.Path.replaceAll('\\','/'),parts=name.split('/');
    if(parts.some(p=>!p||p==='.'||p==='..'||/[<>:"|?*\x00-\x1f]/.test(p)||/[. ]$/.test(p)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))||seen.has(name.toLowerCase()))throw Error('RELEASE_ARCHIVE_PATH_DENIED:'+name);
    if(values['Symbolic Link']||values['Hard Link']||values['Reparse Point']||/\bl[rwx-]{9}\b/.test(values.Mode||'')||/\bl[rwx-]{9}\b/.test(values.Attributes||'')||/\bL\b/.test(values.Attributes||''))throw Error('RELEASE_ARCHIVE_LINK_DENIED');
    seen.add(name.toLowerCase());entries.push({path:name,directory:values.Folder==='+'||/^D/.test(values.Attributes||''),size:Number(values.Size||0)});
  }
  if(!entries.length)throw Error('RELEASE_ARCHIVE_EMPTY');return entries;
}
export async function extractInstaller(run,pair,sevenZip){
  await noLinks(sevenZip);
  const evidence=path.join(path.dirname(run.runFile),'extracted-'+randomUUID());await fs.mkdir(evidence);
  const logs=[];
  const invoke=args=>{const value=execFileSync(sevenZip,args,{encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024,timeout:300000});logs.push({args,output:value});return value;};
  const installer=path.join(run.output,pair.installer.path);
  try{
    const outer=archiveEntries(invoke(['l','-slt','-sccUTF-8',installer]));
    const payloads=outer.filter(e=>!e.directory&&/^\$PLUGINSDIR\/app-64\.(7z|zip)$/.test(e.path));
    if(payloads.length!==1)throw Error('RELEASE_NSIS_PAYLOAD_AMBIGUOUS');
    const payloadDirectory=path.join(evidence,'payload');await fs.mkdir(payloadDirectory);
    invoke(['e','-y','-bd','-o'+payloadDirectory,installer,payloads[0].path]);
    const payload=path.join(payloadDirectory,path.basename(payloads[0].path));await noLinks(payload);
    archiveEntries(invoke(['l','-slt','-sccUTF-8',payload]));
    const application=path.join(evidence,'application');await fs.mkdir(application);
    invoke(['x','-y','-bd','-o'+application,payload]);
    await resourceInventory(application); // reject any unexpected link after extraction too
    return {application,payloadSha256:await fileHash(payload),tool:{path:sevenZip,sha256:await fileHash(sevenZip)},directory:evidence};
  }finally{await fs.writeFile(path.join(evidence,'archive-commands.json'),JSON.stringify(logs,null,2)+'\n');}
}
