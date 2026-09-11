import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url),{PROTECTED_CREATION_FILES,readPck4,readCreationProjectSelectors,verifyCreationPack}=require('../plugins/craftmine-world/godot-creation-pack.cjs');
const hash=(value,algorithm='sha256')=>createHash(algorithm).update(value).digest(),u32=value=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return b;},u64=value=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(value));return b;};
const string=value=>{const raw=Buffer.from(value),pad=Buffer.alloc((4-raw.length%4)%4);return Buffer.concat([u32(4),u32(raw.length),raw,pad]);};
const selectors=[['autoload/CraftmineRuntime','*res://craftmine_shared/runtime_bridge.gd'],['craftmine/runtime/adapter','res://craftmine_shared/base_adapter.gd']];
function project(entries=selectors){return Buffer.concat([Buffer.from('ECFG'),u32(entries.length),...entries.flatMap(([key,value])=>{const bytes=Buffer.isBuffer(value)?value:string(value);return [u32(Buffer.byteLength(key)),Buffer.from(key),u32(bytes.length),bytes];})]);}
function pack(entries){const header=Buffer.alloc(112);for(const [offset,value]of [[0,0x43504447],[4,4],[8,4],[12,7],[16,2],[20,2]])header.writeUInt32LE(value,offset);header.writeBigUInt64LE(112n,24);let offset=0;const chunks=[],directory=[];for(const item of entries){const bytes=Buffer.from(item.data),name=Buffer.from(item.path),padded=Buffer.concat([name,Buffer.alloc((4-name.length%4)%4)]);chunks.push(bytes);directory.push(Buffer.concat([u32(padded.length),padded,u64(offset),u64(bytes.length),hash(bytes,'md5'),u32(item.flags??0)]));offset+=bytes.length;}header.writeBigUInt64LE(BigInt(112+offset),32);return Buffer.concat([header,...chunks,u32(entries.length),...directory]);}
const files=()=>[...PROTECTED_CREATION_FILES.map(path=>({path,data:'extends RefCounted\n# '+path+'\n'})),{path:'project.binary',data:project()}];
const pins=entries=>entries.filter(e=>PROTECTED_CREATION_FILES.includes(e.path)).map(e=>({path:e.path,bytes:Buffer.byteLength(e.data),sha256:hash(e.data).toString('hex')}));
test('PCK independently binds actual packed scripts and compiled selectors to claimed source bytes',()=>{const entries=files(),result=verifyCreationPack(pack(entries),pins(entries));assert.equal(result.files.length,PROTECTED_CREATION_FILES.length);assert.equal(result.project.selectors['craftmine/runtime/adapter'],selectors[1][1]);});
test('exported script changes fail even with a freshly valid MD5 and unchanged source pin list',()=>{const entries=files(),expected=pins(entries);entries[0].data+='\n# tool changed this only in export copy\n';assert.throws(()=>verifyCreationPack(pack(entries),expected),/PROTECTED_MISMATCH/);});
test('compiled selector changes fail even when all protected scripts match source',()=>{const entries=files();entries.at(-1).data=project([[selectors[0][0],'*res://forged.gd'],selectors[1]]);assert.throws(()=>verifyCreationPack(pack(entries),pins(entries)),/SELECTOR_MISMATCH/);});
test('resource remaps, duplicate paths, traversal, encrypted entries and format changes fail closed',()=>{
 for(const item of [{path:PROTECTED_CREATION_FILES[0]+'.remap',data:'path=res://forged.gd'},{path:PROTECTED_CREATION_FILES[0].replace('.gd','.gdc'),data:'compiled'},{path:'override.cfg',data:'override'}]){const entries=[...files(),item];assert.throws(()=>verifyCreationPack(pack(entries),pins(entries)));}
 for(const item of [{path:'../escape.gd',data:'x'},{path:PROTECTED_CREATION_FILES[0].toUpperCase(),data:'x'},{path:'encrypted.gd',data:'x',flags:1}])assert.throws(()=>readPck4(pack([...files(),item])));
 const b=pack(files());b.writeUInt32LE(3,4);assert.throws(()=>readPck4(b),/FORMAT_UNSUPPORTED/);
});
test('binary project reader skips only length-bounded unrelated variants and rejects selector aliases',()=>{
 assert.equal(Object.keys(readCreationProjectSelectors(project([...selectors,['unrelated',u32(28)]]))).length,2);
 for(const entries of [[...selectors,selectors[0]],[...selectors,['craftmine/runtime/adapter.web','res://forged.gd']],[selectors[0]],[[selectors[0][0],u32(2)],selectors[1]]])assert.throws(()=>readCreationProjectSelectors(project(entries)));
 const b=project();b.writeUInt32LE(0xffffffff,8);assert.throws(()=>readCreationProjectSelectors(b),/PROJECT_INVALID/);
});
test('truncation, out-of-range file offsets and raw data corruption are refused',()=>{const b=pack(files());assert.throws(()=>readPck4(b.subarray(0,b.length-1)));const corrupted=Buffer.from(b);corrupted[112]^=1;assert.throws(()=>readPck4(corrupted),/DIGEST_MISMATCH/);const invalid=Buffer.from(b);invalid.writeBigUInt64LE(2n**63n,32);assert.throws(()=>readPck4(invalid),/RANGE_INVALID/);});

const {HISTORICAL_CREATION_PROFILE:history}=require('../plugins/craftmine-world/godot-creation-pack.cjs');
const oldFiles=(crlf=false)=>[...history.files.map(file=>({path:file.path,data:execFileSync('git',['show',history.sourceCommit+':'+file.sourcePath],{encoding:'utf8',windowsHide:true}).replace(/\r\n/g,'\n').replace(/\n/g,crlf?'\r\n':'\n')})),{path:'project.binary',data:project()}];

test('reviewed history pins are exact committed LF/CRLF sources and do not claim new capabilities',()=>{
 for(const crlf of [false,true]){
  const entries=oldFiles(crlf),expected=pins(entries);
  for(const file of history.files){const actual=expected.find(entry=>entry.path===file.path);assert.ok(file.variants.some(variant=>variant.bytes===actual.bytes&&variant.sha256===actual.sha256));}
  const proof=verifyCreationPack(pack(entries),expected);
  assert.equal(proof.format,'craftmine.creation-pack-proof/1');assert.equal(proof.files.length,3);
  assert.deepEqual(proof.observerContract,{profileId:history.id,sourceCommit:history.sourceCommit,historical:true,sceneObjectTarget:false,headlessPlayAction:false,requiresNormalMigration:true});
 }
 const current=verifyCreationPack(pack(files()),pins(files()));
 assert.deepEqual(current.observerContract,{profileId:'current-source-pins',historical:false});
 assert.equal(Object.hasOwn(current.observerContract,'sceneObjectTarget'),false);
 assert.equal(Object.hasOwn(current.observerContract,'headlessPlayAction'),false);
});

test('historical source selection rejects unknown, incomplete and version-mixed old cohorts',()=>{
 const originals=oldFiles();
 for(let index=0;index<3;index++){
  const mutated=structuredClone(originals);mutated[index].data+='\n# one changed byte\n';
  assert.throws(()=>verifyCreationPack(pack(mutated),pins(mutated)),/SOURCE_PIN_MISSING/);
  const missing=originals.filter((_,i)=>i!==index);assert.throws(()=>verifyCreationPack(pack(missing),pins(missing)),/SOURCE_PIN_MISSING/);
 }
 const duplicate=[...originals,{...originals[0]}];assert.throws(()=>verifyCreationPack(pack(originals),pins(duplicate)),/SOURCE_PIN_MISSING/);
 const unknown=files().slice(0,3).concat({path:'project.binary',data:project()});assert.throws(()=>verifyCreationPack(pack(unknown),pins(unknown)),/SOURCE_PIN_MISSING/);
});

test('new helpers or any known remap/compiled alias cannot be mixed into reviewed history',()=>{
 for(const name of history.absent)for(const suffix of ['', '.remap', '.uid']){
  const added={path:name+suffix,data:'untrusted helper'},originals=oldFiles();
  assert.throws(()=>verifyCreationPack(pack([...originals,added]),pins(originals)),/HISTORICAL_PROFILE_MIXED/);
  assert.throws(()=>verifyCreationPack(pack(originals),[...pins(originals),{path:added.path,bytes:1,sha256:'a'.repeat(64)}]),/HISTORICAL_PROFILE_MIXED/);
 }
 for(const name of history.absent)for(const alias of [name.toUpperCase(),name.replace('.gd','.gdc'),name.replace('.gd','.gdc.remap')]){
  const originals=oldFiles();assert.throws(()=>verifyCreationPack(pack([...originals,{path:alias,data:'untrusted'}]),pins(originals)),/HISTORICAL_PROFILE_MIXED/);
 }
 const mixed=[...oldFiles(),...files().filter(file=>history.absent.includes(file.path))];assert.throws(()=>verifyCreationPack(pack(mixed),pins(mixed)),/HISTORICAL_PROFILE_MIXED/);
});

test('historical PCK still verifies each actual script and selector independently of source pins',()=>{
 for(let index=0;index<3;index++){
  const entries=oldFiles(),expected=pins(entries);entries[index].data+='x';
  assert.throws(()=>verifyCreationPack(pack(entries),expected),/PROTECTED_MISMATCH/);
  const missing=oldFiles();assert.throws(()=>verifyCreationPack(pack(missing.filter((_,i)=>i!==index)),pins(missing)),/PROTECTED_MISMATCH/);
 }
 for(const file of history.files)for(const alias of [file.path+'.remap',file.path.replace('.gd','.gdc'),file.path.replace('.gd','.gdc.remap')]){
  const entries=oldFiles();assert.throws(()=>verifyCreationPack(pack([...entries,{path:alias,data:'alias'}]),pins(entries)),/PROTECTED_ALIAS/);
  assert.throws(()=>verifyCreationPack(pack(entries),[...pins(entries),{path:alias,bytes:5,sha256:'a'.repeat(64)}]),/PROTECTED_ALIAS/);
 }
 const entries=oldFiles();entries.at(-1).data=project([selectors[0],[selectors[1][0],'res://forged.gd']]);
 assert.throws(()=>verifyCreationPack(pack(entries),pins(entries)),/SELECTOR_MISMATCH/);
});
