// S3: the asset lock has exactly one definition.
//
// Regression for the round-two audit finding "three incompatible lock shapes
// under one format id" (docs/audits/godot-round2-20260910/REPORT.md 3.3,
// REPRODUCTIONS.md 3). The R4 `{direct, closure, graph}` document is refused,
// the canonical `{format, assets[]}` contract is validated and hashed here and
// in Rust against the same vectors, and the package layer delegates instead of
// keeping a second implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  ASSET_LOCK_FILE,
  ASSET_LOCK_FORMAT,
  assetLockHash,
  buildAssetLock,
  canonicalLockText,
  dependencyToAssetRef,
  mediaTypeForPath,
  parseAssetLock,
  parseCanonicalAssetLock,
  validateAssetLock,
} from '../../../plugins/craftmine-world/asset-lock.mjs';
import {LOCK_FORMAT,validateLock} from '../../../plugins/craftmine-world/package-format.mjs';
import {LOCK_FORMAT as ZIP_LOCK_FORMAT} from '../../../plugins/craftmine-world/package-zip.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const vectors=JSON.parse(readFileSync(join(here,'vectors','asset-lock-vectors.json'),'utf8'));
const frozen=JSON.parse(readFileSync(join(here,'..','..','godot-remaining','M','contract','asset-lock-vectors.json'),'utf8'));

const throwsCode=(run,code)=>assert.throws(run,error=>error instanceof Error&&(error.message===code||error.message.startsWith(code+': ')),`expected ${code}`);

test('one format id, one lock module',()=>{
  assert.equal(ASSET_LOCK_FORMAT,'craftmine.assets-lock/1');
  assert.equal(ASSET_LOCK_FILE,'craftmine.assets.lock.json');
  assert.equal(LOCK_FORMAT,ASSET_LOCK_FORMAT);
  // package-zip stays free of node:crypto, so the shared constant is asserted
  // instead of imported.
  assert.equal(ZIP_LOCK_FORMAT,ASSET_LOCK_FORMAT);
});

test('the frozen Rust contract vector is reproduced byte for byte',()=>{
  for(const reference of vectors.frozenCrossLanguage){
    const vector=frozen.vectors.find(item=>item.name===reference.frozenName);
    assert.ok(vector,`${reference.name}: frozen vector missing`);
    const text=vector.lockText;
    const lock=validateAssetLock(JSON.parse(text));
    assert.equal(lock.assets.length,reference.assets,reference.name);
    assert.equal(canonicalLockText(lock),text,`${reference.name}: canonical text`);
    assert.equal(assetLockHash(lock),reference.assetLockHash,`${reference.name}: hash`);
    // Rust writes these bytes into Git, so parse must require them to be canonical.
    assert.deepEqual(parseCanonicalAssetLock(Buffer.from(text,'utf8')),lock,reference.name);
    assert.equal(createHash('sha256').update(Buffer.from(text,'utf8')).digest('hex'),reference.assetLockHash,reference.name);
  }
});

test('accept vectors are canonical and hash-stable in both languages',()=>{
  for(const vector of vectors.accept){
    const lock=validateAssetLock(vector.lock);
    assert.equal(assetLockHash(lock),vector.assetLockHash,vector.name);
    assert.equal(assetLockHash(validateAssetLock(lock)),vector.assetLockHash,`${vector.name} (idempotent)`);
    assert.deepEqual(parseCanonicalAssetLock(Buffer.from(canonicalLockText(lock),'utf8')),lock,vector.name);
    assert.deepEqual(parseAssetLock(Buffer.from(JSON.stringify(vector.lock),'utf8')),lock,`${vector.name} (non-canonical input)`);
  }
});

test('reject vectors fail with the frozen code',()=>{
  for(const vector of vectors.reject)throwsCode(()=>validateAssetLock(vector.lock),vector.error);
});

test('the legacy R4 shape is refused, never guessed',()=>{
  throwsCode(()=>validateLock({direct:[{id:'a',version:1}],closure:[{id:'a',version:1}],graph:{}}),'ASSET_LOCK_LEGACY_SHAPE');
  throwsCode(()=>validateAssetLock({format:ASSET_LOCK_FORMAT,assets:[],direct:[]}),'ASSET_LOCK_LEGACY_SHAPE');
});

test('package-format.validateLock delegates to the canonical contract',()=>{
  const canonical=vectors.accept[0].lock;
  assert.deepEqual(validateLock(canonical),{ok:true});
  assert.equal(assetLockHash(canonical),vectors.accept[0].assetLockHash);
});

test('media type table is shared with the Rust conversion',()=>{
  for(const vector of vectors.mediaTypes)assert.equal(mediaTypeForPath(vector.path),vector.mediaType,vector.path);
  assert.equal(mediaTypeForPath('no-extension'),'application/octet-stream');
  assert.equal(mediaTypeForPath('a/b.GD'),'text/x-gdscript');
});

test('package dependency metadata converts explicitly into an AssetRef',()=>{
  const ref=dependencyToAssetRef({id:'stone',version:1,sha256:'a'.repeat(64)});
  assert.deepEqual(ref,{assetId:'stone',version:'1',contentHash:'a'.repeat(64)});
  // The package rule accepts uppercase hex and normalizes it (Rust hash_field).
  assert.deepEqual(dependencyToAssetRef({id:'stone',version:1,sha256:'A'.repeat(64)}),ref);
  throwsCode(()=>dependencyToAssetRef({id:'stone',version:0,sha256:'a'.repeat(64)}),'INVALID_VERSION');
  throwsCode(()=>dependencyToAssetRef({id:'stone',version:1.5,sha256:'a'.repeat(64)}),'INVALID_VERSION');
  throwsCode(()=>dependencyToAssetRef({id:'stone',version:1,sha256:'abc'}),'INVALID_HASH');
  throwsCode(()=>dependencyToAssetRef({id:'Stone',version:1,sha256:'a'.repeat(64)}),'INVALID_ASSET_ID');
  throwsCode(()=>dependencyToAssetRef({id:'stone',version:1,sha256:'a'.repeat(64),latest:true}),'UNKNOWN_FIELD');
});

test('buildAssetLock canonicalizes an unordered install plan',()=>{
  const unsorted=[
    {asset:{assetId:'b',version:'1',contentHash:'b'.repeat(64)},installPath:'addons/b',files:[],dependencies:[],overrides:[]},
    {asset:{assetId:'a',version:'2',contentHash:'a'.repeat(64)},installPath:'addons/a',files:[],dependencies:[
      {assetId:'b',version:'1',contentHash:'b'.repeat(64)},
    ],overrides:[]},
  ];
  const lock=buildAssetLock(unsorted);
  assert.deepEqual(lock.assets.map(entry=>entry.asset.assetId),['a','b']);
  assert.equal(lock.assets[0].dependencies.length,1);
});
