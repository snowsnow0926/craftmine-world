import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {beginRelease,readRelease,sealRelease,verifySeal,selectInstaller,archiveEntries,within} from '../../desktop/release-run.mjs';

const commit='a'.repeat(40);
async function fixture(installer=true){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'craftmine-release-run-'));
  await fs.mkdir(path.join(root,'desktop/build'),{recursive:true});
  await fs.writeFile(path.join(root,'desktop/build/build-manifest.json'),JSON.stringify({commit}));
  const run=await beginRelease(root,{commit},{installer});
  await fs.mkdir(path.join(run.output,'win-unpacked/resources/source'),{recursive:true});
  await fs.copyFile(path.join(root,'desktop/build/build-manifest.json'),path.join(run.output,'win-unpacked/resources/source/build-manifest.json'));
  if(installer)for(const name of ['Craftmine-World-Setup-1.0.0.exe','Craftmine-World-Setup-1.0.0.exe.blockmap'])await fs.writeFile(path.join(run.output,name),'fixture-'+name);
  return {root,run};
}
test('each run has fresh output and sealed bytes reject later replacement',async()=>{
  const {root,run}=await fixture();
  const next=await beginRelease(root,{commit},{installer:true});assert.notEqual(next.output,run.output);assert.deepEqual(await fs.readdir(next.output),[]);
  await sealRelease(run,'1.0.0');await verifySeal(await readRelease(root,run.runFile));
  await fs.writeFile(path.join(run.output,'Craftmine-World-Setup-1.0.0.exe'),'changed');
  await assert.rejects(verifySeal(run),/OUTPUT_CHANGED/);
});
test('same-run pair mandatory; foreign old installer is never searched',async()=>{
  const {root,run}=await fixture(false);
  await fs.writeFile(path.join(root,'desktop/build/releases','Craftmine-World-Setup-1.0.0.exe'),'old');
  await sealRelease(run,'1.0.0');const seal=await verifySeal(run);assert.equal(selectInstaller(seal.files,false,'1.0.0'),null);
  assert.throws(()=>selectInstaller(seal.files,true,'1.0.0'),/PAIR_MISMATCH/);
  assert.throws(()=>selectInstaller([{path:'Craftmine-World-Setup-old.exe',bytes:1},{path:'Craftmine-World-Setup-old.exe.blockmap',bytes:1}],true,'1.0.0'),/PAIR_MISMATCH/);
});
test('changed manifest, outside record and resealing are rejected',async()=>{
  const {root,run}=await fixture();await sealRelease(run,'1.0.0');await assert.rejects(sealRelease(run,'1.0.0'),/EEXIST/);
  assert.throws(()=>within(path.join(root,'desktop/build/releases'),root),/OUTSIDE/);
  await fs.writeFile(path.join(root,'desktop/build/build-manifest.json'),'other');await assert.rejects(readRelease(root,run.runFile),/MANIFEST_CHANGED/);
});
const listing=pathValue=>`7-Zip\n----------\nPath = ${pathValue}\nSize = 2\nAttributes = A\n`;
test('archive listing accepts fixed payload and rejects traversal, aliases and links',()=>{
  assert.equal(archiveEntries(listing('$PLUGINSDIR/app-64.7z'))[0].path,'$PLUGINSDIR/app-64.7z');
  for(const p of ['../escape','/root','C:/outside','x:stream','x/../y','x./y','con.txt','x\\..\\y'])assert.throws(()=>archiveEntries(listing(p)),/PATH_DENIED/);
  assert.throws(()=>archiveEntries(listing('safe')+'Symbolic Link = ../../outside\n'),/LINK_DENIED/);
  assert.throws(()=>archiveEntries(listing('safe')+'\nPath = SAFE\nSize = 1\n'),/PATH_DENIED/);
});
