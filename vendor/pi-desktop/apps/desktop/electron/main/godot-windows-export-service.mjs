import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const TEMPLATE_HASH='d34d36f3be1a6c49c56525ae86469b92e4f417ddf0b43cf00dd80c385c4b0562';
const NATIVE_DIAGNOSTICS=new Set([
 ['Condition "res != ((HRESULT)0x00000000)" is true. Returning: String()','get_system_dir (platform/windows/os_windows.cpp:2502)'],
 ['Call to GetAdaptersAddresses failed with error 5.','get_local_interfaces (drivers/windows/ip_windows.cpp:117)'],
 ['Method/function failed. Returning: ""','get_filesystem_type (drivers/windows/dir_access_windows.cpp:412)'],
 ['Condition "_sock == (SOCKET)(~0)" is true. Returning: FAILED','open (drivers/windows/net_socket_winsock.cpp:238)'],
 ['Condition "err != OK" is true. Returning: ERR_CANT_CREATE','listen (core/io/tcp_server.cpp:56)'],
].map(([message,at])=>message+'|at: '+at));
export function verifyWindowsExportLog(text){const lines=text.split(/\r?\n/);for(let i=0;i<lines.length;i++){const line=lines[i].trim();if(/^(SCRIPT ERROR|Parse Error|USER ERROR)/.test(line))fail('EXPORT_SCRIPT_ERROR');if(line.startsWith('ERROR:')&&!NATIVE_DIAGNOSTICS.has(line.slice(6).trim()+'|'+(lines[i+1]??'').trim()))fail('EXPORT_ENGINE_ERROR');}}
const fail=code=>{throw Object.assign(Error(code),{code});};
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const id=value=>{if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,96}$/.test(value))fail('INVALID_EXPORT_ID');return value;};
const relative=value=>{if(typeof value!=='string'||value.length>220||value.includes('\\')||value.includes(':')||/[\x00-\x1f]/.test(value)||value.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)||['.git','.godot'].includes(p)))fail('INVALID_EXPORT_PATH');return value;};
async function ordinary(value,{directory=false,missing=false}={}){if(!path.isAbsolute(value))fail('EXPORT_ABSOLUTE_PATH_REQUIRED');const absolute=path.resolve(value);for(const ancestor of [absolute,...parents(absolute)]){const stat=await fs.lstat(ancestor).catch(error=>{if(missing&&ancestor===absolute&&error.code==='ENOENT')return null;throw error;});if(!stat)continue;if(stat.isSymbolicLink())fail('EXPORT_LINK_DENIED');if(ancestor!==absolute||directory){if(!stat.isDirectory())fail('EXPORT_DIRECTORY_REQUIRED');}else if(!stat.isFile())fail('EXPORT_FILE_REQUIRED');}return absolute;}
function parents(value){const result=[];while(path.dirname(value)!==value){value=path.dirname(value);result.push(value);}return result;}
async function readBounded(file,limit){const handle=await fs.open(await ordinary(file),'r');try{const stat=await handle.stat();if(stat.size>limit)fail('EXPORT_FILE_TOO_LARGE');const bytes=await handle.readFile();const after=await handle.stat();if(bytes.length!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)fail('EXPORT_FILE_CHANGED');return bytes;}finally{await handle.close();}}
async function writeNew(file,bytes){await fs.mkdir(path.dirname(file),{recursive:true});const handle=await fs.open(file,'wx');try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}}
async function inventory(root){const files=[];async function visit(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isSymbolicLink())fail('EXPORT_LINK_DENIED');if(entry.isDirectory())await visit(file);else{const bytes=await readBounded(file,256*1024*1024);files.push({path:relative(path.relative(root,file).replaceAll('\\','/')),bytes:bytes.length,sha256:hash(bytes)});}}}await visit(root);return files.sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));}
async function removeOwned(root,parent){if(path.dirname(root)!==parent||!path.basename(root).startsWith('.craftmine-export-'))fail('EXPORT_CLEANUP_SCOPE');await ordinary(root,{directory:true});await inventory(root);await fs.rm(root,{recursive:true});}

/** No renderer path, command, template override or executable is accepted. */
export function createGodotWindowsExportService(options){
 const operations=new Map(),locks=new Set();let disposed=false;
 const selected=async worldId=>{if(disposed)fail('EXPORT_SERVICE_DISPOSED');if(await options.selection()!==worldId)fail('WORLD_CHANGED');};
 const state=(entry,status,extra={})=>{entry.status=status;entry.view={worldId:entry.worldId,operationId:entry.operationId,status,...extra};return entry.view;};
 const operationRoot=(worldId,operationId)=>path.join(options.stagingRoot,'we-'+hash(worldId+':'+operationId).slice(0,24));
 async function readReceipt(worldId,operationId){
  if(!options.stagingRoot)return null;
  const root=operationRoot(worldId,operationId);if(!await fs.lstat(root).catch(error=>{if(error.code==='ENOENT')return null;throw error;}))return null;await ordinary(root,{directory:true});
  const read=async name=>JSON.parse((await readBounded(path.join(root,name),4*1024*1024)).toString('utf8'));
  const intent=await read('intent.json');if(intent.operationId!==operationId||intent.source?.worldId!==worldId)fail('EXPORT_OPERATION_IDENTITY_MISMATCH');
  const completed=await read('completed.json').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(completed?.receipt?.worldId===worldId&&completed.receipt.operationId===operationId&&completed.receipt.status==='completed')return completed.receipt;
  const publishing=await read('publishing.json').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(publishing){const bytes=await readBounded(path.join(publishing.output,'EXPORT.json'),4*1024*1024).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(bytes&&hash(bytes)===publishing.provenanceHash&&publishing.receipt?.worldId===worldId&&publishing.receipt.operationId===operationId)return publishing.receipt;}
  return {worldId,operationId,status:'interrupted',error:{code:'EXPORT_INTERRUPTED'}};
 }
 async function pinnedBroker(){const identity=JSON.parse((await readBounded(options.toolchain.brokerIdentity,1024*1024)).toString('utf8'));if(identity.format!=='craftmine.godot-broker-identity/1'||identity.policyVersion!=='craftmine.windows.lpac-registry.v1'||!sha(identity.sha256))fail('EXPORT_BROKER_PIN_REQUIRED');const bytes=await readBounded(options.toolchain.broker,64*1024*1024);if(hash(bytes)!==identity.sha256||bytes.length!==identity.bytes)fail('EXPORT_BROKER_PIN_MISMATCH');return identity;}
 async function recoverInterrupted(worldId,operationId){
  const root=operationRoot(worldId,operationId),tasks=path.join(root,'tasks');if(!await fs.lstat(tasks).catch(error=>{if(error.code==='ENOENT')return null;throw error;}))return;
  await ordinary(tasks,{directory:true});await pinnedBroker();
  // Only the pinned broker may reclaim its own journalled task identities.
  try{const result=await promisify(execFile)(options.toolchain.broker,['recover',tasks],{windowsHide:true,timeout:30000,maxBuffer:4*1024*1024});const proof=JSON.parse(result.stdout);const normal=value=>typeof value==='string'?path.resolve(value.startsWith(String.fromCharCode(92,92,63,92))?value.slice(4):value):null;if(proof.policyVersion!=='craftmine.windows.recovery-journal.v1'||normal(proof.tasksRoot)!==path.resolve(tasks)||normal(proof.journalRoot)!==path.join(path.resolve(tasks),'.recovery-journal')||proof.skippedCount!==0||!Array.isArray(proof.unreadable)||proof.unreadable.length!==0||!Array.isArray(proof.entries)||proof.reconciledCount!==proof.entries.length||proof.entries.some(record=>record.identityVerified!==true||record.journalRemoved!==true||record.taskRootRemoved!==true||record.profileDeleted!==true||!Array.isArray(record.skipped)||record.skipped.length!==0))fail('EXPORT_RECOVERY_INCOMPLETE');await fs.writeFile(path.join(root,'recovery.json'),result.stdout);}catch(error){await fs.writeFile(path.join(root,'recovery-error.json'),JSON.stringify({error:String(error),stdout:String(error.stdout??'')})).catch(()=>{});fail('EXPORT_RECOVERY_INCOMPLETE');}
 }
 async function broker(entry,projectRoot,files,source,inputHash){
  const {toolchain}=options;
  const identity=await pinnedBroker();await ordinary(toolchain.engineRoot,{directory:true});
  const taskId='win-'+randomUUID().replaceAll('-','').slice(0,16),sourceBinding={worldId:source.worldId,buildId:source.buildId,sourceRevision:source.sourceRevision,sourceDigest:hash(JSON.stringify(files))};
  const request={schemaVersion:1,requestId:taskId,taskId,operation:'exportWindows',projectRoot,tasksRoot:path.join(entry.root,'tasks'),engineRoot:toolchain.engineRoot,sourceBinding,inputHash};await fs.mkdir(request.tasksRoot);await writeNew(path.join(entry.root,'broker-request.json'),JSON.stringify(request));
  const response=await new Promise((resolve,reject)=>{const child=spawn(toolchain.broker,['run'],{windowsHide:true,stdio:['pipe','pipe','pipe']});entry.child=child;let stdout='',stderr='',ended=false;
   const timer=setTimeout(()=>child.stdin.end('cancel\n'),610000),killTimer=setTimeout(()=>child.kill(),640000);
   const finish=(error,value)=>{if(ended)return;ended=true;clearTimeout(timer);clearTimeout(killTimer);entry.child=null;error?reject(error):resolve(value);};
   child.on('error',error=>finish(error));child.stdout.on('data',bytes=>{stdout+=bytes;if(Buffer.byteLength(stdout)>4*1024*1024)child.kill();});child.stderr.on('data',bytes=>{stderr=(stderr+bytes).slice(-16384);});
   child.on('close',async code=>{try{await writeNew(path.join(entry.root,'broker-response.log'),stdout+'\n'+stderr);if(code!==0)fail('EXPORT_BROKER_FAILED');finish(null,JSON.parse(stdout.trim()));}catch(error){finish(error);}});child.stdin.on('error',()=>{});child.stdin.write(JSON.stringify(request)+'\n');if(entry.cancelled)child.stdin.end('cancel\n');
  });
  if(response.schemaVersion!==1||response.requestId!==taskId||response.taskId!==taskId||response.operation!=='exportWindows'||response.state!=='succeeded'||response.inputHash!==inputHash||JSON.stringify(response.sourceBinding)!==JSON.stringify(sourceBinding)||response.brokerSha256!==identity.sha256)fail('EXPORT_BROKER_RECEIPT_INVALID');
  if(response.policyVersion!==identity.policyVersion||response.processVerification?.verified!==true||response.networkPreflight?.verified!==true||response.cleanup?.verified!==true||response.recoveryJournal?.cleared!==true||response.resourceEnforcement?.enforced===true)fail('EXPORT_BOUNDARY_NOT_CONFIRMED');
  if(response.sourceSnapshotDigest!==hash(JSON.stringify(files))||JSON.stringify(response.sourceFiles)!==JSON.stringify(files))fail('EXPORT_SOURCE_CHANGED');
  if(response.logsRoot!==path.join(request.tasksRoot,taskId,'logs'))fail('EXPORT_LOG_ROOT_INVALID');const logEntry=response.logs?.find(file=>file.path==='task.log');if(!logEntry)fail('EXPORT_LOG_MISSING');const logBytes=await readBounded(path.join(response.logsRoot,'task.log'),4*1024*1024);if(logBytes.length!==logEntry.bytes||hash(logBytes)!==logEntry.sha256)fail('EXPORT_LOG_HASH_MISMATCH');verifyWindowsExportLog(logBytes.toString('utf8'));
  if(response.artifactsRoot!==path.join(request.tasksRoot,taskId,'artifacts'))fail('EXPORT_ARTIFACT_ROOT_INVALID');await ordinary(response.artifactsRoot,{directory:true});
  const artifacts=await inventory(response.artifactsRoot);if(JSON.stringify(artifacts)!==JSON.stringify(response.artifacts)||artifacts.length!==2||!artifacts.some(x=>x.path==='game.exe'&&x.bytes===109268480&&x.sha256===TEMPLATE_HASH)||!artifacts.some(x=>x.path==='game.pck'&&x.bytes>0))fail('EXPORT_ARTIFACT_INVALID');
  return response;
 }
 async function run(entry){
  let outputStage=null,outputParent=null;
  try{
   await selected(entry.worldId);const picked=await options.pickDirectory({worldId:entry.worldId});await selected(entry.worldId);if(!picked)return state(entry,'cancelled');outputParent=await ordinary(picked,{directory:true});
   state(entry,'saving');await options.checkpoint(entry.worldId);await selected(entry.worldId);
   const source=await options.domainCall('godotRuntime.exportSource',{worldId:entry.worldId});
   if(source?.format!=='craftmine.godot-export-source/1'||source.worldId!==entry.worldId||!['first-person','top-down','side-view'].includes(source.baseId)||!/^gbd-[a-f0-9]{64}$/.test(source.buildId)||!Array.isArray(source.files)||source.files.length>4096||!Number.isSafeInteger(source.sourceRevision)||source.sourceRevision<0||!Number.isSafeInteger(source.revision)||!source.snapshot||!source.sourceWorldId)fail('EXPORT_FORMAL_SOURCE_REQUIRED');
   if(source.snapshot.worldId!==source.worldId||source.snapshot.body?.worldId!==source.worldId||source.snapshot.baseId!==source.baseId||Buffer.byteLength(JSON.stringify(source.snapshot))>1048576)fail('EXPORT_PROGRESS_INVALID');
   await ordinary(options.stagingRoot,{directory:true});const freshRoot=operationRoot(entry.worldId,entry.operationId);await fs.mkdir(freshRoot);entry.root=freshRoot;await writeNew(path.join(entry.root,'intent.json'),JSON.stringify({operationId:entry.operationId,source}));
   const project=path.join(entry.root,'project'),original=path.join(entry.root,'original-source');await fs.mkdir(project);await fs.mkdir(original);let total=0;const names=new Set();
   state(entry,'reading-source');
   for(const file of source.files){const name=relative(file.path),alias=name.toLowerCase();if(names.has(alias)||!sha(file.sha256)||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>4*1024*1024||(total+=file.bytes)>64*1024*1024)fail('EXPORT_SOURCE_LIMIT');names.add(alias);if(entry.cancelled)fail('EXPORT_CANCELLED');const read=await options.domainCall('content.readFile',{worldId:source.worldId,rev:source.contentOid,path:name,encoding:'base64'});const bytes=Buffer.from(read.base64??'','base64');if(read.worldId!==source.worldId||read.rev!==source.contentOid||read.path!==name||bytes.toString('base64')!==read.base64||bytes.length!==file.bytes||hash(bytes)!==file.sha256)fail('EXPORT_SOURCE_HASH_MISMATCH');await writeNew(path.join(project,name),bytes);await writeNew(path.join(original,name),bytes);}
   if([...names].some(name=>name.startsWith('_craftmine_standalone/')))fail('EXPORT_HOST_PATH_CONFLICT');
   const projectFile=path.join(project,'project.godot');let config=(await readBounded(projectFile,4*1024*1024)).toString('utf8');if(!/^CraftmineRuntime\s*=\s*"\*res:\/\/craftmine_shared\/runtime_bridge\.gd"/m.test(config)||!/\[autoload\]/.test(config)||/^CraftmineStandalone\s*=/m.test(config))fail('EXPORT_MANAGED_RUNTIME_REQUIRED');
   config=config.replace('[autoload]','[autoload]\nCraftmineStandalone="*res://_craftmine_standalone/bootstrap.gd"');
   // Each export world/build has its own native save root, even when a source
   // copy still carries its original managed runtime identity.
   config=config.replace(/^config\/name\s*=.*$/m,'config/name='+JSON.stringify('Craftmine-'+hash(source.worldId+source.buildId).slice(0,24)));
   for(const [key,value]of [['config/use_custom_user_dir','true'],['config/custom_user_dir_name',JSON.stringify('craftmine-standalone-'+hash(source.worldId+source.buildId).slice(0,24))]]){const pattern=new RegExp('^'+key+'\\s*=.*$','m');config=pattern.test(config)?config.replace(pattern,()=>key+'='+value):config.replace('[application]',()=>'[application]\n'+key+'='+value);}
   await fs.writeFile(projectFile,config);
   const bootstrap=await readBounded(path.join(options.resourcesRoot,'shared/standalone_bootstrap.gd'),1024*1024),preset=await readBounded(path.join(options.resourcesRoot,'shared/windows-export.cfg'),65536);
   await writeNew(path.join(project,'_craftmine_standalone/bootstrap.gd'),bootstrap);await writeNew(path.join(project,'_craftmine_standalone/initial.json'),JSON.stringify({format:'craftmine.standalone-input/1',worldId:source.worldId,sourceWorldId:source.sourceWorldId,buildId:source.buildId,baseId:source.baseId,baseVersion:source.baseVersion,snapshot:source.snapshot}));await fs.writeFile(path.join(project,'export_presets.cfg'),preset);
   const files=await inventory(project),inputHash=hash(JSON.stringify({source,files}));state(entry,'exporting');const result=await broker(entry,project,files,source,inputHash);if(entry.cancelled)fail('EXPORT_CANCELLED');await selected(entry.worldId);
   const current=await options.domainCall('godotRuntime.exportSource',{worldId:entry.worldId});if(current.buildId!==source.buildId||current.contentOid!==source.contentOid)fail('EXPORT_FORMAL_VERSION_CHANGED');
   state(entry,'publishing');const freshOutput=path.join(outputParent,'.craftmine-export-'+entry.operationId);await fs.mkdir(freshOutput);outputStage=freshOutput;await writeNew(path.join(outputStage,'.craftmine-export.json'),JSON.stringify({operationId:entry.operationId,worldId:entry.worldId,inputHash}));
   for(const file of result.artifacts){const bytes=await readBounded(path.join(result.artifactsRoot,file.path),256*1024*1024);if(bytes.length!==file.bytes||hash(bytes)!==file.sha256)fail('EXPORT_ARTIFACT_CHANGED');await writeNew(path.join(outputStage,file.path),bytes);}
   for(const [name,digest] of [['GODOT_LICENSE.txt','b0435e3b3e4e55238f05f4b306f30524a1b2e20147810d436eaa554fa6855c80'],['GODOT_COPYRIGHT.txt','cb1980c88089573bcacd7221d777c689bb8bbd778799f24c27fca0fe5f774d6d']]){const bytes=await readBounded(path.join(options.resourcesRoot,'licenses',name),4*1024*1024);if(hash(bytes)!==digest)fail('EXPORT_NOTICE_HASH_MISMATCH');await writeNew(path.join(outputStage,name),bytes);}
   for(const file of files)await writeNew(path.join(outputStage,'source',file.path),await readBounded(path.join(project,file.path),4*1024*1024));
   const provenance={format:'craftmine.standalone-export/1',worldId:source.worldId,buildId:source.buildId,baseId:source.baseId,sourceWorldId:source.sourceWorldId,contentOid:source.contentOid,revision:source.revision,snapshotHash:hash(JSON.stringify(source.snapshot)),inputHash,originalFiles:source.files,exportFiles:files,artifacts:result.artifacts,brokerSha256:result.brokerSha256,rightsStatus:'local-preview-source-included; pending-authored-module-rights-not-cleared'};
   await writeNew(path.join(outputStage,'EXPORT.json'),JSON.stringify(provenance,null,2));await writeNew(path.join(outputStage,'README.txt'),'Double-click game.exe to play. Save with F5 or the Save button; closing the window saves before exit. Keep game.exe and game.pck together.\n\nLocal preview export. Original authored module rights remain pending; no redistribution permission is granted here. Complete export source is included in source/. Godot license and third-party copyright notices are included.\n');
   if(entry.cancelled)fail('EXPORT_CANCELLED');const final=path.join(outputParent,'Craftmine-'+source.baseId+'-'+entry.operationId);await ordinary(final,{directory:true,missing:true});const receipt={worldId:entry.worldId,operationId:entry.operationId,status:'completed',buildId:source.buildId,baseId:source.baseId,revision:source.revision,files:files.length,directoryName:path.basename(final),rightsStatus:'local-preview-source-included'};await writeNew(path.join(entry.root,'publishing.json'),JSON.stringify({output:final,provenanceHash:hash(JSON.stringify(provenance,null,2)),receipt}));await fs.rename(outputStage,final);outputStage=null;
   await writeNew(path.join(entry.root,'completed.json'),JSON.stringify({output:final,provenance,receipt})).catch(()=>{});entry.status='completed';entry.view=receipt;return receipt;
  }catch(error){if(outputStage)await removeOwned(outputStage,outputParent).catch(()=>{});const code=typeof error.code==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/.test(error.code)?error.code:'EXPORT_FAILED';if(entry.root)await fs.writeFile(path.join(entry.root,'failure.json'),JSON.stringify({code,message:String(error)})).catch(()=>{});state(entry,entry.cancelled?'cancelled':'failed',{error:{code}});throw Object.assign(Error(code),{code});}
 }
 return {
  async request(channel,input){if(!input||Object.keys(input).some(key=>!['worldId','operationId'].includes(key)))fail('INVALID_EXPORT_REQUEST');const worldId=id(input.worldId),operationId=id(input.operationId),key=worldId+':'+operationId;await selected(worldId);let entry=operations.get(key);
   if(channel==='godot.exportWindows.status')return entry?.view??await readReceipt(worldId,operationId)??{worldId,operationId,status:'unknown'};
   if(channel==='godot.exportWindows.cancel'){if(entry){entry.cancelled=true;entry.child?.stdin.end('cancel\n');}return {worldId,operationId,status:entry?.promise?'cancelling':entry?.status??'unknown'};}
   if(channel!=='godot.exportWindows')fail('UNKNOWN_EXPORT_CHANNEL');if(entry?.promise)return entry.promise;if(entry)return entry.view;if(locks.has(worldId))fail('EXPORT_WORLD_BUSY');if(operations.size>=64)fail('EXPORT_OPERATION_LIMIT');
   entry={worldId,operationId,status:'starting',cancelled:false};operations.set(key,entry);locks.add(worldId);state(entry,'starting');entry.promise=(async()=>{const persisted=await readReceipt(worldId,operationId);if(persisted){if(persisted.status==='interrupted')await recoverInterrupted(worldId,operationId);entry.view=persisted;entry.status=persisted.status;return persisted;}return run(entry);})().catch(error=>{if(entry.status==='starting')state(entry,'failed',{error:{code:error.code??'EXPORT_FAILED'}});throw error;}).finally(()=>{entry.promise=null;locks.delete(worldId);});return entry.promise;
  },
  async dispose(){disposed=true;for(const entry of operations.values()){entry.cancelled=true;entry.child?.stdin.end('cancel\n');}await Promise.allSettled([...operations.values()].map(entry=>entry.promise).filter(Boolean));},
 };
}
