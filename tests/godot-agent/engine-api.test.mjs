import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {queryEngineApi:query,createEngineApi,VERSION}=require('../../plugins/craftmine-world/godot-engine-api.cjs');
const lock=require('../../desktop/godot/toolchain.lock.json');

test('committed metadata is measured from the locked runtime and exposes explicit coverage limits',()=>{
  const info=query({mode:'info'});
  assert.equal(info.status,'known');assert.equal(info.pin.engineVersion,lock.version);assert.equal(VERSION,lock.version);
  assert.equal(info.engineSha256,lock.editor.executableSha256);assert.match(info.pin.corpusHash,/^[a-f0-9]{64}$/);
  for(const kind of ['classes','methods','properties','signals','enums','constants'])assert.ok(info.coverage[kind]>0,kind);
  assert.ok(info.limitations.some(text=>text.includes('Variant')));assert.ok(info.limitations.some(text=>text.includes('Web')));
});

test('real reflected class, method, property, signal, enum and constants retain their types and owners',()=>{
  const cases=[['CharacterBody3D','move_and_slide','method'],['CharacterBody3D','velocity','property'],
    ['Area3D','body_entered','signal'],['Node','ProcessMode','enum'],['Node','PROCESS_MODE_DISABLED','constant']];
  for(const [className,memberName,kind] of cases){
    const result=query({mode:'member',className,memberName,kind});
    assert.equal(result.status,'known',memberName);assert.equal(result.items.length,1);
    assert.equal(result.items[0].declaredIn,className);assert.equal(result.items[0].kind,kind);
  }
  assert.equal(query({mode:'member',className:'CharacterBody3D',memberName:'move_and_slide'}).items[0].metadata.return.typeName,'bool');
  assert.equal(query({mode:'member',className:'CharacterBody3D',memberName:'velocity'}).items[0].metadata.typeName,'Vector3');
  assert.equal(query({mode:'member',className:'Node',memberName:'PROCESS_MODE_DISABLED'}).items[0].metadata.value,'4');
  const timer=query({mode:'member',className:'SceneTree',memberName:'create_timer'}).items[0].metadata;
  assert.ok(timer.args.length>=1);assert.ok(timer.default_args.length>=1);assert.ok(timer.default_args.every(value=>typeof value.representation==='string'));
});

test('inherited lookups identify the declaring class and can be excluded',()=>{
  const inherited=query({mode:'member',className:'CharacterBody3D',memberName:'queue_free'});
  assert.equal(inherited.items[0].declaredIn,'Node');assert.equal(inherited.items[0].inherited,true);
  assert.deepEqual(inherited.ancestors,['PhysicsBody3D','CollisionObject3D','Node3D','Node','Object']);
  assert.equal(query({mode:'member',className:'CharacterBody3D',memberName:'queue_free',inherited:false}).reason,'MEMBER_NOT_IN_RUNTIME_METADATA');
});

test('class member pages and search continuation remain pinned with no duplicates or omissions',()=>{
  for(const request of [{mode:'class',className:'Node',kind:'method'},
    {mode:'search',query:'position',kind:'property'},{mode:'search',query:'body',kind:'class'}]){
    const first=query({...request,limit:2});assert.notEqual(first.nextOffset,null);
    assert.equal(first.complete,false);const rows=[...first.items];let offset=first.nextOffset;
    while(offset!==null){const page=query({...request,...first.pin,offset,limit:100});rows.push(...page.items);offset=page.nextOffset;}
    assert.equal(rows.length,first.total);assert.equal(new Set(rows.map(row=>[row.className,row.kind,row.name].join(':'))).size,rows.length);
  }
});

test('version mismatch, unknown classes and uncovered API domains never claim unsupported engine behavior',()=>{
  assert.equal(query({engineVersion:'4.3-stable'}).reason,'ENGINE_API_VERSION_NOT_INSTALLED');
  assert.equal(query({corpusHash:'f'.repeat(64)}).reason,'ENGINE_API_METADATA_PIN_MISMATCH');
  for(const className of ['NoSuchEngineClass','Vector3','AbstractPolygon2DEditor']){
    const result=query({mode:'class',className});assert.equal(result.status,'unknown');assert.equal(result.engineSupport,'unknown');
  }
  assert.equal(query({mode:'member',className:'Node',memberName:'not_a_method'}).status,'unknown');
});

test('bad query fields, pagination and absent pins fail before providing partial answers',()=>{
  for(const args of [{mode:'search',query:'node',offset:1},{mode:'class',className:'Node',limit:101},
    {mode:'member',className:'Node'},{mode:'search',query:'node',kind:'fake'},{mode:'info',executable:'unsafe.exe'},
    {mode:'class',className:'Node',inherited:'false'}])assert.throws(()=>query(args),/ENGINE_API_/);
  const info=query();assert.throws(()=>query({mode:'class',className:'Node',...info.pin,offset:Number.MAX_SAFE_INTEGER}),/PAGE_INVALID/);
});

test('missing and tampered installed metadata report unknown with a precise integrity failure',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'craftmine-engine-api-contract-'));
  const missing=createEngineApi({directory}).query();assert.equal(missing.reason,'ENGINE_API_METADATA_MISSING');
  const source=path.resolve('plugins/craftmine-world/engine-api',VERSION);
  fs.copyFileSync(path.join(source,'index.json'),path.join(directory,'index.json'));
  fs.copyFileSync(path.join(source,'classdb.json'),path.join(directory,'classdb.json'));
  fs.appendFileSync(path.join(directory,'classdb.json'),' ');
  const corrupt=createEngineApi({directory}).query();assert.equal(corrupt.status,'unknown');assert.equal(corrupt.reason,'ENGINE_API_METADATA_INTEGRITY_MISMATCH');
  // Read-only test artifacts are retained in this isolated directory.
  t.diagnostic('fixture='+directory);
});

test('caller mutations do not poison the shared metadata cache',()=>{
  const result=query({mode:'member',className:'Node',memberName:'queue_free'});result.items[0].metadata.name='poison';
  assert.equal(query({mode:'member',className:'Node',memberName:'queue_free'}).items[0].metadata.name,'queue_free');
});
