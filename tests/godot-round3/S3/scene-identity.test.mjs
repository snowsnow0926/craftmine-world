// S3: scene identity and CRLF regressions from the round-two audit.
//
// Counterexamples reproduced here:
//   docs/audits/godot-round2-20260910/REPRODUCTIONS.md section 2
//     {"accepted":true,"duplicateIdentityOccurrences":2,
//      "crlfExistingActionReportedMissing":["interact"]}
// The planner must refuse an override of the identity field, the serialized
// scene must contain exactly one node per identity and per name, and CRLF
// `project.godot` files must not report existing actions as missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyInputActions,
  applySceneInsertion,
  parseScene,
  planInputActions,
  planSceneInsertion,
} from '../../../desktop/godot/shared/scene_materializer.mjs';

const SPEC={
  mode:'script-node',
  script:'door.gd',
  parent:'.',
  nodeType:'Node2D',
  identityField:'entity_id',
  identityType:'string',
  exports:{locked:false},
  inputActions:['interact'],
};

const SCENE=[
  '[gd_scene load_steps=2 format=3]',
  '',
  '[ext_resource type="Script" path="res://world.gd" id="1_world"]',
  '',
  '[node name="Root" type="Node2D"]',
  'script = ExtResource("1_world")',
  '',
  '[node name="Old" type="Node2D" parent="."]',
  'entity_id = "old-id"',
  '',
].join('\n');

const plan=(options={})=>planSceneInsertion({
  sceneText:options.sceneText??SCENE,
  scenePath:'scene.tscn',
  spec:SPEC,
  entityId:options.entityId??'new-id',
  placement:options.placement??{},
  overrides:options.overrides??{},
});

const countIdentity=(text,value)=>(text.match(new RegExp(`entity_id = "${value}"`,'g'))||[]).length;

test('the audit counterexample is refused instead of duplicating an identity',()=>{
  const refused=plan({overrides:{entity_id:'old-id'}});
  assert.equal(refused.ok,false);
  assert.equal(refused.reason,'reserved-override');
  assert.match(refused.detail,/entity_id/);
  // The legacy behaviour is what produced two `entity_id = "old-id"` nodes.
  assert.equal(countIdentity(SCENE,'old-id'),1);
});

test('placement may not rewrite identity or node structure either',()=>{
  for(const key of ['entity_id','script','parent','name','instance','type','groups']){
    const refused=plan({placement:{[key]:'x'}});
    assert.equal(refused.ok,false,key);
    assert.equal(refused.reason,'reserved-override',key);
  }
});

test('declared exports still come from placement and overrides',()=>{
  const allowed=plan({placement:{locked:true}});
  assert.equal(allowed.ok,true);
  assert.equal(allowed.edit.properties.locked,'true');
  const overridden=plan({overrides:{locked:true}});
  assert.equal(overridden.ok,true);
  assert.equal(overridden.edit.properties.locked,'true');
});

test('a valid insertion keeps exactly one identity and one node name',()=>{
  const planned=plan();
  assert.equal(planned.ok,true);
  const text=applySceneInsertion(SCENE,planned.edit);
  assert.equal(countIdentity(text,'old-id'),1);
  assert.equal(countIdentity(text,'new-id'),1);
  const names=parseScene(text).nodes.map(node=>node.name);
  assert.deepEqual(names,['Root','Old','new-id']);
  assert.equal(new Set(names).size,names.length);
  // Existing lines are preserved; the new ext_resource is inserted after the
  // last existing one and the node block is appended.
  for(const line of SCENE.split('\n'))if(line)assert.ok(text.includes(line),`preserved: ${line}`);
});

test('a tampered edit is refused after serialization',()=>{
  const planned=plan();
  assert.equal(planned.ok,true);
  const tampered={...planned.edit,properties:{...planned.edit.properties,entity_id:'"old-id"'}};
  assert.throws(()=>applySceneInsertion(SCENE,tampered),/duplicate entity_id values after serialization/);
  const erased={...planned.edit,properties:{...planned.edit.properties,entity_id:'"other-id"'}};
  assert.throws(()=>applySceneInsertion(SCENE,erased),/occurs 0 times after serialization/);
  // A duplicate identity value is refused even when the planned value is gone.
  const duplicated=SCENE.replace('entity_id = "old-id"','entity_id = "old-id"\nentity_id = "old-id"');
  assert.throws(()=>applySceneInsertion(duplicated,planned.edit),/declares entity_id more than once after serialization/);
});

test('CRLF project.godot does not report existing actions as missing',()=>{
  const crlf='[input]\r\ninteract={\r\n"deadzone": 0.2,\r\n"events": []\r\n}\r\n';
  const existing=planInputActions(crlf,['interact']);
  assert.deepEqual(existing.missing,[]);
  assert.equal(existing.edit,null);
  const partial=planInputActions(crlf,['interact','open']);
  assert.deepEqual(partial.missing,['open']);
  const applied=applyInputActions(crlf,partial.edit);
  assert.ok(applied.includes('open={'),'missing action added');
  assert.equal((applied.match(/interact=\{/g)||[]).length,1,'existing action not duplicated');
  assert.ok(!/(?<!\r)\n/.test(applied),'CRLF file stays CRLF');
});

test('CRLF scene insertion introduces no bare LF',()=>{
  const crlf=SCENE.replace(/\n/g,'\r\n');
  const planned=plan({sceneText:crlf});
  assert.equal(planned.ok,true);
  const text=applySceneInsertion(crlf,planned.edit);
  assert.ok(text.includes('\r\n'),'still CRLF');
  assert.ok(!/(?<!\r)\n/.test(text),'no bare LF introduced');
  assert.equal(countIdentity(text,'new-id'),1);
});

test('an existing identity is still refused before any write',()=>{
  const taken=plan({entityId:'old-id'});
  assert.equal(taken.ok,false);
  assert.equal(taken.reason,'identity-taken');
});
