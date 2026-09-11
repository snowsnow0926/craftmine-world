import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCreationSequenceIntent} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-sequence-intent.ts';
import {freezeCreationRequirements,creationRequirementsHash} from '../vendor/pi-desktop/apps/desktop/electron/main/creation-check-requirements.ts';
const entity=(id,kind,color,label)=>({id,kind,color,position:[1,0,2],scale:[1,1,1],...(label?{parameters:{label}}:{})});
const capture={target:{entityId:'gate',position:[0,0,0]},entities:[entity('gate','door','#0000ff'),entity('red-mark','marker','#ff0000','红'),entity('yellow-mark','marker','#ffff00','黄'),entity('green-mark','marker','#00ff00','绿')]};
test('ordinary sequence wording resolves captured labels and selected or colored doors',()=>{
 for(const input of ['依次触碰红、黄、绿后打开蓝门','请按照红、黄、绿的顺序触发机关，然后打开这扇门。','把这扇门设为依次按下红、黄、绿后才能打开','依次触碰red-mark、yellow-mark、green-mark后打开gate']){
  assert.deepEqual(resolveCreationSequenceIntent(input,capture),{doorId:'gate',steps:['red-mark','yellow-mark','green-mark']},input);
 }
});
test('ambiguity, repeated IDs, negation and additional wishes are not silently reduced',()=>{
 const ambiguous=structuredClone(capture);ambiguous.entities.push(entity('other-red','marker','#ff0000','红'));
 assert.equal(resolveCreationSequenceIntent('依次触碰红、黄后打开蓝门',ambiguous),null);
 for(const input of ['不要依次触碰红、黄后打开蓝门','依次触碰红、红后打开蓝门','依次触碰红、黄后打开蓝门，再给我十枚代币','依次触碰新机关、黄后打开蓝门','按任意顺序触碰红、黄后打开蓝门'])assert.equal(resolveCreationSequenceIntent(input,capture),null,input);
 const wrong=structuredClone(capture);wrong.target.entityId='red-mark';assert.equal(resolveCreationSequenceIntent('依次触碰红、黄后打开这扇门',wrong),null);
 const duplicate=structuredClone(capture);duplicate.entities.push(duplicate.entities[1]);assert.equal(resolveCreationSequenceIntent('依次触碰红、黄后打开蓝门',duplicate),null);
 const malformed=structuredClone(capture);malformed.entities[0].color=123;assert.equal(resolveCreationSequenceIntent('依次触碰红、黄后打开蓝门',malformed),null);
});
test('natural request enters the actual frozen requirement with original text hash and precise identities',()=>{
 const input='请按照红、黄、绿的顺序触发机关，然后打开这扇门。';
 const frozen=freezeCreationRequirements(capture,input);
 assert.equal(frozen.status,'verifiable');assert.equal(frozen.requirements.doorSequence.verifyPassage,true);
 assert.deepEqual(frozen.requirements.doorSequence.steps,['red-mark','yellow-mark','green-mark']);
 assert.equal(frozen.requirements.entities.find(e=>e.id==='gate').kind,'door');
 const second=freezeCreationRequirements(capture,'依次触碰红、黄、绿后打开蓝门');
 assert.notEqual(creationRequirementsHash(frozen.requirements),creationRequirementsHash(second.requirements),'distinct original player inputs retain distinct request hashes');
});
