import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {blenderLock,blenderInventory,verifyBlenderArtifact,verifyBlenderRuntime,safeBlenderPath} from '../../desktop/blender/toolchain.mjs';
import {extractBlenderArchive} from '../../desktop/blender/extract-toolchain.mjs';
import {verifyBlenderBrokerInputs,fileHash} from '../../desktop/prepare-runtime-resources.mjs';

test('checked-in full runtime pins cover executable, Python, GLB exporter and upstream notices',()=>{
  assert.equal(blenderLock.archive.sha256,'0e631dad7d0cad6d5d18abdd2e2550f6c0213215334eda00ddbd3d22b96ecb2c');
  assert.equal(blenderLock.files.length,6526);
  for(const name of ['blender.exe','python313.dll','license/license.md','license/licenses.json','5.2/scripts/addons_core/io_scene_gltf2/__init__.py'])assert.ok(blenderLock.files.find(f=>f.path===name),name);
  assert.equal(blenderLock.files.reduce((sum,file)=>sum+file.bytes,0),blenderLock.totalBytes);
  assert.equal(new Set(blenderLock.files.map(f=>f.path.toLowerCase())).size,blenderLock.files.length);
  for(const file of blenderLock.files){safeBlenderPath(file.path);assert.match(file.sha256,/^[a-f0-9]{64}$/);}
});

test('all runtime files are pinned; edits, missing and extra files fail closed',async()=>{
  for(const action of ['edit','missing','extra']){
    const directory=await fs.mkdtemp(path.join(tmpdir(),'craftmine-blender-pin-'));
    await fs.mkdir(path.join(directory,'lib'));await fs.writeFile(path.join(directory,'blender.exe'),'fake');await fs.writeFile(path.join(directory,'lib/python.dll'),'dependency');
    const lock={version:'test',files:await blenderInventory(directory)};
    assert.equal((await verifyBlenderRuntime(directory,lock)).files,2);
    if(action==='edit')await fs.writeFile(path.join(directory,'lib/python.dll'),'tampered');
    if(action==='missing')await fs.unlink(path.join(directory,'lib/python.dll'));
    if(action==='extra')await fs.writeFile(path.join(directory,'lib/injected.py'),'injected');
    await assert.rejects(verifyBlenderRuntime(directory,lock),/INVENTORY_MISMATCH/);
  }
});

test('archive pin rejects same-size tamper and runtime enumeration rejects directory links',async()=>{
  const directory=await fs.mkdtemp(path.join(tmpdir(),'craftmine-blender-link-'));
  await fs.writeFile(path.join(directory,'archive.zip'),'abcd');
  const pin=(await blenderInventory(directory))[0];await verifyBlenderArtifact(path.join(directory,'archive.zip'),pin);
  await fs.writeFile(path.join(directory,'archive.zip'),'abce');await assert.rejects(verifyBlenderArtifact(path.join(directory,'archive.zip'),pin),/PIN_MISMATCH/);
  const outside=await fs.mkdtemp(path.join(tmpdir(),'craftmine-blender-outside-'));
  await fs.symlink(outside,path.join(directory,'junction'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(blenderInventory(directory),/LINK_DENIED/);
});

test('Blender paths reject Windows aliases and traversal',()=>{
  for(const value of ['../a','a/../b','a\\b','a:b','a/CON.py','a/trailing.','a//b','/a'])assert.throws(()=>safeBlenderPath(value),/PATH_INVALID/);
});

function zipFixture(names){
  const locals=[],central=[];let offset=0;
  for(const name of names){
    const bytes=Buffer.from(name),header=Buffer.alloc(30),index=Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(bytes.length,26);
    index.writeUInt32LE(0x02014b50);index.writeUInt16LE(bytes.length,28);index.writeUInt32LE(offset,42);
    locals.push(header,bytes);central.push(index,bytes);offset+=header.length+bytes.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}
test('ZIP extraction handles long paths and rejects traversal, wrong root, aliases and duplicate case names before writing',async()=>{
  for(const names of [['blender/../escape'],['outside/file'],['blender/CON.txt'],['blender/a','blender/A']]){
    const directory=await fs.mkdtemp(path.join(tmpdir(),'craftmine-blender-zip-')),out=path.join(directory,'out');await fs.mkdir(out);
    const archive=path.join(directory,'fixture.zip');await fs.writeFile(archive,zipFixture(names));
    await assert.rejects(extractBlenderArchive(archive,out,'blender',safeBlenderPath),/PATH_INVALID|ENTRY_DENIED|DUPLICATE_PATH/);
    assert.deepEqual(await fs.readdir(out),[]);
  }
  const directory=await fs.mkdtemp(path.join(tmpdir(),'craftmine-blender-zip-long-')),out=path.join(directory,'out');await fs.mkdir(out);
  const name='blender/'+('nested-folder/'.repeat(25))+'empty.py',archive=path.join(directory,'fixture.zip');await fs.writeFile(archive,zipFixture([name]));
  await extractBlenderArchive(archive,out,'blender',safeBlenderPath);assert.equal((await fs.stat(path.join(out,name))).size,0);
});

test('packaged driver and lock must match broker build source identity, including line endings',async()=>{
  const directory=await fs.mkdtemp(path.join(tmpdir(),'craftmine-blender-bridge-'));await fs.mkdir(path.join(directory,'blender/bridge'),{recursive:true});
  const sourceFiles=[];
  for(const name of ['bridge/driver.py','toolchain.lock.json']){
    const target=path.join(directory,'blender',name);await fs.writeFile(target,'source\n');sourceFiles.push({path:name,sha256:await fileHash(target)});
  }
  const identity={format:'craftmine.blender-broker-identity/1',sourceFiles};
  assert.equal((await verifyBlenderBrokerInputs(directory,identity)).length,2);
  await fs.writeFile(path.join(directory,'blender/bridge/driver.py'),'source\r\n');
  await assert.rejects(verifyBlenderBrokerInputs(directory,identity),/BLENDER_BROKER_SOURCE_MISMATCH/);
});
