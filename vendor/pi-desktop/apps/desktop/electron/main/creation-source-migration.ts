import {CREATION_PREVIEW_MIGRATIONS} from './creation-preview-upgrade.ts';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {CreationCapture} from './creation-target-service';
import {CREATION_MANAGED_MIGRATIONS,type ManagedCreationMigration} from './creation-managed-migrations.ts';
import {currentSceneObserverProfile,hasVersionedSceneObserverFiles,loadSceneObserverPins,needsBoundedMeshPickerUpgrade,creationPreviewUpgradePolicy} from './creation-observer-pins.ts';
import {MESH_PICKER_UPGRADE} from './creation-mesh-picker-upgrade.ts';
import {CREATION_GROUND_CURRENT_PINS,planCreationGroundUpgrade} from './creation-ground-upgrade.ts';
type Data=Record<string,any>;
type Context={projectId:string;sessionId:string;turnId:string};
export type CreationMigrationAdvance={format:'craftmine.creation-migration-advance/1';revision:number;manifestHash:string;formalBuildId:string;formalSourceRevision:number;formalManifestHash:string;migrationId:string;receiptRevision:number;receiptManifestHash:string};
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
// Exact preview.10/c1660f12 stock bytes; LF and CRLF are individually pinned.
export const CREATION_MIGRATION_FILES=[
 {source:'craftmine_shared/base_adapter.gd',resource:'shared/adapters/creation-sandbox.gd',old:['ea6140a3cde5fb368c62ad899840ddbb53e9259f44e67843ced7087d38c10418','a73c526c0d155e5c933ca5ff6a63ce005c9a3ddcc396fe7d061e7bbad69a433a']},
 {source:'craftmine_shared/runtime_bridge.gd',resource:'shared/runtime_bridge.gd',old:['faf11c86dc06006a37c65855cd48659107fbe19cc439d771aab45dbf866417a2','4424aa350e3c2bcd8783c73a1adcb2a455b9c1ca2c4b4200a886d4eaa6966ac1']},
 {source:'craftmine_shared/state_guard.gd',resource:'shared/state_guard.gd',old:['a1e524c8b45743244651b17c33c8ab916fad0b9f5809f9cbc3dc519a10562f20','9b3bb64b8515b0937e9e884999cfe10684d16d4a2b0af53140cc2a81dcc11293']},
 {source:'scripts/creation_world.gd',resource:'bases/creation-sandbox/scripts/creation_world.gd',old:['ef16e5d2e0e9ad8786c99875051a23b184fc815ee012e0a3167f8904a289946b','5564608d54448cc5c78ac34305328ee4dcd3d3c2ac71f1981079794f134e39a9']},
 {source:'scripts/scene_contract.gd',resource:'bases/creation-sandbox/scripts/scene_contract.gd',old:['a66041df090694a176cc8dcb0f08632a1157e2d5fdee40d884e9dc6558276915','888a0be47e7369ef504148ce08fdbd88df71ac39c921e8d9f7a138922ab0f739']},
] as const;
const fail=(reason:string):never=>{throw Object.assign(Error(reason),{errorCode:reason});};
export function creationProjectSelectorsSafe(text:string){
 let section='',runtime=0,selector=0;
 for(const raw of text.split(/\r?\n/)){
  const line=raw.trim();if(!line||line.startsWith(';')||line.startsWith('#'))continue;
  if(/^\[.*\]$/.test(line)){section=line;continue;}
  if(section==='[autoload]'&&/^CraftmineRuntime\s*=/.test(line)){if(line!=='CraftmineRuntime="*res://craftmine_shared/runtime_bridge.gd"')return false;runtime++;}
  if(section==='[craftmine]'&&/^runtime\/adapter\s*=/.test(line)){if(line!=='runtime/adapter="res://craftmine_shared/base_adapter.gd"')return false;selector++;}
 }
 return runtime===1&&selector===1;
}
type Dependencies={directory:string;resourcesRoot:string;domain:(method:string,args:Data)=>Promise<any>;assertActive:(context:Context,capture:CreationCapture)=>Promise<void>;recordAdvance:(context:Context,capture:CreationCapture,advance:CreationMigrationAdvance)=>void;
 // Trusted construction-time seam for deterministic tests; never a tool argument.
 managedMigrations?:readonly ManagedCreationMigration[];};
/** Host-only stock upgrade. The formal world is never changed by this service. */
export function createCreationSourceMigration(deps:Dependencies){
 const compatibility=deps.managedMigrations??[MESH_PICKER_UPGRADE,...CREATION_PREVIEW_MIGRATIONS,...CREATION_MANAGED_MIGRATIONS];
 const safePath=(value:string)=>typeof value==='string'&&value.length<=240&&/^[a-zA-Z0-9_./-]+$/.test(value)&&!value.startsWith('/')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
 if(compatibility.length>32||new Set(compatibility.map(p=>p.id)).size!==compatibility.length)fail('CREATION_MIGRATION_POLICY_INVALID');
 for(const policy of compatibility){
  if(!/^[a-z0-9-]{1,96}$/.test(policy.id)||!policy.files.length||policy.files.length>16||new Set(policy.files.map(f=>f.source)).size!==policy.files.length)fail('CREATION_MIGRATION_POLICY_INVALID');
  for(const file of policy.files)if(!safePath(file.source)||!file.source.startsWith('craftmine_shared/')||!safePath(file.resource)||!file.resource.startsWith('shared/')||!file.from.length||!file.to.length||file.from.some(h=>h!==null&&!/^[a-f0-9]{64}$/.test(h))||file.to.some(h=>!/^[a-f0-9]{64}$/.test(h)))fail('CREATION_MIGRATION_POLICY_INVALID');
 }
 const write=(file:string,value:any)=>{fs.mkdirSync(deps.directory,{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(value));fs.renameSync(tmp,file);}finally{try{fs.unlinkSync(tmp);}catch{}}};
 const sameFiles=(a:Data[],b:Data[])=>a.length===b.length&&new Set(a.map(f=>f.path)).size===a.length&&a.every(file=>b.some(other=>other.path===file.path&&other.sha256===file.sha256&&other.bytes===file.bytes));
 async function readFormal(worldId:string,formal:Data,name:string){
  const meta=formal.files.find((f:Data)=>f.path===name);if(!meta||meta.bytes>120000)fail('CREATION_MIGRATION_NEEDED');
  const file=await deps.domain('content.readFile',{worldId,rev:formal.contentOid,path:name,encoding:'text'});
  if(file?.worldId!==worldId||file.rev!==formal.contentOid||file.path!==name||typeof file.text!=='string'||file.bytes!==meta.bytes||file.sha256!==meta.sha256||Buffer.byteLength(file.text)!==meta.bytes||sha(file.text)!==meta.sha256)fail('CREATION_MIGRATION_SOURCE_MISMATCH');
  return file.text as string;
 }
 async function currentIndex(context:Context,worldId:string){
  let offset:number|null=0,first:any;const files:Data[]=[];
  do{const result=await deps.domain('godotProject.index',{context,worldId,offset,limit:32});first??=result;if(result.worldId!==worldId||result.baseId!=='creation-sandbox'||result.revision!==first.revision||result.manifestHash!==first.manifestHash||!Array.isArray(result.files)||result.files.length>32)fail('CREATION_MIGRATION_SOURCE_MISMATCH');files.push(...result.files);const next=result.nextOffset;if(next!=null&&(!Number.isSafeInteger(next)||next<=offset||next>512))fail('CREATION_MIGRATION_SOURCE_MISMATCH');offset=next;}while(offset!=null);
  if(files.length>512||new Set(files.map(file=>file.path)).size!==files.length)fail('CREATION_MIGRATION_SOURCE_MISMATCH');return {...first,files};
 }
 return async(context:Context,capture:CreationCapture):Promise<CreationMigrationAdvance|null>=>{
  await deps.assertActive(context,capture);const worldId=capture.worldId;
  const formal=await deps.domain('godotRuntime.exportSource',{worldId});
  if(formal?.worldId!==worldId||formal.buildId!==capture.buildId||formal.baseId!=='creation-sandbox'||formal.sourceRevision!==capture.sourceRevision||!Array.isArray(formal.files)||typeof formal.contentOid!=='string')fail('CREATION_MIGRATION_FORMAL_CHANGED');
  const previewPins=fs.existsSync(path.join(deps.resourcesRoot,'shared/runtime_bridge_engine_v1.gd'))?loadSceneObserverPins(deps.resourcesRoot):undefined;
  const previewPolicy=creationPreviewUpgradePolicy(formal.files,previewPins);
  let versionedPickerUpgrade=false;const versionedPreviewUpgrade=previewPolicy!==null;
  if(hasVersionedSceneObserverFiles(formal.files)){
    const pins=loadSceneObserverPins(deps.resourcesRoot),profile=currentSceneObserverProfile(formal.files,pins);
    // Never downgrade a mixed or incomplete versioned cohort through a legacy
    // migration, including a legacy adapter accompanied by modern helpers.
    if(!profile||profile==='legacy')fail('CREATION_MIGRATION_NEEDED');
    // Current controller cohorts are not inputs to the legacy stock upgrader.
    // Their complete source authority uses the same pins as live observations.
    if(!creationProjectSelectorsSafe(await readFormal(worldId,formal,'project.godot')))fail('CREATION_MIGRATION_NEEDED');
    await deps.assertActive(context,capture);
    // No migration means no source write: an ordinary unadopted draft remains
    // repairable through the normal source pin/check flow, as for legacy no-op.
    versionedPickerUpgrade=needsBoundedMeshPickerUpgrade(formal.files,pins);
    if(!versionedPickerUpgrade&&!versionedPreviewUpgrade)return null;
  }
  const resources=new Map<string,{text:string;sha256:string;bytes:number;accepted:string[]}>();
  const resource=(name:string)=>{let value=resources.get(name);if(!value){const text=fs.readFileSync(path.join(deps.resourcesRoot,name),'utf8').replace(/\r\n/g,'\n');if(Buffer.byteLength(text)>120000)fail('CREATION_MIGRATION_RESOURCE_INVALID');value={text,sha256:sha(text),bytes:Buffer.byteLength(text),accepted:[sha(text),sha(text.replace(/\n/g,'\r\n'))]};resources.set(name,value);}return value;};
  const targets=CREATION_MIGRATION_FILES.map(entry=>({...entry,...resource(entry.resource)}));
  const operations:Data[]=[];
  let managed:ManagedCreationMigration|undefined;
  let destination:ManagedCreationMigration|undefined;
  for(const policy of compatibility){
    if((versionedPickerUpgrade||versionedPreviewUpgrade)&&policy.id!==(versionedPickerUpgrade?MESH_PICKER_UPGRADE.id:previewPolicy!.id))continue;
    if(!versionedPickerUpgrade&&policy.id===MESH_PICKER_UPGRADE.id)continue;
    if(!versionedPreviewUpgrade&&CREATION_PREVIEW_MIGRATIONS.some(p=>p.id===policy.id))continue;
    const candidates=policy.files.map(entry=>({...entry,...resource(entry.resource),actual:formal.files.find((f:Data)=>f.path===entry.source)}));
    // Coupled legacy upgrades may need missing helpers. A newer complete-cohort
    // policy must not hide an older reviewed destination that allows absence.
    const helpers=candidates.filter(entry=>!targets.some(target=>target.source===entry.source));
    if(candidates.every(entry=>entry.to.includes(entry.sha256))&&helpers.every(entry=>entry.actual?(entry.to.includes(entry.actual.sha256)||entry.from.includes(entry.actual.sha256)):entry.from.includes(null)))destination??=policy;
    if(!candidates.every(entry=>entry.to.includes(entry.sha256)&&(!entry.actual||entry.to.includes(entry.actual.sha256)||entry.from.includes(entry.actual.sha256))))continue;
    if(!candidates.every(entry=>entry.actual!==undefined||entry.from.includes(null)))continue;
    const planned=candidates.filter(entry=>!entry.actual||!entry.to.includes(entry.actual.sha256)).map(entry=>({op:'put',path:entry.source,text:entry.text,expectedHash:entry.actual?.sha256??null}));
    if(!planned.length)continue;
    // A compatibility record upgrades only its named files. Other protected
    // files must already match the installed resource; ordinary sources differ freely.
    if(!versionedPickerUpgrade&&!versionedPreviewUpgrade&&!targets.slice(0,3).every(target=>policy.files.some(f=>f.source===target.source)||target.accepted.includes(formal.files.find((f:Data)=>f.path===target.source)?.sha256)))continue;
    managed=policy;operations.push(...planned);break;
  }
  if((versionedPickerUpgrade||versionedPreviewUpgrade)&&!managed)fail('CREATION_MIGRATION_NEEDED');
  if(!managed){
  for(const target of targets.slice(0,3)){const file=formal.files.find((f:Data)=>f.path===target.source);if(!file)fail('CREATION_MIGRATION_NEEDED');if(target.accepted.includes(file.sha256))continue;if(!(target.old as readonly string[]).includes(file.sha256))fail('CREATION_MIGRATION_NEEDED');operations.push({op:'put',path:target.source,text:target.text,expectedHash:file.sha256});}
  const protectedUpgrade=operations.length>0,mutableOperations:Data[]=[];let customizedMutable=false;
  for(const target of targets.slice(3)){
    const file=formal.files.find((f:Data)=>f.path===target.source);
    if(file&&target.accepted.includes(file.sha256))continue;
    if(!file||!(target.old as readonly string[]).includes(file.sha256)){if(protectedUpgrade)fail('CREATION_MIGRATION_NEEDED');customizedMutable=true;continue;}
    mutableOperations.push({op:'put',path:target.source,text:target.text,expectedHash:file.sha256});
  }
  // With the protected observer already current, authored world/contract code
  // remains editable. Avoid changing its coupled stock counterpart implicitly.
  if(!customizedMutable)operations.push(...mutableOperations);
  // Legacy coupled upgrades still need explicitly declared destination helpers.
  // Their absence is an allowed input only when the reviewed record says null.
  for(const entry of destination?.files??[]){
    if(targets.some(target=>target.source===entry.source))continue;
    const file=formal.files.find((f:Data)=>f.path===entry.source),target=resource(entry.resource);
    if(file&&entry.to.includes(file.sha256))continue;
    if(!entry.from.includes(file?.sha256??null))fail('CREATION_MIGRATION_NEEDED');
    operations.push({op:'put',path:entry.source,text:target.text,expectedHash:file?.sha256??null});
  }
  }
  if(!operations.length)return null;
  if(!creationProjectSelectorsSafe(await readFormal(worldId,formal,'project.godot')))fail('CREATION_MIGRATION_NEEDED');
  const legacyHelpers=destination?.files.some(entry=>!targets.some(target=>target.source===entry.source));
  const migrationIdentity=managed?[worldId,capture.buildId,'managed-compatible',managed]:[worldId,capture.buildId,targets.map(t=>[t.source,t.sha256]),...(legacyHelpers?[destination]:[])];
  const migrationId=sha(JSON.stringify(migrationIdentity)),recordPath=path.join(deps.directory,migrationId+'.json');
  let record:any=null;if(fs.existsSync(recordPath)){if(fs.statSync(recordPath).size>1024*1024)fail('CREATION_MIGRATION_RECORD_INVALID');record=JSON.parse(fs.readFileSync(recordPath,'utf8'));if(record?.format!=='craftmine.creation-source-migration/1'||record.worldId!==worldId||record.migrationId!==migrationId||record.formalBuildId!==capture.buildId)fail('CREATION_MIGRATION_RECORD_INVALID');}
  const source=await currentIndex(context,worldId);await deps.assertActive(context,capture);
  // Maintenance intentionally advances formal on an isolated branch while
  // retaining the player's main draft. Requiring both entire trees to match
  // would make the next ordinary request impossible. Merge only trusted file
  // operations into the current draft, with a CAS for every affected path.
  const protectedPaths=new Set([...targets.slice(0,3).map(entry=>entry.source),...compatibility.flatMap(policy=>policy.files.map(entry=>entry.source))]);
  for(const name of [...protectedPaths,'project.godot']){
    if(operations.some(op=>op.path===name))continue;
    const before=formal.files.find((file:Data)=>file.path===name),draft=source.files.find((file:Data)=>file.path===name);
    if(before?.sha256!==draft?.sha256||before?.bytes!==draft?.bytes)fail('CREATION_MIGRATION_DRAFT_CONFLICT');
  }
  // Carry an already-adopted stock lighting repair into an older stock draft.
  // This is exact released-file recognition, never a text/snippet replacement
  // in authored gameplay code. Other draft files (including pets) are retained.
  const formalGround=formal.files.find((file:Data)=>file.path==='scripts/creation_world.gd');
  if(formalGround&&CREATION_GROUND_CURRENT_PINS.includes(formalGround.sha256)&&!operations.some(op=>op.path===formalGround.path)){
    const ground=planCreationGroundUpgrade({baseId:'creation-sandbox',formalFiles:source.files,draftFiles:source.files,resourcesRoot:deps.resourcesRoot});
    if(ground.status==='planned')operations.push(...ground.operations);
  }
  const expected=source.files.map((file:Data)=>{
    const operation=operations.find(op=>op.path===file.path);
    if(!operation)return file;
    const destinationHash=sha(operation.text),destinationBytes=Buffer.byteLength(operation.text);
    if(file.sha256!==operation.expectedHash&&(file.sha256!==destinationHash||file.bytes!==destinationBytes))fail('CREATION_MIGRATION_DRAFT_CONFLICT');
    return {...file,sha256:destinationHash,bytes:destinationBytes};
  });
  for(const op of operations)if(!source.files.some((file:Data)=>file.path===op.path)){
    if(op.expectedHash!==null)fail('CREATION_MIGRATION_DRAFT_CONFLICT');
    expected.push({path:op.path,sha256:sha(op.text),bytes:Buffer.byteLength(op.text)});
  }
  // A standalone observer-upgrade action does not authorize adopting unrelated
  // player draft work. Only an ordinary creative request continues that draft.
  if(capture.observerUpgradeOnly){
    const formalExpected=formal.files.map((file:Data)=>{const op=operations.find(operation=>operation.path===file.path);return op?{...file,sha256:sha(op.text),bytes:Buffer.byteLength(op.text)}:file;});
    for(const op of operations)if(!formal.files.some((file:Data)=>file.path===op.path))formalExpected.push({path:op.path,sha256:sha(op.text),bytes:Buffer.byteLength(op.text)});
    if(!sameFiles(expected,formalExpected))fail('CREATION_MIGRATION_DRAFT_CONFLICT');
  }
  const receiptLookup=async()=>record?deps.domain('godotProject.receipt',{binding:record.binding,worldId,toolCallId:record.request.toolCallId,method:'godotProject.patch',request:record.request}):null;
  let receipt=await receiptLookup();
  if(sameFiles(source.files,expected)){
    if(!receipt)fail('CREATION_MIGRATION_RECEIPT_REQUIRED');
  }else{
    // An atomic migration cannot have partly appeared without its original
    // receipt. Every write still starts at its pinned source hash.
    if(operations.some(op=>source.files.find((file:Data)=>file.path===op.path)?.sha256!==op.expectedHash&&!(op.expectedHash===null&&!source.files.some((file:Data)=>file.path===op.path))))fail('CREATION_MIGRATION_DRAFT_CONFLICT');
    if(receipt)fail('CREATION_MIGRATION_RECEIPT_SOURCE_CHANGED');
    const task=await deps.domain('task.context',{context});if(!task?.binding||task.binding.taskId!==source.currentTaskId)fail('CREATION_MIGRATION_TASK_CHANGED');
    const toolCallId='host-stock-upgrade-'+migrationId;
    const request:Data={context,worldId,toolCallId,revision:source.revision,manifestHash:source.manifestHash,operations};
    if(source.content){const c=source.content;if(c.branchId!=='main'||typeof c.repoId!=='string'||!/^[a-f0-9]{40,64}$/.test(c.contentOid))fail('CREATION_MIGRATION_SOURCE_MISMATCH');request.operation={operationId:toolCallId,worldId,repoId:c.repoId,branchId:'main',expectedHeadOid:c.contentOid,expectedAppliedOid:null,expectedProgressRevision:null};}
    record={format:'craftmine.creation-source-migration/1',worldId,migrationId,formalBuildId:capture.buildId,sourceBaseline:{revision:source.revision,manifestHash:source.manifestHash,content:source.content??null,files:source.files},expectedFiles:expected,...(destination?{migrationMode:managed?'managed-compatible':'legacy-coupled',compatibilityId:(managed??destination).id,compatibility:managed??destination}:{}),binding:task.binding,request};write(recordPath,record);
    try{await deps.assertActive(context,capture);receipt=await deps.domain('godotProject.patch',request);}catch(error){receipt=await receiptLookup();if(!receipt)throw error;}
  }
  const after=await currentIndex(context,worldId);await deps.assertActive(context,capture);
  if(!sameFiles(after.files,expected)||!receipt||!Number.isSafeInteger(receipt.revision)||!/^[a-f0-9]{64}$/.test(receipt.manifestHash))fail('CREATION_MIGRATION_SOURCE_MISMATCH');
  const advance:CreationMigrationAdvance={format:'craftmine.creation-migration-advance/1',revision:after.revision,manifestHash:after.manifestHash,formalBuildId:capture.buildId,formalSourceRevision:capture.sourceRevision,formalManifestHash:capture.manifestHash,migrationId,receiptRevision:receipt.revision,receiptManifestHash:receipt.manifestHash};
  write(recordPath,{...record,receipt,advance});deps.recordAdvance(context,capture,advance);return advance;
 };
}
