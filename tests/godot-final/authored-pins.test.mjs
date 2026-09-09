import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonicalBlobBytes} from '../../desktop/delivery/lib/source-bytes.mjs';
import {refreshManifest} from '../../desktop/delivery/refresh-authored-pins.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const oid=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const file=text=>{const bytes=Buffer.from(text);return {bytes,sha256:sha(bytes)};};
test('CRLF is canonicalized only when it proves the exact frozen Git object',()=>{
  const canonical=Buffer.from('hello\nworld\n'),checkout=Buffer.from('hello\r\nworld\r\n');
  assert.deepEqual(canonicalBlobBytes(checkout,oid(canonical)),canonical);
  assert.throws(()=>canonicalBlobBytes(Buffer.from('other\r\n'),oid(canonical)),/SOURCE_BYTES_CHANGED/);
  const binary=Buffer.from([0,13,10,255]);assert.deepEqual(canonicalBlobBytes(binary,oid(binary)),binary);
  assert.throws(()=>canonicalBlobBytes(Buffer.from([0,10,255]),oid(binary)),/SOURCE_BYTES_CHANGED/);
});
test('authored content refresh preserves pending rights and provenance fields',()=>{
  const manifest={baseId:'test',sourceDirectory:'base',rightsStatus:'pending-formal-application',reviewedCommit:'old',entries:[{path:'a.gd',author:'Craftmine World project',origin:'authored',license:'project-authored',redistribution:'conditional',conditions:'unchanged review',outstanding:'pending',bytes:1,sha256:'old'}]};
  const result=refreshManifest(manifest,new Map([['base/a.gd',file('new\n')]]));
  assert.equal(result.entries[0].sha256,sha(Buffer.from('new\n')));
  for(const key of ['rightsStatus','reviewedCommit'])assert.equal(result[key],manifest[key]);
  for(const key of ['redistribution','conditions','outstanding','license','author','origin'])assert.equal(result.entries[0][key],manifest.entries[0][key]);
});
test('changed third-party file and unreviewed additions remain blocked',()=>{
  const manifest={sourceDirectory:'base',entries:[{path:'third-party.dat',author:'Other',origin:'downloaded',license:'unknown',redistribution:'unreviewed',bytes:1,sha256:'old'}]};
  assert.throws(()=>refreshManifest(manifest,new Map([['base/third-party.dat',file('new')]])),/UNREVIEWED_PIN_CHANGED/);
  assert.throws(()=>refreshManifest({sourceDirectory:'base',entries:[]},new Map([['base/new.png',file('unreviewed')]])),/NEW_SOURCE_REQUIRES_REVIEW/);
});
test('approved addition receives pending project authorship, never third-party approval',()=>{
  const result=refreshManifest({baseVersion:'1',sourceDirectory:'base',entries:[]},new Map([['base/new.gd',file('extends Node\n')]]),{approvedNew:new Set(['base/new.gd'])});
  assert.equal(result.entries[0].license,'project-authored');assert.match(result.entries[0].outstanding,/pending/);
});
test('owned notice newline pin follows its exact blob while third-party notices remain fixed',()=>{
  const owned={path:'LICENSE.txt',author:'Craftmine World project',origin:'authored',license:'project-authored',bytes:1,sha256:'old'};
  const manifest={sourceDirectory:'base',entries:[owned],requiredNotices:[{path:'base/LICENSE.txt',sha256:'old'}]};
  const files=new Map([['base/LICENSE.txt',file('same grant\n')]]),result=refreshManifest(manifest,files);
  assert.equal(result.requiredNotices[0].sha256,result.entries[0].sha256);
  assert.throws(()=>refreshManifest({sourceDirectory:'base',entries:[],requiredNotices:[{path:'outside/LICENSE.txt',sha256:'old'}]},new Map([['outside/LICENSE.txt',file('changed')]])),/UNREVIEWED_NOTICE_CHANGED/);
});
test('only the two reviewed standalone additions are admitted with precise distribution and pending rights',()=>{
  const manifest={baseVersion:'1',sourceDirectory:'desktop/godot/shared',rightsStatus:'pending-formal-application',reviewedCommit:'unchanged',entries:[]};
  const files=new Map([
    ['desktop/godot/shared/standalone_bootstrap.gd',file('extends Node\n')],
    ['desktop/godot/shared/windows-export.cfg',file('[preset.0]\n')],
  ]);
  const result=refreshManifest(manifest,files);
  assert.equal(result.entries.length,2);
  assert.deepEqual(result.entries.find(e=>e.path==='standalone_bootstrap.gd').distribution,['app-bundle','user-export']);
  assert.deepEqual(result.entries.find(e=>e.path==='windows-export.cfg').distribution,['app-bundle']);
  assert.equal(result.rightsStatus,manifest.rightsStatus);assert.equal(result.reviewedCommit,'unchanged');
  for(const entry of result.entries){assert.equal(entry.license,'project-authored');assert.match(entry.outstanding,/pending/);}
  files.set('desktop/godot/shared/unreviewed_export.gd',file('extends Node\n'));
  assert.throws(()=>refreshManifest(manifest,files),/NEW_SOURCE_REQUIRES_REVIEW/);
});
