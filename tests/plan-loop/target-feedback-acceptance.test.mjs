import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const {build}=createRequire(path.resolve(process.env.CRAFTMINE_DEPS_ROOT||'vendor/pi-desktop/apps/desktop','package.json'))('esbuild');
const result=await build({entryPoints:['vendor/pi-desktop/apps/desktop/electron/main/craftmine-target-feedback-acceptance.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {targetFeedbackProbeScript}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
function fixture(){
 const f={submissions:[],events:[],surfaces:[],hidden:false,field:{value:'500'},select:{value:'target_a',disabled:false,options:[{value:'target_a'},{value:'target_b'}]},worldId:'alpha'};
 const make=name=>{const button={disabled:false};button.form={requestSubmit:(actual)=>{assert.equal(actual,button);f.submissions.push(name);if(name==='default')f.field.value='250';}};return button;};f.defaults=make('default');f.submit=make('submit');f.select.dispatchEvent=e=>f.events.push(e.type);
 const map={'select':f.select,'[data-target-feedback-value]':f.field,'[data-target-feedback-default]':f.defaults,'[data-target-feedback-submit]':f.submit,'[data-target-feedback-default-source]':{textContent:'verified source250'},'[role="status"]':{textContent:'status'}};
 f.area={closest:()=>f.hidden?{}:null,contains:form=>form===f.defaults.form||form===f.submit.form,querySelector:key=>map[key]};
 f.context={__craftmineHeadless:{pointerLock:0,focus:0},Event:class{constructor(type){this.type=type;}},document:{body:{dataset:{get worldId(){return f.worldId;}}},querySelector:()=>f.area},craftmineView:{showSurface:async value=>{f.surfaces.push(value);f.hidden=value.surface.kind==='world';if(f.switchDuringOpen)f.worldId='beta';}}};
 f.run=(action,args={})=>vm.runInNewContext(targetFeedbackProbeScript({action,worldId:'alpha',...args}),f.context);return f;
}
test('probe accepts only finite actions and observed target identity, not arbitrary data or code',()=>{
 for(const input of [null,[],{}, {action:[],worldId:'alpha'}, {action:'eval',worldId:'alpha'}, {action:'read',worldId:'../beta'}, {action:'read',worldId:'alpha',targetId:'target_a'}, {action:'select',worldId:'alpha'}, {action:'useDefault',worldId:'alpha',value:120}, {action:'submit',worldId:'alpha',script:'fetch()'}, {action:'read',worldId:'alpha',selector:'body'}])assert.throws(()=>targetFeedbackProbeScript(input),/INVALID_TARGET_FEEDBACK_PROBE/);
});
test('real helper uses fixed form requestSubmit and never a mutation RPC or caller value',async()=>{
 const f=fixture();await f.run('open');await f.run('select',{targetId:'target_b'});assert.equal(f.select.value,'target_b');assert.deepEqual(f.events,['change']);const value=await f.run('useDefault');assert.equal(value.value,'250');assert.deepEqual(f.submissions,['default']);await f.run('submit');assert.deepEqual(f.submissions,['default','submit']);await f.run('read');assert.equal(f.submissions.length,2);await f.run('close');assert.equal(f.surfaces.length,2);assert.equal(f.hidden,true);
});
test('guard, world binding, unknown target, hidden or disabled forms and detached forms refuse before submit',async()=>{
 const cases=[f=>delete f.context.__craftmineHeadless,f=>f.worldId='beta',f=>f.hidden=true,f=>f.defaults.disabled=true,f=>f.area.contains=()=>false];
 for(const mutate of cases){const f=fixture();mutate(f);await assert.rejects(f.run('useDefault'));assert.deepEqual(f.submissions,[]);}
 const f=fixture();await assert.rejects(f.run('select',{targetId:'unobserved'}),/TARGET_FEEDBACK_PROBE_TARGET_UNAVAILABLE/);assert.equal(f.select.value,'target_a');f.select.disabled=true;await assert.rejects(f.run('select',{targetId:'target_b'}));assert.equal(f.events.length,0);
});
test('world change during awaited navigation rejects and fixed read projection stays bounded',async()=>{
 const f=fixture();f.switchDuringOpen=true;await assert.rejects(f.run('open'),/GODOT_WORLD_CHANGED/);assert.equal(f.submissions.length,0);
 const g=fixture();g.select.options=Array.from({length:200},(_,i)=>({value:'target_'+i}));const value=await g.run('read');assert.equal(value.targets.length,64);assert.equal(g.submissions.length,0);
});
