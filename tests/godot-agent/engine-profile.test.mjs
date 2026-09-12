import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {materializeBase} from '../../desktop/godot/shared/materialize.mjs';
const require=createRequire(import.meta.url);
const {RESOURCES,loadEnginePerformancePins,hasEnginePerformanceSource,verifyEnginePerformancePack}=require('../../plugins/craftmine-world/godot-engine-profile.cjs');
const hash=(b,algorithm='sha256')=>createHash(algorithm).update(b).digest();
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;},u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
const str=text=>{const b=Buffer.from(text);return Buffer.concat([u32(4),u32(b.length),b,Buffer.alloc((4-b.length%4)%4)]);};
const selectors=[['autoload/CraftmineRuntime','*res://craftmine_shared/runtime_bridge.gd'],['craftmine/runtime/adapter','res://craftmine_shared/base_adapter.gd']];
const project=(values=selectors)=>Buffer.concat([Buffer.from('ECFG'),u32(values.length),...values.flatMap(([key,value])=>{const b=str(value);return [u32(Buffer.byteLength(key)),Buffer.from(key),u32(b.length),b];})]);
function pack(entries){
  const header=Buffer.alloc(112);for(const [at,value] of [[0,0x43504447],[4,4],[8,4],[12,7],[16,2],[20,2]])header.writeUInt32LE(value,at);
  header.writeBigUInt64LE(112n,24);let offset=0;const chunks=[],directory=[];
  for(const entry of entries){const b=Buffer.from(entry.data),name=Buffer.from(entry.path),padded=Buffer.concat([name,Buffer.alloc((4-name.length%4)%4)]);
    chunks.push(b);directory.push(Buffer.concat([u32(padded.length),padded,u64(offset),u64(b.length),hash(b,'md5'),u32(0)]));offset+=b.length;}
  header.writeBigUInt64LE(BigInt(112+offset),32);return Buffer.concat([header,...chunks,u32(entries.length),...directory]);
}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'engine-profile-'));
const entries=Object.entries(RESOURCES).map(([name,relative])=>{
  const data='extends RefCounted\n# '+relative+'\n';fs.mkdirSync(path.dirname(path.join(tmp,relative)),{recursive:true});fs.writeFileSync(path.join(tmp,relative),data);return {path:name,data};
});
const pins=loadEnginePerformancePins(tmp);
const source=(files=entries)=>files.map(file=>({path:file.path,bytes:Buffer.byteLength(file.data),sha256:hash(file.data).toString('hex')}));
const build=(files=entries,compiled=project())=>pack([...files,{path:'project.binary',data:compiled}]);
test.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));

test('source and PCK must agree with independently loaded app pins',()=>{
  assert.equal(hasEnginePerformanceSource(source(),pins),true);
  const result=verifyEnginePerformancePack(build(),source(),pins);
  assert.equal(result.profile,'engine-monitor/1');assert.equal(result.files.length,5);
  for(const entry of entries){
    const changed=entries.map(file=>file===entry?{...file,data:file.data+'changed'}:file);
    assert.equal(hasEnginePerformanceSource(source(changed),pins),false,'source cannot choose its own authority hash');
    assert.throws(()=>verifyEnginePerformancePack(build(changed),source(),pins),/PACK_MISMATCH/);
    assert.equal(hasEnginePerformanceSource(source(entries.filter(file=>file!==entry)),pins),false);
  }
});
test('old installs, partial cohorts and duplicate source identities are unsupported',()=>{
  assert.equal(loadEnginePerformancePins(path.join(tmp,'absent')),null);
  assert.equal(hasEnginePerformanceSource(source(),null),false);
  assert.equal(hasEnginePerformanceSource([...source(),source()[0]],pins),false);
  const crlf=entries.map(file=>({...file,data:file.data.replaceAll('\n','\r\n')}));
  assert.equal(hasEnginePerformanceSource(source(crlf),pins),true);
  verifyEnginePerformancePack(build(crlf),source(crlf),pins);
});
test('protected remaps, compiled aliases and configuration replacement cannot pass',()=>{
  for(const name of Object.keys(RESOURCES))for(const alias of [name+'.remap',name+'.uid',name.replace('.gd','.gdc'),name.replace('.gd','.gdc.remap')]){
    const changed=[...entries,{path:alias,data:'replacement'}];
    assert.equal(hasEnginePerformanceSource(source(changed),pins),false);
    assert.throws(()=>verifyEnginePerformancePack(build(changed),source(),pins),/PACK_ALIAS/);
  }
  assert.throws(()=>verifyEnginePerformancePack(build([...entries,{path:'Override.cfg',data:'override'}]),source(),pins),/PACK_OVERRIDE/);
  assert.throws(()=>verifyEnginePerformancePack(build(entries,project([[selectors[0][0],'*res://fake.gd'],selectors[1]])),source(),pins),/SELECTOR_MISMATCH/);
  const damaged=build();damaged[112]^=1;
  assert.throws(()=>verifyEnginePerformancePack(damaged,source(),pins),/DIGEST_MISMATCH/);
});

test('real materializer opts in with app-pinned resources while default worlds remain unsupported',()=>{
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const actualPins=loadEnginePerformancePins(path.join(root,'desktop/godot'));
  const ordinary=materializeBase({baseId:'creation-sandbox',worldId:'engine-default',out:path.join(tmp,'default')});
  const enabled=materializeBase({baseId:'creation-sandbox',worldId:'engine-enabled',out:path.join(tmp,'enabled'),enginePerformanceProfile:'engine-monitor/1'});
  assert.equal(hasEnginePerformanceSource(ordinary.files,actualPins),false);
  assert.equal(hasEnginePerformanceSource(enabled.files,actualPins),true);
  const actualEntries=Object.keys(RESOURCES).map(name=>({path:name,data:fs.readFileSync(path.join(tmp,'enabled',name))}));
  assert.equal(verifyEnginePerformancePack(build(actualEntries),enabled.files,actualPins).files.length,5);
});
