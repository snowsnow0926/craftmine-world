// A portable derivative of one already verified, sealed Windows release.
// No downloads, caller-selected commands, modifications to output, or signing.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileHash} from './prepare-runtime-resources.mjs';
import {readRelease,verifySeal,verifyArchiveTool,noLinks,within,archiveEntries,selectInstaller} from './release-run.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const relative=(root,file)=>path.relative(root,file).replaceAll('\\','/');
const MAX_FILES=100000, MAX_BYTES=32*1024**3, MAX_JSON=64*1024**2;
function demand(condition,code){if(!condition)throw Error(code);}
export function portablePath(value){
  demand(typeof value==='string'&&value.length>0&&value.length<=2048&&!value.includes('\\'),'PORTABLE_PATH_DENIED');
  demand(value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!/[<>:"|?*\x00-\x1f\x7f]|[. ]$/.test(part)
    && !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)),'PORTABLE_PATH_DENIED');
  return value;
}
async function regular(file){
  await noLinks(file);const info=await fs.lstat(file);
  demand(info.isFile()&&info.nlink===1,'PORTABLE_FILE_NOT_ORDINARY');return info;
}
async function jsonFile(file){const info=await regular(file);demand(info.size<=MAX_JSON,'PORTABLE_JSON_TOO_LARGE');return JSON.parse(await fs.readFile(file,'utf8'));}
export async function portableInventory(directory){
  await noLinks(directory);demand((await fs.lstat(directory)).isDirectory(),'PORTABLE_DIRECTORY_REQUIRED');
  const files=[],seen=new Set();let total=0;
  async function walk(dir,prefix=''){
    for(const name of(await fs.readdir(dir)).sort()){
      const child=portablePath(prefix?prefix+'/'+name:name),key=child.toLowerCase();
      demand(!seen.has(key),'PORTABLE_PATH_COLLISION');seen.add(key);
      const file=path.join(dir,name),info=await fs.lstat(file);
      demand(!info.isSymbolicLink(),'PORTABLE_LINK_DENIED');
      if(info.isDirectory())await walk(file,child);
      else {
        demand(info.isFile()&&info.nlink===1,'PORTABLE_FILE_NOT_ORDINARY');
        total+=info.size;demand(files.length<MAX_FILES&&total<=MAX_BYTES,'PORTABLE_PAYLOAD_LIMIT');
        files.push({path:child,bytes:info.size,sha256:await fileHash(file)});
      }
    }
  }
  await walk(directory);return files;
}
function inventory(value){
  demand(Array.isArray(value)&&value.length>0&&value.length<=MAX_FILES,'PORTABLE_INVENTORY_INVALID');
  const seen=new Set();let total=0;
  for(const file of value){
    portablePath(file?.path);demand(Object.keys(file).sort().join(',')==='bytes,path,sha256','PORTABLE_INVENTORY_INVALID');
    demand(Number.isSafeInteger(file.bytes)&&file.bytes>=0&&/^[a-f0-9]{64}$/.test(file.sha256),'PORTABLE_INVENTORY_INVALID');
    demand(!seen.has(file.path.toLowerCase()),'PORTABLE_PATH_COLLISION');seen.add(file.path.toLowerCase());
    total+=file.bytes;demand(total<=MAX_BYTES,'PORTABLE_PAYLOAD_LIMIT');
  }
  return value;
}
function sameFiles(actual,expected,code){
  inventory(expected);demand(JSON.stringify(actual)===JSON.stringify(expected),code);
}
export async function verifyPortablePayload(directory,files){
  sameFiles(await portableInventory(directory),files,'PORTABLE_EXTRACTED_BYTES_MISMATCH');
}
function cleanHead(root){
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:32*1024**2}).trim();
  demand(git(['status','--porcelain','--untracked-files=normal'])==='','PORTABLE_SOURCE_NOT_CLEAN');
  return git(['rev-parse','HEAD']);
}

/** Check every input before creating a derivative directory. No source fallback. */
export async function verifyPortableInputs(root,runFile){
  root=path.resolve(root);await noLinks(root);
  const head=cleanHead(root),run=await readRelease(root,path.resolve(runFile));
  demand(head===run.commit,'PORTABLE_SOURCE_NOT_CURRENT');
  const runDirectory=path.dirname(run.runFile),sealFile=path.join(runDirectory,'seal.json');
  const seal=await verifySeal(run),evidenceFile=path.join(runDirectory,'package-evidence.json');
  const evidence=await jsonFile(evidenceFile),manifestFile=path.join(root,'desktop/build/build-manifest.json');
  const manifest=await jsonFile(manifestFile),packageRoot=path.join(run.output,'win-unpacked');
  demand(manifest.format==='craftmine.build/1'&&manifest.commit===head,'PORTABLE_BUILD_IDENTITY_MISMATCH');
  demand(evidence.format==='craftmine.package-evidence/2'&&evidence.commit===head
    && evidence.runFile===relative(root,run.runFile)&&evidence.buildManifestSha256===run.buildManifestSha256
    && evidence.sourceArchiveHash===manifest.sourceArchiveHash,'PORTABLE_PACKAGE_EVIDENCE_MISMATCH');
  demand(evidence.signature==='unsigned-local-preview','PORTABLE_SIGNATURE_BOUNDARY_UNKNOWN');
  const metadata=await jsonFile(path.join(root,'vendor/pi-desktop/apps/desktop/package.json'));
  const pair=selectInstaller(seal.files,run.installer,metadata.version);
  demand(JSON.stringify(evidence.installers)===JSON.stringify(pair?[pair.installer,pair.blockmap]:[]),'PORTABLE_INSTALLER_EVIDENCE_MISMATCH');
  if(pair)demand(evidence.extraction?.verified===true&&JSON.stringify(evidence.extraction.tool)===JSON.stringify(run.archiveTool),'PORTABLE_INSTALLER_NOT_VERIFIED');
  const files=await portableInventory(packageRoot);
  sameFiles(files,evidence.files,'PORTABLE_PACKAGE_BYTES_MISMATCH');
  const sealed=seal.files.filter(file=>file.path.startsWith('win-unpacked/')).map(file=>({...file,path:file.path.slice('win-unpacked/'.length)}));
  sameFiles(files,sealed,'PORTABLE_SEAL_PAYLOAD_MISMATCH');
  demand(evidence.totalBytes===files.reduce((sum,file)=>sum+file.bytes,0),'PORTABLE_PACKAGE_SIZE_MISMATCH');
  const required=name=>files.find(file=>file.path===name);
  demand(required('Craftmine World.exe')&&required('resources/app.asar'),'PORTABLE_APPLICATION_MISSING');
  demand(required('resources/source/build-manifest.json')?.sha256===run.buildManifestSha256,'PORTABLE_PACKAGED_MANIFEST_MISMATCH');
  demand(required('resources/source/CraftmineWorld-source.zip')?.sha256===manifest.sourceArchiveHash,'PORTABLE_SOURCE_ARCHIVE_MISMATCH');
  const identity={commit:head,runSha256:await fileHash(run.runFile),releaseSealSha256:await fileHash(sealFile),
    packageEvidenceSha256:await fileHash(evidenceFile),buildManifestSha256:run.buildManifestSha256,
    sourceArchiveHash:manifest.sourceArchiveHash,payloadDigest:hash(JSON.stringify(files))};
  return {root,run,runDirectory,packageRoot,evidence,files,identity};
}

/** Validate the generated ZIP's listing before it can be extracted. */
export function verifyPortableListing(listing,files){
  inventory(files);
  // Do not let Unix device, FIFO, socket, or symlink modes become regular files.
  demand(!/^(?:Mode|Attributes) = .*\b[bcpls][rwxStTs-]{9}(?=\s|$)/m.test(listing),'PORTABLE_ARCHIVE_SPECIAL_FILE');
  const entries=archiveEntries(listing),expected=new Map(files.map(file=>[file.path,file]));
  for(const item of entries){
    portablePath(item.path);
    if(item.directory)demand(files.some(file=>file.path.startsWith(item.path+'/')),'PORTABLE_ARCHIVE_UNKNOWN_DIRECTORY');
    else demand(expected.get(item.path)?.bytes===item.size,'PORTABLE_ARCHIVE_FILE_MISMATCH');
  }
  demand(entries.filter(item=>!item.directory).length===files.length,'PORTABLE_ARCHIVE_FILE_MISMATCH');
  return entries;
}

export async function sealPortable(root,runFile){
  root=path.resolve(root);
  const ownedRun=within(path.join(root,'desktop/build/releases'),path.resolve(runFile));
  demand(path.basename(ownedRun)==='run.json','PORTABLE_RUN_FILE_REQUIRED');
  const record=await jsonFile(ownedRun),runDirectory=path.dirname(ownedRun);
  demand(record.format==='craftmine.release-run/1'&&path.resolve(record.root)===root
    &&path.resolve(record.output)===path.join(runDirectory,'output'),'PORTABLE_RUN_OWNER_MISMATCH');
  // Once ownership is established, even a failed preflight gets its own report.
  // Invalid or foreign run paths never authorize filesystem writes.
  const directory=within(runDirectory,path.join(runDirectory,'portable-'+randomUUID()));
  await fs.mkdir(directory);await noLinks(directory);
  const extracted=path.join(directory,'extracted'),logs=[];
  const report={format:'craftmine.portable-report/1',passed:false,directory,runFile:ownedRun,steps:[],startedAt:new Date().toISOString()};
  let tool;
  const invoke=(args,cwd=directory)=>{
    const record={args,cwd,startedAt:new Date().toISOString()};logs.push(record);
    try{const stdout=execFileSync(tool.path,args,{cwd,windowsHide:true,encoding:'utf8',timeout:300000,maxBuffer:32*1024**2});record.exitCode=0;record.stdout=stdout;return stdout;}
    catch(error){record.exitCode=error.status??null;record.error=String(error.message);record.stdout=String(error.stdout??'');record.stderr=String(error.stderr??'');throw error;}
  };
  try{
    const inputs=await verifyPortableInputs(root,ownedRun);
    tool=await verifyArchiveTool(inputs.run.archiveTool);
    // The tool pin is inherited from this release; never discovered on PATH.
    const zip=path.join(directory,'Craftmine-World-portable-'+inputs.identity.commit.slice(0,12)+'.zip');
    report.source=inputs.identity;
    report.steps.push('input identities verified');
    invoke(['a','-tzip','-mx=5','-bd','-y','--',zip,'.'],inputs.packageRoot);
    await regular(zip);const zipBefore=await fileHash(zip);
    const listing=invoke(['l','-slt','-sccUTF-8','--',zip]);
    verifyPortableListing(listing,inputs.files);report.steps.push('archive entries verified before extraction');
    await fs.mkdir(extracted);
    invoke(['x','-y','-bd','-o'+extracted,'--',zip]);
    await verifyPortablePayload(extracted,inputs.files);
    demand(await fileHash(zip)===zipBefore,'PORTABLE_ZIP_CHANGED');
    report.steps.push('extracted full payload matched');
    const after=await verifyPortableInputs(inputs.root,inputs.run.runFile);
    demand(JSON.stringify(after.identity)===JSON.stringify(inputs.identity),'PORTABLE_INPUT_CHANGED');
    await verifyArchiveTool(inputs.run.archiveTool);
    report.steps.push('source, original seal, package evidence and tool pins reverified');
    const archive={path:path.basename(zip),bytes:(await regular(zip)).size,sha256:zipBefore};
    const evidence={format:'craftmine.portable-evidence/1',createdAt:new Date().toISOString(),
      releaseRun:relative(inputs.root,inputs.run.runFile),source:inputs.identity,tool,
      archive,files:inputs.files,totalBytes:inputs.evidence.totalBytes,extraction:{directory:'extracted',verified:true,payloadDigest:inputs.identity.payloadDigest},
      signature:'unsigned-local-preview',installerExecuted:false,portableExecuted:false,cleanWindowsVerified:false,
      reproducibility:'This ZIP and its extracted payload are measured; byte-identical compression across runs is not claimed.'};
    const evidenceFile=path.join(directory,'portable-evidence.json');
    await fs.writeFile(evidenceFile,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
    const seal={format:'craftmine.portable-seal/1',sealedAt:new Date().toISOString(),source:inputs.identity,
      evidenceSha256:await fileHash(evidenceFile),archive,extractedPayloadDigest:inputs.identity.payloadDigest,
      files:inputs.files,tool};
    await fs.writeFile(path.join(directory,'portable-seal.json'),JSON.stringify(seal,null,2)+'\n',{flag:'wx'});
    report.passed=true;return {directory,evidenceFile,archive,source:inputs.identity};
  }catch(error){report.error=String(error.stack??error);throw Object.assign(error,{portableDirectory:directory});}
  finally{
    report.finishedAt=new Date().toISOString();
    await fs.writeFile(path.join(directory,'archive-commands.json'),JSON.stringify(logs,null,2)+'\n',{flag:'wx'});
    await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    demand(process.argv.length===4&&process.argv[2]==='--run'&&process.argv[3],'Use node desktop/seal-portable.mjs --run <sealed run.json>');
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
    console.log(JSON.stringify(await sealPortable(root,process.argv[3])));
  }catch(error){console.error(JSON.stringify({passed:false,error:String(error.message),directory:error.portableDirectory??null}));process.exitCode=1;}
}
