import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {reviewPrompt} from '../../../plugins/craftmine-world/domain-adapter.mjs';
const {focusedReviewPrompt}=createRequire(import.meta.url)('../../../plugins/craftmine-world/context-review.cjs');
function fixture(){
  const objects=Array.from({length:64},(_,i)=>({id:`object-unique-${i}-end`,name:`Tree ${i}`,position:{x:i,y:6,z:0},parts:[{source:'long geometry'.repeat(350)}]}));
  const before={format:'craftmine.scene/3',title:'Large world',night:false,objects,behaviors:[{id:'behavior',targets:[objects[1].id],code:'function tick(){}'}],systems:[]};
  const after=structuredClone(before);after.objects[0].name='Flower';
  return {input:{origin:{request:{text:'Add a flower'},modelKey:'fixture'},world:{build:{scene:before}}},output:{artifact:{build:{scene:after},diff:{details:{items:[{kind:'object',id:objects[0].id}]}}},evidence:{compiler:{passed:true}}}};
}
test('focus keeps changed resources, behavior dependencies and source provenance without truncating source',()=>{
  const job=fixture();assert.throws(()=>reviewPrompt(job),/REVIEW_INPUT_TOO_LARGE/);
  const prompt=focusedReviewPrompt(job,reviewPrompt),body=JSON.parse(prompt.messages[0].content);
  assert.deepEqual(body.before.objects.map(x=>x.id),['object-unique-0-end','object-unique-1-end']);
  assert.equal(body.before.objects[0].parts[0].source,job.input.world.build.scene.objects[0].parts[0].source);
  assert.equal(body.machineEvidence.reviewScope.omittedBefore.length,62);
  assert.equal(body.machineEvidence.reviewScope.beforeHash.length,64);
  assert.match(prompt.system,/Unchanged|unchanged/);assert.match(prompt.system,/limitations/);
});
test('global environment changes require all geometry and fail bounded when it cannot fit',()=>{
  const job=fixture();job.output.artifact.build.scene.night=true;
  assert.throws(()=>focusedReviewPrompt(job,reviewPrompt),/REVIEW_INPUT_TOO_LARGE/);
});
test('small review remains byte-identical',()=>{
  const job=fixture();job.input.world.build.scene.objects=job.input.world.build.scene.objects.slice(0,2);job.output.artifact.build.scene.objects=job.output.artifact.build.scene.objects.slice(0,2);
  assert.deepEqual(focusedReviewPrompt(job,reviewPrompt),reviewPrompt(job));
});
