import test from 'node:test';
import assert from 'node:assert/strict';
import {createGodotPackageUI} from '../../plugins/craftmine-world/godot-package-ui.mjs';

// DOM-shaped objects exercise the UI state machine only; no browser or OS input.
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.disabled=false;this.hidden=false;this.textContent='';}
 append(...nodes){for(const node of nodes){this.children.push(node);if(this.tag==='form')node.form=this;}}
 prepend(...nodes){this.children.unshift(...nodes);}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(){}
 get options(){return this.children;}
}
const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
async function fixture(t) {
 const original={document:globalThis.document,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
 const timers=new Map();let next=0;
 globalThis.document={createElement:tag=>new Element(tag)};
 globalThis.setTimeout=fn=>{timers.set(++next,fn);return next;};globalThis.clearTimeout=id=>timers.delete(id);
 t.after(()=>Object.assign(globalThis,original));
 const element=new Element('main'),calls=[],jobId='gjob-'+'a'.repeat(64);let last;
 const state={job:'queued',world:'alpha',fail:false,deferred:null,proposals:[]};
 const ui=createGodotPackageUI({element,getWorldId:()=>state.world,action:run=>(last=run()),request:async(channel,input)=>{
  calls.push(input);const {method}=input;
  if(method==='sourceList')return{revision:1,items:[]};
  if(method==='sourceProposals')return{worldId:state.world,items:state.proposals};
  if(method==='installSourceProposal'){state.proposals=[];return{status:'check-queued',instanceIds:['tree'],job:{id:jobId,status:'queued'}};}
  if(method==='sourceJob'){if(state.deferred)return state.deferred;if(state.fail){state.fail=false;throw Error('TRANSPORT_LOST');}return{worldId:state.world,jobId,status:state.job};}
  return{status:'check-queued',grantId:'opaque-grant',instanceIds:['instance'],job:{id:jobId,status:'queued'}};
 }});
 const nodes=()=>{const walk=n=>[n,...n.children.flatMap(walk)];return walk(element);};
 const button=label=>nodes().find(n=>n.tag==='button'&&n.textContent===label);
 const submit=async label=>{const b=button(label);assert.ok(b&&!b.disabled&&!b.form.hidden,`available: ${label}`);b.form.onsubmit({preventDefault(){}});await last;await drain();};
 const tick=async()=>{const [id,fn]=timers.entries().next().value??[];assert.ok(fn,'scheduled poll');timers.delete(id);fn();await drain();};
 await ui.show();t.after(()=>ui.clear());return{ui,state,calls,timers,button,submit,tick};
}
test('queued/running prevent repeat; failed query retries same job; only terminal unlocks',async t=>{
 const f=await fixture(t);await f.submit('导入作品 ZIP 并检查');
 assert.equal(f.button('再次安装为独立对象').disabled,true);assert.equal(f.button('导入作品 ZIP 并检查').disabled,true);
 f.state.job='running';await f.tick();assert.equal(f.button('再次安装为独立对象').disabled,true);
 f.state.fail=true;await f.tick();assert.equal(f.timers.size,0);assert.equal(f.button('重试查询本次检查').form.hidden,false);
 f.state.job='blocked';await f.submit('重试查询本次检查');assert.equal(f.timers.size,0);assert.equal(f.button('再次安装为独立对象').disabled,true);
 f.state.job='passed';await f.submit('重试查询本次检查');assert.equal(f.button('再次安装为独立对象').disabled,false);
 assert.equal(f.calls.filter(c=>c.method==='importSource').length,1);
 assert.equal(new Set(f.calls.filter(c=>c.method==='sourceJob').map(c=>c.params.jobId)).size,1);
 f.state.job='failed';await f.submit('再次安装为独立对象');assert.equal(f.button('再次安装为独立对象').disabled,false);
 const imports=f.calls.filter(c=>['importSource','repeatImportSource'].includes(c.method));assert.notEqual(imports[0].params.operationId,imports[1].params.operationId);
});

test('a modern source proposal waits for its explicit player action and enters the existing job flow',async t=>{
 const f=await fixture(t);f.state.proposals=[{proposalId:'source-'+'a'.repeat(48),displayName:'精选树',source:{revision:1}}];await f.ui.refresh();
 assert.equal(f.calls.some(c=>c.method==='installSourceProposal'),false);
 await f.submit('安装提案：精选树（源码 1）');assert.equal(f.calls.filter(c=>c.method==='installSourceProposal').length,1);
 assert.equal(f.button('导入作品 ZIP 并检查').disabled,true);assert.equal(f.calls.some(c=>c.method==='importSource'),false);
});
test('unmount clears polling and ignores late terminal receipt; reopening resumes same pending job',async t=>{
 const f=await fixture(t);await f.submit('导入作品 ZIP 并检查');let resolve;
 f.state.deferred=new Promise(r=>{resolve=r;});await f.tick();f.ui.clear();assert.equal(f.timers.size,0);
 resolve({jobId:'gjob-'+'a'.repeat(64),status:'passed'});await drain();assert.equal(f.button('再次安装为独立对象').disabled,true);
 f.state.deferred=null;f.state.job='running';await f.ui.show();await drain();assert.equal(f.button('再次安装为独立对象').disabled,true);assert.equal(f.timers.size,1);
 f.ui.clear();assert.equal(f.timers.size,0);
});
