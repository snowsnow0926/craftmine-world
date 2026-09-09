import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {safeResourcePath,fileHash,resourceInventory,verifyRuntimeResources,REQUIRED_WEB_TEMPLATE_KEYS} from '../../desktop/prepare-runtime-resources.mjs';
const digest=body=>createHash('sha256').update(body).digest('hex');
test('staging covers every Web template required by the real native broker',async()=>{
  const lock=JSON.parse(await fs.readFile(new URL('../../desktop/godot/toolchain.lock.json',import.meta.url),'utf8'));
  const broker=await fs.readFile(new URL('../../desktop/godot/sandbox/src/broker.rs',import.meta.url),'utf8');
  const required=[...broker.matchAll(/\("(web_[a-z_]+\.zip)", "([a-f0-9]{64})"\)/g)].map(match=>({file:match[1],sha256:match[2]}));
  assert.equal(required.length,3,'real fixed_pins template contract must remain explicit');
  for(const requiredPin of required){
    const staged=REQUIRED_WEB_TEMPLATE_KEYS.map(key=>lock.exportTemplates[key]).find(pin=>pin?.file===requiredPin.file);
    assert.ok(staged,'Native preparation requires staged '+requiredPin.file);
    assert.equal(staged.sha256,requiredPin.sha256);assert.ok(staged.bytes>0);
  }
});
async function fixture(){
  const directory=await fs.mkdtemp(path.join(tmpdir(),'craftmine-runtime-manifest-'));
  for(const relative of ['git/bin/git.exe','godot/broker/godot-host-broker.exe','licenses/godot/LICENSE.txt']){
    await fs.mkdir(path.dirname(path.join(directory,relative)),{recursive:true});await fs.writeFile(path.join(directory,relative),relative);
  }
  const files=await resourceInventory(directory);
  await fs.writeFile(path.join(directory,'runtime-resources.json'),JSON.stringify({format:'craftmine.runtime-resources/1',sourceCommit:'commit',files,filesDigest:digest(JSON.stringify(files))}));
  return directory;
}
test('resource names reject traversal, alternate streams and Windows aliases',()=>{
  for(const relative of ['../outside','/absolute','C:/path','git\\bin','a//b','a/CON.txt','a/trailing.','a/..','bad\0file'])assert.throws(()=>safeResourcePath(relative),/PATH_INVALID/);
  assert.equal(safeResourcePath('godot/engine/4.7.2-stable/editor.exe'),'godot/engine/4.7.2-stable/editor.exe');
});
test('resource inventory hashes real bytes and verifies the exact source commit',async()=>{
  const directory=await fixture();
  assert.equal(await fileHash(path.join(directory,'git/bin/git.exe')),digest('git/bin/git.exe'));
  assert.equal((await verifyRuntimeResources(directory,'commit')).files.length,3);
  await assert.rejects(verifyRuntimeResources(directory,'other'),/SOURCE_IDENTITY/);
});
test('tampered, missing and unexpected runtime files fail verification',async()=>{
  for(const action of ['tamper','missing','extra']){
    const directory=await fixture(),file=path.join(directory,'git/bin/git.exe');
    if(action==='tamper')await fs.writeFile(file,'changed');
    if(action==='missing')await fs.unlink(file);
    if(action==='extra')await fs.writeFile(path.join(directory,'godot/extra.exe'),'unexpected');
    await assert.rejects(verifyRuntimeResources(directory,'commit'),/RESOURCE_HASH_MISMATCH/);
  }
});
test('packaged mode permits other app resources but detects extra files inside managed trees',async()=>{
  const directory=await fixture();
  await fs.writeFile(path.join(directory,'app.asar'),'separately verified application');
  assert.equal((await verifyRuntimeResources(directory,'commit',{packaged:true})).files.length,3);
  await fs.writeFile(path.join(directory,'git/extra.dll'),'unexpected');
  await assert.rejects(verifyRuntimeResources(directory,'commit',{packaged:true}),/RESOURCE_HASH_MISMATCH/);
});
