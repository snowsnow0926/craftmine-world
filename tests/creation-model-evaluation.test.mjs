import assert from 'node:assert/strict';
import test from 'node:test';
import {CREATION_MODEL_CASES,MODEL_LIMITS,classifyModelCase,summarizeModelCases,inspectCreationOutcome,countModelRepairs,completeCreationProgress} from './helpers/creation-model-evaluation.mjs';
test('fixed next-batch suite has bounded distinct original inputs',()=>{
  assert.equal(new Set(CREATION_MODEL_CASES.map(item=>item.id)).size,8);
  assert.equal(CREATION_MODEL_CASES.find(item=>item.id==='CA05').request.includes('5秒'),true);
  assert.equal(MODEL_LIMITS.maxRequests,40);assert.equal(MODEL_LIMITS.maxCaseMs,600000);assert.equal(MODEL_LIMITS.maxRepairs,3);
});
test('model completion text and empty evidence cannot pass a real-model evaluation',()=>{
  assert.equal(classifyModelCase({submitted:true,modelRequests:1,checks:[]}), 'failed');
  assert.equal(classifyModelCase({submitted:true,modelRequests:0,checks:[{passed:true}]}),'failed');
  assert.equal(classifyModelCase({submitted:true,modelRequests:2,checks:[{passed:true},{passed:false}]}),'failed');
});
test('first attempt repair human intervention and environment failures are separate classes',()=>{
  const passed={submitted:true,modelRequests:2,checks:[{passed:true}]};
  assert.equal(classifyModelCase(passed),'first_attempt_pass');
  assert.equal(classifyModelCase({...passed,repairAttempts:1}),'model_repaired_pass');
  assert.equal(classifyModelCase({...passed,humanIntervention:true}),'human_assisted_pass');
  assert.equal(classifyModelCase({...passed,error:'INVALID_API_KEY'}),'environment_blocked');
  assert.equal(classifyModelCase({...passed,error:'EVALUATION_CASE_TIMEOUT'}),'failed');
  assert.equal(classifyModelCase({}),'not_run');
});
test('aggregate uses eligible real runs only and leaves unreported cost unknown',()=>{
  const report=summarizeModelCases([{outcome:'first_attempt_pass',modelRequests:2},{outcome:'model_repaired_pass',modelRequests:4},{outcome:'failed',modelRequests:1},{outcome:'environment_blocked',modelRequests:1},{outcome:'not_run',modelRequests:0}]);
  assert.equal(report.realModelRuns,4);assert.equal(report.denominator,3);assert.equal(report.firstAttemptRate,1/3);assert.equal(report.autonomousCompletionRate,2/3);assert.equal(report.requestCount,8);assert.equal(report.cost,null);
  assert.equal(summarizeModelCases([]).firstAttemptRate,null);
});
test('polling is not a repair and duplicate transcript rows are not counted twice',()=>{
  const rows=[{role:'tool',id:'one',toolName:'godot_build_read',toolStatus:'success',toolResult:{status:'running'}},{role:'tool',id:'two',toolName:'godot_build_read',toolStatus:'success',toolResult:{status:'failed'}},{role:'tool',id:'three',toolName:'godot_project_patch',toolStatus:'success'}];
  assert.equal(countModelRepairs(rows),1);assert.equal(countModelRepairs([...rows,...rows]),1);assert.equal(countModelRepairs(rows.slice(0,1)),0);
  assert.equal(countModelRepairs([{...rows[1],toolResult:{content:[{type:'text',text:'{"status":"failed"}'}]}},rows[2]]),1);
});
const tree={id:'tree-a',kind:'tree',position:[2,0,1],scale:[1,1,1],rotationY:0,color:'#88bb44'};
const obstacle={entityId:'tree-a',min:[1.5,0,.5],max:[2.5,3,1.5]};
const observe=(entities,buildId,instanceId,obstacles=[])=>({baseId:'creation-sandbox',worldId:'world-a',buildId,instanceId,payload:{creation:{entities,obstacles,timeOfDay:12}}});
const progress=()=>({format:'craftmine.godot-progress/1',baseId:'creation-sandbox',worldId:'world-a',body:{format:'craftmine.creation-progress/1',worldId:'world-a',player:{position:[0,.9,6]},inventory:{},openedChests:{},rules:{},timeOfDay:12,sourceTimeOfDay:12}});
function fixture(){return {caseId:'CA01',before:observe([],'base-build','before'),after:observe([tree],'new-build','after',[obstacle]),target:{target:{surface:'ground',position:[2,0,1]}},beforeProgress:progress(),afterProgress:progress(),job:{kind:'check',status:'passed',worldId:'world-a',buildId:'new-build',output:{check:{assertions:[{id:'runtime.boot',passed:true}]}}},reopened:observe([tree],'new-build','restarted',[obstacle]),restoredProgress:progress()};}
test('CA01 needs actual candidate identity collision matching target and complete fresh-process state',()=>{
  assert.equal(inspectCreationOutcome(fixture()).every(item=>item.passed),true);
  for(const mutate of [f=>f.after.buildId='base-build',f=>f.job.output.check.assertions=[],f=>f.after.payload.creation.obstacles=[],f=>f.target.target.position=[9,0,1],f=>f.reopened.instanceId='after',f=>f.restoredProgress.body.inventory.wood=1]){
    const input=fixture();mutate(input);assert.equal(inspectCreationOutcome(input).some(item=>!item.passed),true);
  }
});
test('CA02 checks same object and actual double collision height, not prose or declared scale alone',()=>{
  const input=fixture();input.caseId='CA02';input.before=observe([tree],'base-build','before',[obstacle]);input.target.target.entityId='tree-a';input.target.target.surface='entity';
  input.after.payload.creation.entities=[{...tree,scale:[2,2,2]}];input.after.payload.creation.obstacles=[{...obstacle,max:[2.5,6,1.5]}];input.reopened=structuredClone(input.after);input.reopened.instanceId='restarted';
  assert.equal(inspectCreationOutcome(input).every(item=>item.passed),true);
  input.after.payload.creation.obstacles=[obstacle];assert.equal(inspectCreationOutcome(input).find(item=>item.name==='actual-double-height').passed,false);
});
test('observation-only state can never substitute for complete progress',()=>{
  assert.throws(()=>completeCreationProgress({worldId:'world-a',payload:{inventory:{}}}));assert.deepEqual(completeCreationProgress({state:progress()}),progress());
});
