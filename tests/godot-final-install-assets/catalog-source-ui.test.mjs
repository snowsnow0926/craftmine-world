import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {createGodotPackageUI} from '../../plugins/craftmine-world/godot-package-ui.mjs';
register(new URL('../../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {createCraftminePanelGateway}=await import('../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-panel-gateway.ts');

// DOM state tests pass reads through the actual Main gateway and asset panel.
// No engine, model, filesystem grant, input, or renderer IPC privilege is used.
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.disabled=false;this.hidden=false;this.textContent='';this.value='';}
 append(...nodes){for(const node of nodes){this.children.push(node);if(this.tag==='form')node.form=this;}}
 prepend(...nodes){this.children.unshift(...nodes);}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(){}
 get options(){return this.children;}
}
const a={assetId:'kenney-building',version:2,contentHash:'a'.repeat(64)},b={assetId:'kenney-road',version:1,contentHash:'b'.repeat(64)};
const archive='c'.repeat(64),jobId='gjob-'+'d'.repeat(64);
const record=ref=>({version_:{...ref,mediaKind:'package',fileCount:1,displayName:'Kenney <script>source</script>',source:{origin:'https://example.invalid/source',author:'Kenney',license:'CC0; code MIT',licenseStatus:'unverified'},files:[{path:'component.zip',sha256:archive,bytes:23409,mediaType:'application/zip'}]},state:{indexed:true,previewable:false,baseChecked:null,appliedToSource:null}});
const drain=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
async function fixture(t){
 const original={document:globalThis.document,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
 const timers=new Map();let next=0;
 globalThis.document={createElement:tag=>new Element(tag)};globalThis.setTimeout=fn=>{timers.set(++next,fn);return next;};globalThis.clearTimeout=id=>timers.delete(id);
 t.after(()=>Object.assign(globalThis,original));
 const element=new Element('main'),calls=[],domainCalls=[],state={world:'alpha',session:'session-a',job:'passed',active:false,search:null,read:null,install:null};let last;
 const gateway=createCraftminePanelGateway({viewingSession:()=>state.session,session:async id=>({id}),activeTurn:()=>state.active?'turn-active':undefined,
  domain:async(method,params)=>{
   domainCalls.push({method,params:structuredClone(params)});
   if(method==='selection.read')return {worldId:state.world};
   assert.equal(method,'asset.request');
   if(params.method==='search')return state.search?state.search(params.args):{items:[{...a,displayName:'建筑'},{...b,displayName:'道路'}],total:2,nextOffset:null,truncated:false};
   assert.equal(params.method,'read');return state.read?state.read(params.args):record(params.args.assetId===a.assetId?a:b);
  },
  packages:async(channel,input)=>{
   const {method,params}=input;
   if(method==='sourceList')return {worldId:state.world,revision:1,items:[]};
   if(method==='sourceJob')return {worldId:state.world,jobId,status:state.job};
   assert.equal(method,'importCatalogSource');
   if(state.install)return state.install(params);
   return {status:'check-queued',applied:false,worldId:state.world,operationId:params.operationId,catalogRef:params.ref,archiveSha256:archive,grantId:'catalog-opaque',instanceIds:['independent-instance'],job:{id:jobId,status:'queued'}};
  }});
 const ui=createGodotPackageUI({element,getWorldId:()=>state.world,action:run=>(last=run()),request:async(channel,input)=>{calls.push({channel,input:structuredClone(input)});return gateway(channel,input);}});
 const nodes=()=>{const walk=n=>[n,...n.children.flatMap(walk)];return walk(element);};
 const button=label=>nodes().find(n=>n.tag==='button'&&n.textContent===label);
 const control=label=>nodes().find(n=>n.tag==='label'&&n.children[0]?.textContent===label)?.children[1];
 const start=label=>{const node=button(label);assert.ok(node&&!node.disabled&&!node.form.hidden,'available: '+label);node.form.onsubmit({preventDefault(){}});return last;};
 const submit=async label=>{await start(label);await drain();};
 const tick=async()=>{const [id,fn]=timers.entries().next().value??[];assert.ok(fn);timers.delete(id);fn();await drain();};
 await ui.show();t.after(()=>ui.clear());return{ui,state,calls,domainCalls,nodes,button,control,start,submit,tick,timers};
}
const choose=async f=>{await f.submit('检索资源库');await f.submit('核对所选版本');};
test('real gateway accepts owner-bound search/read, fixed versions and filtered pagination before explicit install',async t=>{
 const f=await fixture(t);
 assert.equal(f.calls.some(c=>c.channel.startsWith('asset.')),false,'opening does not choose a resource');
 assert.equal(f.button('安装所选资源库 ZIP 并检查').disabled,true);
 f.state.search=args=>({items:[{...(args.offset?a:b),displayName:'包'}],total:21,nextOffset:args.offset?null:20,truncated:true});
 f.control('作品名称或编号').value='kenney';f.control('作品类型').value='object';
 await f.submit('检索资源库');
 f.control('作品名称或编号').value='unsubmitted edit';
 await f.submit('下一页资源');
 const queries=f.calls.filter(c=>c.channel==='asset.search');
 assert.deepEqual(queries.map(c=>c.input.offset),[0,20]);
 assert.ok(queries.every(c=>c.input.ownerWorldId==='alpha'&&!Object.hasOwn(c.input,'worldId')&&c.input.query==='kenney'&&c.input.kind==='object'&&c.input.latestOnly===false));
 assert.ok(f.nodes().some(n=>n.textContent.includes('结果可能不完整')));
 await f.submit('核对所选版本');
 assert.deepEqual(f.calls.find(c=>c.channel==='asset.read').input,{ownerWorldId:'alpha',assetId:a.assetId,version:2});
 assert.ok(f.nodes().some(n=>n.textContent==='资源库版本哈希：'+a.contentHash));
 assert.ok(f.nodes().some(n=>n.textContent==='ZIP 文件 SHA-256：'+archive));
 assert.ok(f.nodes().some(n=>n.textContent.includes('尚未经过本次安装检查')));
 assert.equal(f.calls.filter(c=>c.input.method==='importCatalogSource').length,0);
 await f.submit('安装所选资源库 ZIP 并检查');
 const installed=f.calls.find(c=>c.input.method==='importCatalogSource').input;
 assert.deepEqual(installed.params.ref,a);
 assert.deepEqual(Object.keys(installed.params).sort(),['operationId','ref','worldId']);
 assert.match(installed.params.operationId,/^[a-f0-9-]{36}$/);
 assert.equal(f.button('再次安装为独立对象').disabled,false);
 await f.submit('再次安装为独立对象');
 const imports=f.calls.filter(c=>c.input.method==='importCatalogSource');
 assert.notEqual(imports[0].input.params.operationId,imports[1].input.params.operationId);
 assert.deepEqual(imports[1].input.params.ref,a);
 assert.equal(f.calls.filter(c=>c.input.method==='repeatImportSource').length,0);
});
test('read identity, single-ZIP shape, MIME and size are required; choosing another row clears acceptance',async t=>{
 const f=await fixture(t);await f.submit('检索资源库');
 for(const mutate of [
  r=>{r.version_.contentHash=b.contentHash;},
  r=>{r.version_.version=3;},
  r=>{r.version_.files.push({...r.version_.files[0],path:'second.zip'});},
  r=>{r.version_.files[0].mediaType='application/x-godot-package';},
  r=>{r.version_.files[0].bytes=5*1024*1024+1;},
  r=>{r.version_.mediaKind='model';},
 ]){
  f.state.read=()=>{const r=record(a);mutate(r);return r;};
  await assert.rejects(f.start('核对所选版本'));assert.equal(f.button('安装所选资源库 ZIP 并检查').disabled,true);
 }
 f.state.read=null;await f.submit('核对所选版本');assert.equal(f.button('安装所选资源库 ZIP 并检查').disabled,false);
 const choices=f.control('资源库固定版本');choices.value='1';choices.onchange();
 assert.equal(f.button('安装所选资源库 ZIP 并检查').disabled,true);
 assert.equal(f.calls.filter(c=>c.input.method==='importCatalogSource').length,0);
});
test('same asset v1 remains selectable when v2 is latest; page transitions invalidate the accepted selection',async t=>{
 const f=await fixture(t),old={...a,version:1,contentHash:'1'.repeat(64)};
 f.state.search=args=>({items:args.offset?[b]:[a,old],total:21,nextOffset:args.offset?null:20,truncated:false});
 f.state.read=args=>record(args.version===1?old:a);
 f.control('作品名称或编号').value=a.assetId;await f.submit('检索资源库');
 f.control('资源库固定版本').value='1';f.control('资源库固定版本').onchange();
 await f.submit('核对所选版本');assert.equal(f.button('安装所选资源库 ZIP 并检查').disabled,false);
 await f.submit('下一页资源');assert.equal(f.button('安装所选资源库 ZIP 并检查').disabled,true);
 await f.submit('上一页资源');f.control('资源库固定版本').value='1';f.control('资源库固定版本').onchange();
 await f.submit('核对所选版本');await f.submit('安装所选资源库 ZIP 并检查');
 assert.deepEqual(f.calls.find(c=>c.input.method==='importCatalogSource').input.params.ref,old);
 assert.ok(f.calls.filter(c=>c.channel==='asset.read').every(c=>c.input.version===1));
});
test('lost or malformed receipts keep original operation/ref even after another resource is inspected',async t=>{
 const f=await fixture(t);await choose(f);
 let first=true;
 f.state.install=async params=>{
  if(first){first=false;throw Error('TRANSPORT_LOST');}
  return {status:'check-queued',applied:false,worldId:'alpha',operationId:params.operationId,catalogRef:params.ref,archiveSha256:archive,instanceIds:['instance'],job:{id:jobId}};
 };
 await assert.rejects(f.start('安装所选资源库 ZIP 并检查'),/TRANSPORT_LOST/);
 assert.equal(f.button('导入作品 ZIP 并检查').disabled,true);
 assert.equal(f.button('安装所选资源库 ZIP 并检查').disabled,true);
 f.control('资源库固定版本').value='1';f.control('资源库固定版本').onchange();await f.submit('核对所选版本');
 await f.submit('重试确认上次安装');
 const imports=f.calls.filter(c=>c.input.method==='importCatalogSource').map(c=>c.input.params);
 assert.deepEqual(imports[0],imports[1]);assert.deepEqual(imports[1].ref,a);
 f.state.install=params=>({status:'check-queued',applied:false,worldId:'alpha',operationId:params.operationId,catalogRef:params.ref,archiveSha256:'e'.repeat(64),instanceIds:['instance'],job:{id:jobId}});
 await assert.rejects(f.start('再次安装为独立对象'),/PACKAGE_INSTALL_RECEIPT_INVALID/);
 assert.equal(f.button('重试确认上次安装').form.hidden,false);
 assert.equal(f.button('安装所选资源库 ZIP 并检查').disabled,true);
});
test('queued and blocked checks prevent catalog reinstallation until the same job is terminal',async t=>{
 const f=await fixture(t);f.state.job='queued';await choose(f);await f.submit('安装所选资源库 ZIP 并检查');
 assert.equal(f.button('再次安装为独立对象').disabled,true);assert.equal(f.button('安装所选资源库 ZIP 并检查').disabled,true);
 f.state.job='blocked';await f.tick();assert.equal(f.button('重试查询本次检查').form.hidden,false);
 f.state.job='passed';await f.submit('重试查询本次检查');assert.equal(f.button('再次安装为独立对象').disabled,false);
 assert.equal(new Set(f.calls.filter(c=>c.input.method==='sourceJob').map(c=>c.input.params.jobId)).size,1);
});
test('only exact first-attempt preflight refusal unlocks another choice; unknown history always preserves the operation',async t=>{
 const f=await fixture(t);
 for(const code of ['PACKAGE_CATALOG_IDENTITY_MISMATCH','PACKAGE_CATALOG_SINGLE_ZIP_REQUIRED','PACKAGE_CATALOG_ZIP_INVALID','PACKAGE_CATALOG_BODY_MISMATCH','PACKAGE_CATALOG_BLOB_MISMATCH']){
  await choose(f);f.state.install=()=>{throw Object.assign(Error('refused'),{code});};
  await assert.rejects(f.start('安装所选资源库 ZIP 并检查'));
  assert.equal(f.button('重试确认上次安装').form.hidden,true);
  assert.equal(f.button('导入作品 ZIP 并检查').disabled,false);
  assert.equal(f.button('安装所选资源库 ZIP 并检查').disabled,true,'new selection must be verified');
 }
 await choose(f);f.state.install=()=>{throw Error('timeout: PACKAGE_CATALOG_BODY_MISMATCH');};
 await assert.rejects(f.start('安装所选资源库 ZIP 并检查'));
 assert.equal(f.button('重试确认上次安装').form.hidden,false,'substring is not a safe error code');
 const original=f.calls.filter(c=>c.input.method==='importCatalogSource').at(-1).input.params;
 f.ui.clear();await f.ui.show();
 f.state.install=()=>{throw Object.assign(Error('PACKAGE_CATALOG_BLOB_MISMATCH'),{errorCode:'PACKAGE_CATALOG_BLOB_MISMATCH'});};
 await assert.rejects(f.start('重试确认上次安装'));
 assert.equal(f.button('重试确认上次安装').form.hidden,false);
 assert.equal(f.button('导入作品 ZIP 并检查').disabled,true);
 assert.deepEqual(f.calls.filter(c=>c.input.method==='importCatalogSource').at(-1).input.params,original);
});
test('wrong ref, owner, operation, status or absent job never release an uncertain catalog operation',async t=>{
 const f=await fixture(t);await choose(f);let installed=false,operation;
 for(const mutate of [
  r=>{r.catalogRef=b;},r=>{r.worldId='other';},r=>{r.operationId='other-operation';},
  r=>{r.status='cancelled';},r=>{r.status='unexpected';},r=>{r.job={};},r=>{r.applied=true;},
 ]){
  f.state.install=params=>{
   operation??=params.operationId;assert.equal(params.operationId,operation);
   const receipt={status:'check-queued',applied:false,worldId:'alpha',operationId:params.operationId,catalogRef:params.ref,archiveSha256:archive,instanceIds:['instance'],job:{id:jobId}};
   mutate(receipt);return receipt;
  };
  await assert.rejects(f.start(installed?'重试确认上次安装':'安装所选资源库 ZIP 并检查'),/PACKAGE_INSTALL_RECEIPT_INVALID/);installed=true;
  assert.equal(f.button('导入作品 ZIP 并检查').disabled,true);assert.equal(f.button('重试确认上次安装').form.hidden,false);
 }
});
test('late reads and switched Main sessions never enable a stale selection; new worlds lose old retry state',async t=>{
 const f=await fixture(t);await f.submit('检索资源库');
 let resolve;f.state.read=()=>new Promise(r=>resolve=r);
 const reading=f.start('核对所选版本');await drain();
 f.state.world='beta';f.ui.clear();await f.ui.show();resolve(record(a));
 await assert.rejects(reading,/OWNER_CHANGED|WORLD_CHANGED/);
 assert.equal(f.button('安装所选资源库 ZIP 并检查').disabled,true);
 f.state.read=()=>{f.state.session='session-b';return record(a);};await f.submit('检索资源库');
 await assert.rejects(f.start('核对所选版本'),/OWNER_CHANGED/);
 assert.equal(f.button('安装所选资源库 ZIP 并检查').disabled,true);
 f.state.read=null;await f.submit('核对所选版本');
 f.state.active=true;await assert.rejects(f.start('安装所选资源库 ZIP 并检查'),/ACTIVE_TASK_EXISTS/);
 assert.equal(f.button('重试确认上次安装').form.hidden,false);
 f.state.active=false;f.state.world='gamma';f.ui.clear();await f.ui.show();
 assert.equal(f.button('重试确认上次安装').form.hidden,true);assert.equal(f.button('再次安装为独立对象').disabled,true);
});
