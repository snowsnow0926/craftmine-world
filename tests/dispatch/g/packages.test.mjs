import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorld,compileVerification,patchDraft,prepareApplication} from '../../../plugins/craftmine-world/domain-adapter.mjs';
const extension={format:'craftmine.extension/1',id:'heal-pulse',name:'治疗',version:1,description:'恢复生命',requires:[],permissions:['health.write'],targets:[],
  provides:{commands:[{type:'pulse.heal',permission:'health.write',scope:'player',fields:[{name:'amount',description:'治疗量'}]}],events:[]},lifecycle:{register:'onLoad',unload:'rejectModules'},
  code:'export function apply({command}) { return {effects:[{type:"health.add",amount:command.amount}],state:{}}; }',
  selfTests:[{name:'生命变化',world:{playerHealth:10,objects:[]},state:{},commands:[{type:'pulse.heal',amount:1}],expect:[{id:'healed',kind:'playerHealth',why:'增加生命',red:'空实现',min:11,step:'command-1'}]}]};
function fixture(){
  const world=emptyWorld('固定依赖');
  const scene=structuredClone(world.build.scene);
  scene.behaviors=[{format:'craftmine.behavior/3',id:'healer',name:'治疗模块',description:'引用固定扩展',code:'export function step({state}) {return {state,commands:[]};}',stateVersion:1,initialState:{},params:{},targets:[],permissions:['health.write'],capabilities:[],requires:['ext:heal-pulse@1'],binding:null,keys:[]}];
  return {world,draft:{scene,extensions:[extension],assets:[]}};
}
test('library draft extension survives compilation, later edits and application preparation',()=>{
  const input=fixture();
  assert.throws(()=>compileVerification({...input,draft:{scene:input.draft.scene}}));
  const artifact=compileVerification(input);assert.equal(artifact.extensions[0].id,'heal-pulse');
  const old=input.draft.scene.behaviors[0];
  const workspace={task:{revision:0,draft:input.draft},reads:{}};
  const patch=patchDraft(workspace,{workspaceRevision:0,operations:[{op:'add',kind:'behavior',id:'healer-two',expectedHash:null,value:{...old,id:'healer-two'}}]},input.world);
  assert.deepEqual(patch.draft.extensions,[extension]);
  assert.equal(compileVerification({...input,draft:patch.draft}).build.scene.behaviors.length,2);
  const job={status:'passed',current:true,input:{worldId:'w',binding:{baseBuild:input.world.build.id}},output:{artifact}};
  assert.deepEqual(prepareApplication(job,{id:'w',world:input.world}).extensions,artifact.extensions);
});
test('immutable extension version conflicts and missing transitive dependencies reject before verification',()=>{
  const input=fixture();input.world.extensions=[{...extension,version:2}];
  assert.throws(()=>compileVerification(input),/版本冲突/);
  input.world.extensions=[];input.draft.extensions=[{...extension,requires:['ext:missing@1']}];
  assert.throws(()=>compileVerification(input),/缺少扩展依赖/);
});
