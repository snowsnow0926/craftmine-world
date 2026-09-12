'use strict';
const {createHash}=require('node:crypto');
const PROTECTED_CREATION_FILES=Object.freeze(['craftmine_shared/base_adapter.gd','craftmine_shared/runtime_bridge.gd','craftmine_shared/state_guard.gd','craftmine_shared/headless_play_action.gd','craftmine_shared/scene_mesh_picker.gd']);
const CONTROLLER_PROTECTED_FILES=Object.freeze([...PROTECTED_CREATION_FILES,'craftmine_shared/base_adapter_legacy.gd','craftmine_shared/controller_evidence.gd','craftmine_shared/scene_mesh_picker_v2.gd','scripts/reused/player_controller.gd','scripts/reused/camera_rig.gd']);
const COLLISION_PROTECTED_FILES=Object.freeze([...CONTROLLER_PROTECTED_FILES,'craftmine_shared/base_adapter_controller_v1.gd','craftmine_shared/progress_collision.gd']);
// Reviewed historical cohort, never selected by a request argument or file count.
// Only exact LF/CRLF bytes from this commit are admitted; no runtime git access.
const HISTORICAL_CREATION_PROFILE=Object.freeze({
 id:'creation-observer-940c5a84',sourceCommit:'940c5a84702a5ac85cbaa2de583b62ad0a5cbab2',
 files:Object.freeze([
  {path:'craftmine_shared/base_adapter.gd',sourcePath:'desktop/godot/shared/adapters/creation-sandbox.gd',variants:[
   {sha256:'edf0f6efe5ed9381f7fca2b7365cbba6062463a4ebb489191086e734af3765ee',bytes:9456},
   {sha256:'b381b17a4c26176fa257a843fcd5d11e48ce0ea16252961c7d8f619ba14962c5',bytes:9667}]},
  {path:'craftmine_shared/runtime_bridge.gd',sourcePath:'desktop/godot/shared/runtime_bridge.gd',variants:[
   {sha256:'faf11c86dc06006a37c65855cd48659107fbe19cc439d771aab45dbf866417a2',bytes:6958},
   {sha256:'4424aa350e3c2bcd8783c73a1adcb2a455b9c1ca2c4b4200a886d4eaa6966ac1',bytes:7104}]},
  {path:'craftmine_shared/state_guard.gd',sourcePath:'desktop/godot/shared/state_guard.gd',variants:[
   {sha256:'a1e524c8b45743244651b17c33c8ab916fad0b9f5809f9cbc3dc519a10562f20',bytes:1759},
   {sha256:'9b3bb64b8515b0937e9e884999cfe10684d16d4a2b0af53140cc2a81dcc11293',bytes:1800}]},
 ].map(file=>Object.freeze({...file,variants:Object.freeze(file.variants.map(Object.freeze))}))),
 absent:Object.freeze(PROTECTED_CREATION_FILES.slice(3)),
});
const digest=(value,algorithm='sha256')=>createHash(algorithm).update(value).digest('hex');
const fail=code=>{throw Error(code);};
const utf8=new TextDecoder('utf-8',{fatal:true});
const reservedAlias=(path,name)=>typeof path==='string'&&(path.toLowerCase()===name||path.toLowerCase().startsWith(name+'.')||path.toLowerCase()===name.slice(0,-3)+'.gdc'||path.toLowerCase().startsWith(name.slice(0,-3)+'.gdc.'));

function sourceContract(sourceFiles,pack){
 const files=Array.isArray(sourceFiles)?sourceFiles:[];
 const old=HISTORICAL_CREATION_PROFILE;
 const historical=old.files.every(expected=>{
  const found=files.filter(file=>file?.path===expected.path);
  return found.length===1&&expected.variants.some(variant=>variant.sha256===found[0].sha256&&variant.bytes===found[0].bytes);
 });
 if(!historical){
  const hasCollision=files.some(file=>['craftmine_shared/base_adapter_controller_v1.gd','craftmine_shared/progress_collision.gd'].includes(file?.path));
  if(hasCollision){
   if(!COLLISION_PROTECTED_FILES.every(name=>files.filter(file=>file?.path===name).length===1))fail('CREATION_PACK_COLLISION_PROFILE_INCOMPLETE');
   return {names:COLLISION_PROTECTED_FILES,proof:{profileId:'creation-player-collision/1',historical:false}};
  }
  const hasController=files.some(file=>['craftmine_shared/base_adapter_legacy.gd','craftmine_shared/controller_evidence.gd','craftmine_shared/scene_mesh_picker_v2.gd'].includes(file?.path));
  if(hasController){
   if(!CONTROLLER_PROTECTED_FILES.every(name=>files.filter(file=>file?.path===name).length===1))fail('CREATION_PACK_CONTROLLER_PROFILE_INCOMPLETE');
   return {names:CONTROLLER_PROTECTED_FILES,proof:{profileId:'creation-fixed-controller/1',historical:false}};
  }
  return {names:PROTECTED_CREATION_FILES,proof:{profileId:'current-source-pins',historical:false}};
 }
 // Do not accept a complete old sampler plus newly introduced helpers, even
 // when those helpers would make the ordinary five-file source list complete.
 if([...old.absent,'craftmine_shared/base_adapter_legacy.gd','craftmine_shared/controller_evidence.gd','craftmine_shared/scene_mesh_picker_v2.gd','craftmine_shared/base_adapter_controller_v1.gd','craftmine_shared/progress_collision.gd'].some(name=>files.some(file=>reservedAlias(file?.path,name))||[...pack.files.keys()].some(path=>reservedAlias(path,name))))fail('CREATION_PACK_HISTORICAL_PROFILE_MIXED');
 for(const expected of old.files){
  if(files.some(file=>file?.path!==expected.path&&reservedAlias(file?.path,expected.path))||[...pack.files.keys()].some(path=>path!==expected.path&&reservedAlias(path,expected.path)))fail('CREATION_PACK_PROTECTED_ALIAS');
 }
 return {names:old.files.map(file=>file.path),proof:{profileId:old.id,sourceCommit:old.sourceCommit,historical:true,
  sceneObjectTarget:false,headlessPlayAction:false,requiresNormalMigration:true}};
}

/** Pinned Godot 4.7.2 standalone, unencrypted PCK v4. Never extracts or runs it. */
function readPck4(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length<112||buffer.length>256*1024*1024)fail('CREATION_PACK_SIZE_INVALID');
 const span=(at,size)=>{if(!Number.isSafeInteger(at)||!Number.isSafeInteger(size)||at<0||size<0||at+size>buffer.length)fail('CREATION_PACK_RANGE_INVALID');return buffer.subarray(at,at+size);};
 const u32=at=>{span(at,4);return buffer.readUInt32LE(at);};
 const u64=at=>{span(at,8);const value=buffer.readBigUInt64LE(at);if(value>BigInt(Number.MAX_SAFE_INTEGER))fail('CREATION_PACK_RANGE_INVALID');return Number(value);};
 if(u32(0)!==0x43504447||u32(4)!==4||u32(8)!==4||u32(12)!==7||u32(16)!==2||u32(20)!==2)fail('CREATION_PACK_FORMAT_UNSUPPORTED');
 const base=u64(24),directory=u64(32);if(base<112||base>directory||directory>=buffer.length)fail('CREATION_PACK_RANGE_INVALID');
 let cursor=directory;const count=u32(cursor);cursor+=4;if(count<1||count>8192)fail('CREATION_PACK_FILE_LIMIT');
 const files=new Map(),aliases=new Set();
 for(let i=0;i<count;i++){
  const length=u32(cursor);cursor+=4;if(length<1||length>4096)fail('CREATION_PACK_PATH_INVALID');
  const raw=span(cursor,length);cursor+=length;const zero=raw.indexOf(0),end=zero<0?raw.length:zero;
  if(raw.length-end>3||raw.subarray(end).some(byte=>byte!==0))fail('CREATION_PACK_PATH_INVALID');
  let name;try{name=utf8.decode(raw.subarray(0,end));}catch{fail('CREATION_PACK_PATH_INVALID');}
  if(!name||/[\\:\x00-\x1f]/.test(name)||name.startsWith('/')||name.split('/').some(part=>!part||part==='.'||part==='..')||aliases.has(name.toLowerCase()))fail('CREATION_PACK_PATH_ALIAS');
  aliases.add(name.toLowerCase());
  const offset=base+u64(cursor),size=u64(cursor+8),md5=span(cursor+16,16).toString('hex'),flags=u32(cursor+32);cursor+=36;
  if(flags!==0||offset<base||offset+size>directory)fail('CREATION_PACK_ENTRY_UNSUPPORTED');
  const bytes=span(offset,size);if(digest(bytes,'md5')!==md5)fail('CREATION_PACK_ENTRY_DIGEST_MISMATCH');
  files.set(name,{path:name,offset,bytes:size,sha256:digest(bytes),data:bytes});
 }
 if(cursor!==buffer.length)fail('CREATION_PACK_DIRECTORY_TRAILING_DATA');
 return {files,base,directory};
}

/** ECFG properties have explicit value lengths, so unrelated variants need no decoding. */
function readCreationProjectSelectors(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length<8||buffer.length>4*1024*1024||buffer.subarray(0,4).toString()!=='ECFG')fail('CREATION_PACK_PROJECT_INVALID');
 let cursor=8;const count=buffer.readUInt32LE(4);if(count<1||count>8192)fail('CREATION_PACK_PROJECT_INVALID');
 const take=size=>{if(!Number.isSafeInteger(size)||size<0||cursor+size>buffer.length)fail('CREATION_PACK_PROJECT_INVALID');const value=buffer.subarray(cursor,cursor+size);cursor+=size;return value;};
 const number=()=>take(4).readUInt32LE(0),names=new Set(),selected={};
 const expected={'autoload/CraftmineRuntime':'*res://craftmine_shared/runtime_bridge.gd','craftmine/runtime/adapter':'res://craftmine_shared/base_adapter.gd'};
 for(let i=0;i<count;i++){
  const length=number();if(length<1||length>4096)fail('CREATION_PACK_PROJECT_INVALID');
  let key;try{key=utf8.decode(take(length));}catch{fail('CREATION_PACK_PROJECT_INVALID');}
  if(/[\x00-\x1f]/.test(key)||names.has(key))fail('CREATION_PACK_PROJECT_ALIAS');names.add(key);
  const size=number();if(size<4||size>4*1024*1024)fail('CREATION_PACK_PROJECT_INVALID');const value=take(size);
  for(const selector of Object.keys(expected))if(key!==selector&&(key.toLowerCase()===selector.toLowerCase()||key.startsWith(selector+'.')))fail('CREATION_PACK_SELECTOR_OVERRIDE');
  if(!Object.hasOwn(expected,key))continue;
  if(size<8||value.readUInt32LE(0)!==4)fail('CREATION_PACK_SELECTOR_INVALID');
  const bytes=value.readUInt32LE(4);if(bytes>4096||8+bytes>size||size-(8+bytes)>3||value.subarray(8+bytes).some(byte=>byte!==0))fail('CREATION_PACK_SELECTOR_INVALID');
  let text;try{text=utf8.decode(value.subarray(8,8+bytes));}catch{fail('CREATION_PACK_SELECTOR_INVALID');}
  if(text!==expected[key])fail('CREATION_PACK_SELECTOR_MISMATCH');selected[key]=text;
 }
 if(cursor!==buffer.length||Object.keys(selected).length!==2)fail('CREATION_PACK_SELECTOR_MISSING');
 return selected;
}

/** Claims were pinned by core before export; @tool cannot rewrite the actual packed sampler. */
function verifyCreationPack(buffer,sourceFiles){
 const pack=readPck4(buffer),verified=[],contract=sourceContract(sourceFiles,pack);
 for(const name of contract.names){
  const expected=Array.isArray(sourceFiles)?sourceFiles.filter(file=>file.path===name):[];
  if(expected.length!==1||!/^[a-f0-9]{64}$/.test(expected[0].sha256)||!Number.isSafeInteger(expected[0].bytes))fail('CREATION_PACK_SOURCE_PIN_MISSING');
  for(const path of pack.files.keys())if(path!==name&&(path.toLowerCase()===name||path.toLowerCase().startsWith(name+'.')||path.toLowerCase()===name.slice(0,-3)+'.gdc'))fail('CREATION_PACK_PROTECTED_ALIAS');
  const file=pack.files.get(name);if(!file||file.bytes!==expected[0].bytes||file.sha256!==expected[0].sha256)fail('CREATION_PACK_PROTECTED_MISMATCH:'+name);
  verified.push({path:name,bytes:file.bytes,sha256:file.sha256});
 }
 if(pack.files.has('override.cfg'))fail('CREATION_PACK_SELECTOR_OVERRIDE');
 const project=pack.files.get('project.binary');if(!project)fail('CREATION_PACK_PROJECT_MISSING');
 const selectors=readCreationProjectSelectors(project.data);
 return {format:'craftmine.creation-pack-proof/1',packSha256:digest(buffer),packBytes:buffer.length,engineVersion:'4.7.2-stable',packFormat:4,files:verified,project:{sha256:project.sha256,selectors},observerContract:contract.proof};
}
module.exports={PROTECTED_CREATION_FILES,CONTROLLER_PROTECTED_FILES,COLLISION_PROTECTED_FILES,HISTORICAL_CREATION_PROFILE,readPck4,readCreationProjectSelectors,verifyCreationPack};
