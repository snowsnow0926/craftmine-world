import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {BUILDING_ZIP_SHA256,validateModuleBootstrapCall,assertModuleBootstrapPackages} from './module-player-bootstrap-contract.mjs';
const worldId='world-test',jobId='gjob-'+'a'.repeat(64),manifestHash='b'.repeat(64);
function entry(slot,index){
 const instance='ins-building-'+index,candidateId='candidate-'+index,buildId='build-'+index,instanceJob='gjob-'+String(index).repeat(64);
 const imported={worldId,operationId:'operation-'+index,instanceIds:[instance],status:'check-queued',applied:false,source:{revision:index,manifestHash},job:{id:instanceJob}};
 const checked={worldId,jobId:instanceJob,kind:'check',status:'passed',sourceRevision:index,manifestHash,executorId:'craftmine-windows-broker-v1',candidateId,buildId,
  output:{passed:true,import:{passed:true},compile:{passed:true},check:{passed:true,assertions:['runtime.ready','runtime.frame','runtime.no-errors','runtime.snapshot','runtime.isolation','runtime.recovery'].map(id=>({id,passed:true}))}}};
 return{slot,kind:'building',archiveSha256:BUILDING_ZIP_SHA256,imported,checked,preview:{buildId},applied:{status:'applied',worldId,candidateId,record:{world:{build:{id:buildId}}}},observed:{worldId,buildId},sources:{items:[{entityId:instance+'-e0'}]}};
}
function fixture(){
 const packages=[entry('A',1),entry('B',2)];
 return{format:'craftmine.module-player-bootstrap/1',worldId,modelRequestsStarted:0,directSourceEditsByHarness:0,syntheticCaptures:0,packages,finalSources:{items:packages.flatMap(item=>item.sources.items)},
  sessionId:'ordinary-session',session:{format:'craftmine.ordinary-player-session/1',worldId,sessionId:'ordinary-session',creation:'ordinary-sessionCreate',modelRequestsStarted:0},
  calls:[{method:'playerCreateSession',fields:{payload:{worldId,title:'Ordinary session'}},worldId}]};
}
test('closed bootstrap requests permit ordinary import/check/adoption and reject model/eval/source/capture injection',()=>{
 for(const [method,fields]of [
  ['status',{}],['primaryMode',{payload:{action:'create'}}],['worldNavigationReady',{}],
  ['worldNavigation',{channel:'world.create',payload:{title:'two buildings',baseId:'creation-sandbox',starterId:'blank',operationId:'operation-one'}}],
  ['worldNavigation',{channel:'godot.historyJob',payload:{worldId,jobId}}],
  ['worldPanel',{channel:'package.request',payload:{worldId,method:'importSource',params:{worldId,operationId:'operation-one'}}}],
  ['worldPanel',{channel:'godot.candidateApply',payload:{worldId,candidateId:'candidate-one'}}],
  ['playerCreateSession',{payload:{worldId,title:'Ordinary'}}],['quit',{}],
 ])assert.doesNotThrow(()=>validateModuleBootstrapCall(method,fields,worldId));
 for(const [method,fields]of [
  ['playerPrompt',{payload:{worldId,text:'run'}}],['playerSetup',{payload:{worldId,secret:'not-permitted'}}],['eval',{script:'arbitrary'}],
  ['worldPanel',{channel:'godot_project_patch',payload:{worldId,operations:[]}}],
  ['worldNavigation',{channel:'godotProject.patch',payload:{worldId}}],
  ['worldPanel',{channel:'package.request',payload:{worldId,method:'installSource',params:{worldId,archiveBase64:'anything'}}}],
  ['worldPanel',{channel:'package.request',payload:{worldId,method:'importSource',params:{worldId,operationId:'operation-one',path:'C:/anything'}}}],
  ['worldPanel',{channel:'godot.runtimeSave',payload:{worldId:'another',freeze:true}}],
  ['playerCreateSession',{payload:{worldId,title:'Ordinary',capture:{synthetic:true}}}],
  ['godotObserve',{payload:{override:{}}}],
 ])assert.throws(()=>validateModuleBootstrapCall(method,fields,worldId));
});
test('two independent instances must each have their own exact successful check and adopted build',()=>{
 const report=fixture();assert.deepEqual(assertModuleBootstrapPackages(report),['ins-building-1-e0','ins-building-2-e0']);
 for(const mutate of [
  r=>{r.packages[1].archiveSha256='c'.repeat(64);},
  r=>{r.packages[1].imported.instanceIds=r.packages[0].imported.instanceIds;},
  r=>{r.packages[1].checked.status='blocked';},
  r=>{r.packages[1].slot='A';},
  r=>{r.packages[1].checked.sourceRevision=999;},
  r=>{r.packages[1].checked.output.check.assertions[0].passed=false;},
  r=>{r.packages[1].observed.buildId='old';},
  r=>{r.finalSources.items=[];},
  r=>{r.session.worldId='other';},r=>{r.modelRequestsStarted=1;},r=>{r.syntheticCaptures=1;},
 ]){
  const value=fixture();mutate(value);assert.throws(()=>assertModuleBootstrapPackages(value));
 }
});
test('bootstrap is a separate existing-API driver and does not implement a model or raw-source route',()=>{
 const source=fs.readFileSync(new URL('./module-player-bootstrap.mjs',import.meta.url),'utf8');
 assert.ok(source.includes('validateModuleBootstrapCall(method,fields,report.worldId)'));
 assert.ok(source.includes("await until(()=>rpc('worldNavigationReady'),value=>value.ready"));
 assert.ok(source.includes("rpc('playerCreateSession'"));
 for(const forbidden of ["rpc('playerPrompt'","rpc('playerSetup'","godotProject.patch","executeJavaScript","evaluate(",".mouse.",".keyboard."])assert.ok(!source.includes(forbidden),forbidden);
 assert.ok(source.includes('assertCleanHeadlessShutdown'));
});
