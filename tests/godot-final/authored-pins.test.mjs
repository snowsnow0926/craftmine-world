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
