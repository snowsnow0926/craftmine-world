import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {showWorldTabScript,assertShowWorldIdentity} from './helpers/operator-show-world.mjs';
function fixture({disabled=false,visible=true,handler=true,worldId='world'}={}){
  let selected=false,called=0;const workbench={hidden:false},checks={hidden:true};const button={disabled,getClientRects:()=>visible?[{}]:[],getAttribute:()=>String(selected),...(handler?{onclick:()=>{called++;selected=true;workbench.hidden=true;}}:{})};
  const context={__craftmineHeadless:true,document:{body:{dataset:{worldId}},getElementById:id=>({'world-mode':button,'workbench-panel':workbench,'checks-panel':checks,error:{hidden:true}})[id]},getComputedStyle:()=>({visibility:'visible'})};
  return {context,get called(){return called;}};
}
test('show-world calls only the existing tab callback with no form/world open or input simulation',()=>{
  const f=fixture();const result=vm.runInNewContext(showWorldTabScript('world',true),f.context);assert.equal(f.called,1);assert.equal(result.worldTabSelected,true);assert.equal(result.workbenchHidden,true);assert.equal(result.checksHidden,true);
});
test('disabled, hidden, missing handler or different world cannot bypass the ordinary UI',()=>{
  for(const options of [{disabled:true},{visible:false},{handler:false},{worldId:'other'}]){const f=fixture(options);assert.throws(()=>vm.runInNewContext(showWorldTabScript('world',true),f.context));assert.equal(f.called,0);}
});
test('runtime adoption/restart or session change is a failed identity check rather than a claimed same-world return',()=>{
  const before={worldId:'world',buildId:'build',instanceId:'instance'};assertShowWorldIdentity(before,{...before},'session','session');
  for(const field of ['worldId','buildId','instanceId'])assert.throws(()=>assertShowWorldIdentity(before,{...before,[field]:'changed'},'session','session'));
  assert.throws(()=>assertShowWorldIdentity(before,before,'session','different'));
});
