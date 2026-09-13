import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter,once} from 'node:events';
import {spawn} from 'node:child_process';
import {CodexAppServer,MODEL,EFFORT,LOCKED_CONFIG,processEnvironment,redact,tomlValue} from '../scripts/lib/codex-app-server.mjs';
import {CodexWorldSession,STATE_FORMAT,readState,writeState,toolOutput,acquireLock} from '../scripts/lib/codex-world-session.mjs';

const results=path.resolve('test-results');fs.mkdirSync(results,{recursive:true});
function directory(t) {
  const data=fs.mkdtempSync(path.join(results,'codex-unit-'));fs.mkdirSync(path.join(data,'empty'));
  t.after(()=>{assert(path.resolve(data).startsWith(results+path.sep));fs.rmSync(data,{recursive:true,force:true});});return data;
}
class FakeClient extends EventEmitter {
  constructor(){super();this.calls=[];this.responses=[];this.sequence=0;this.threadConfig=LOCKED_CONFIG;this.model=MODEL;}
  async start(){}
  async call(method,params){
    this.calls.push({method,params});
    if(method==='thread/start'||method==='thread/resume')return {thread:{id:'thread-a',turns:[]},model:this.model,reasoningEffort:EFFORT,modelProvider:'openai',sandbox:{type:'readOnly'},approvalPolicy:'never',instructionSources:[]};
    if(method==='turn/start'){
      const id='turn-'+(++this.sequence);this.turnId=id;
      this.emit('notification',{method:'turn/started',params:{threadId:'thread-a',turn:{id}}});
      return {turn:{id,status:'inProgress'}};
    }
    return {};
  }
  respond(id,result){this.responses.push({id,result});this.emit('response',result);}
  reject(id){this.responses.push({id,denied:true});}
  tool(name,args={},overrides={}){this.emit('request',{id:'req-'+this.responses.length,method:'item/tool/call',params:{threadId:'thread-a',turnId:this.turnId,callId:'call-'+this.responses.length,tool:name,namespace:'craftmine',arguments:args,...overrides}});}
  complete(status='completed'){this.emit('notification',{method:'turn/completed',params:{threadId:'thread-a',turn:{id:this.turnId,status}}});}
}
function fixture(t,{execute=async()=>({revision:2}),state:overrides={}}={}) {
  const data=directory(t),events=[],executions=[],ends=[],begins=[];
  const state={format:STATE_FORMAT,model:MODEL,effort:EFFORT,worldId:'world-a',projectId:'project-a',sessionId:'session-a',coreData:path.join(data,'core'),sourceIdentity:{worldId:'world-a',repoId:'source-a',backend:'git'},...overrides};
  const client=new FakeClient();
  const host={
    tools:[{name:'godot_project_patch',description:'Patch bound source',schema:{type:'object',properties:{files:{type:'array'}},additionalProperties:false},execute:async(args,context)=>{
      if(Object.keys(args).some(k=>k!=='files'))throw Error('INVALID_ARGUMENTS');executions.push({args,context});return execute(args,context);
    }}],
    sourceIdentity:async()=>state.sourceIdentity,
    begin:async(context,text)=>{begins.push({context,text});return {world:{id:state.worldId},binding:context,generation:1};},
    end:async(context,status)=>{ends.push({context,status});},
  };
  const session=new CodexWorldSession({data,state,host,client,onEvent:e=>events.push(e)});
  return {data,state,host,client,session,events,executions,ends,begins};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('real hidden subprocess protocol: handshake, multiplexing, RPC failure, stderr exclusion and cleanup (mock server)',async t=>{
  const cwd=directory(t),spawns=[];
  const client=new CodexAppServer({binary:'fixture',cwd,spawnProcess:(binary,args,options)=>{
    spawns.push({binary,args,options});return spawn(process.execPath,[path.resolve('tests/fixtures/codex-app-server.cjs')],options);
  }});
  t.after(()=>client.close());
  await client.start();
  assert.equal(client.threadConfig['mcp_servers.private_server.enabled'],false);
  assert.equal(spawns[0].options.windowsHide,true);assert.equal(spawns[0].options.shell,false);
  assert.equal(spawns[0].options.env.OPENAI_API_KEY,undefined);
  const [a,b]=await Promise.all([client.call('fixture/echo',{a:1}),client.call('fixture/echo',{b:2})]);
  assert.deepEqual(a,{a:1});assert.deepEqual(b,{b:2});
  await assert.rejects(client.call('fixture/error',{}),/CODEX_RPC_ERROR:-32602/);
  assert.deepEqual(await client.call('fixture/stderr',{}),{ok:true});
  await client.close();assert.equal(client.pending.size,0);
});
for(const method of ['fixture/malformed','fixture/exit'])test('pending requests reject on '+method,async t=>{
  const client=new CodexAppServer({binary:'fixture',cwd:directory(t),spawnProcess:(_bin,_args,opts)=>spawn(process.execPath,[path.resolve('tests/fixtures/codex-app-server.cjs')],opts)});
  t.after(()=>client.close());await client.start();await assert.rejects(client.call(method,{}),/CODEX_PROTOCOL_INVALID_JSON|CODEX_PROCESS_EXIT/);await client.close();
});
test('policy removes author shell, filesystem, plugins and secrets; exact model has no budgets',()=>{
  for(const key of ['shell_tool','unified_exec','apply_patch_freeform','view_image','code_mode_only','js_repl','apps','plugins','multi_agent','computer_use','hooks'])assert.equal(LOCKED_CONFIG['features.'+key],false);
  assert.deepEqual(LOCKED_CONFIG['features.code_mode'],{enabled:false,direct_only_tool_namespaces:['craftmine']});
  assert.equal(tomlValue({enabled:false,direct_only_tool_namespaces:['craftmine']}),'{"enabled"=false,"direct_only_tool_namespaces"=["craftmine"]}');
  assert.equal(LOCKED_CONFIG.model,MODEL);assert.equal(LOCKED_CONFIG.model_reasoning_effort,EFFORT);
  assert(!Object.keys(LOCKED_CONFIG).some(k=>/max_tokens|budget|deadline/.test(k)));
  assert.deepEqual(processEnvironment({USERPROFILE:'user',OPENAI_API_KEY:'hidden',AUTH_TOKEN:'hidden',PATH:'path'}),{USERPROFILE:'user',PATH:'path'});
  assert.equal(JSON.stringify(redact({refresh_token:'hidden',text:'Bearer hidden sk-hidden'})).includes('hidden'),false);
});
test('exact model, disabled environments, native identities, text/usage events and same-thread continuation',async t=>{
  const f=fixture(t);await f.session.connect();
  assert.equal(f.client.calls[0].params.allowProviderModelFallback,false);
  assert.deepEqual(f.client.calls[0].params.environments,[]);
  for(const text of ['Generate some trees','Add flowers and grass']){
    const run=f.session.run(text);await tick();
    const response=once(f.client,'response');f.client.tool('godot_project_patch',{files:[]});await response;
    f.client.emit('notification',{method:'item/agentMessage/delta',params:{threadId:'thread-a',turnId:f.client.turnId,delta:'Progress'}});
    f.client.emit('notification',{method:'thread/tokenUsage/updated',params:{threadId:'thread-a',turnId:f.client.turnId,tokenUsage:{total:{totalTokens:123},last:{totalTokens:45}}}});
    f.client.complete();assert.equal((await run).status,'completed');
  }
  assert.equal(f.executions.length,2);assert.notEqual(f.executions[0].context.turnId,f.executions[1].context.turnId);
  assert.equal(f.executions[0].context.sessionId,f.executions[1].context.sessionId);
  assert(f.executions.every(e=>e.context.toolCallId.startsWith('codex-')));
  for(const call of f.client.calls.filter(c=>c.method==='turn/start')){assert.equal(call.params.model,MODEL);assert.equal(call.params.effort,EFFORT);assert.deepEqual(call.params.environments,[]);}
  assert(f.events.some(e=>e.type==='usage'&&e.cost===null&&e.tokenUsage.total.totalTokens===123));
  const resumed=new CodexWorldSession({data:f.data,state:readState(f.data),host:f.host,client:new FakeClient()});
  await resumed.connect();assert.equal(resumed.client.calls[0].method,'thread/resume');
  assert.equal(resumed.client.calls[0].params.threadId,'thread-a');assert.equal(resumed.client.calls[0].params.history,undefined);
  assert.match(fs.readFileSync(path.join(f.data,'events.jsonl'),'utf8'),/Add flowers and grass/);
});
test('foreign worlds/turns, unknown tools, forged context and mismatched tool replay never mutate',async t=>{
  const f=fixture(t);await f.session.connect();const run=f.session.run('Trees');await tick();
  for(const override of [{threadId:'foreign'},{turnId:'foreign'},{namespace:'shell'}])f.client.tool('godot_project_patch',{},override);
  f.client.tool('shell',{});f.client.tool('godot_project_patch',{worldId:'foreign'});await tick();assert.equal(f.executions.length,0);
  f.client.tool('godot_project_patch',{files:[]},{callId:'same'});await tick();
  f.client.tool('godot_project_patch',{files:[]},{callId:'same'});await tick();
  f.client.tool('godot_project_patch',{files:['changed']},{callId:'same'});await tick();
  assert.equal(f.executions.length,1);assert(f.client.responses.some(r=>r.result?.contentItems[0].text.includes('TOOL_REPLAY_MISMATCH')));
  f.client.emit('request',{id:'approval',method:'item/commandExecution/requestApproval',params:{}});assert(f.client.responses.at(-1).denied);
  f.client.complete();await run;
});
test('cancellation fences before returning, drains in-flight work, and rejects late source writes',async t=>{
  let release,attempted=false,mutated=false,f;
  f=fixture(t,{execute:async()=>{await new Promise(resolve=>{release=resolve;});attempted=true;if(!f.ends.length)mutated=true;else throw Error('TURN_ENDED');}});
  await f.session.connect();const run=f.session.run('Trees');await tick();f.client.tool('godot_project_patch',{files:[]});await tick();
  let finished=false;const cancel=f.session.cancel().then(()=>{finished=true;});await tick();
  assert.equal(f.ends[0].status,'aborted');assert.equal(finished,false);
  f.client.tool('godot_project_patch',{files:[]});release();await cancel;
  assert.equal((await run).status,'aborted');assert(attempted);assert.equal(mutated,false);
  f.client.tool('godot_project_patch',{files:[]});assert.equal(f.executions.length,1);
  assert.equal(readState(f.data).active,null);
});
test('cancellation during unacknowledged turn/start finishes without waiting for a model',async t=>{
  const f=fixture(t);await f.session.connect();
  const call=f.client.call.bind(f.client);f.client.call=(method,params)=>method==='turn/start'?new Promise(()=>{}):call(method,params);
  const run=f.session.run('Trees');await tick();await f.session.cancel();assert.equal((await run).status,'aborted');
});
test('ended-turn recovery fences old native identity before a new model turn',async t=>{
  const old={projectId:'project-a',sessionId:'session-a',turnId:'old'};
  const f=fixture(t,{state:{active:{context:old},threadId:'thread-a'}});await f.session.connect();
  assert.deepEqual(f.ends,[{context:old,status:'error'}]);assert(f.events.some(e=>e.type==='recovered'));
  const run=f.session.run('Continue the same dog');await tick();f.client.complete();await run;
  assert.notEqual(f.begins[0].context.turnId,'old');
});
test('model/source/catalog mismatch fails closed before authoring',async t=>{
  const f=fixture(t);f.client.model='substitute';await assert.rejects(f.session.connect(),/MODEL_CONFIGURATION/);
  assert.equal(f.begins.length,0);
  f.client.model=MODEL;f.host.sourceIdentity=async()=>({worldId:'other'});await assert.rejects(f.session.connect(),/SOURCE_IDENTITY/);
  const g=fixture(t,{state:{toolDigest:'changed'}});await assert.rejects(g.session.connect(),/TOOL_CATALOG_CHANGED/);
});
test('no-model doctor preserves durable thread identity and does not create an empty rollout reference',async t=>{
  const f=fixture(t);writeState(f.data,f.state);
  await f.session.connect({preflight:true});
  assert.equal(f.client.calls[0].params.ephemeral,true);
  assert.equal(readState(f.data).threadId,undefined);
  assert.equal(f.begins.length,0);
  const g=fixture(t,{state:{threadId:'existing'}});writeState(g.data,g.state);
  await g.session.connect({preflight:true});assert.equal(readState(g.data).threadId,'existing');
});
test('native fence failure retains recovery state and cannot claim cancelled',async t=>{
  const f=fixture(t);await f.session.connect();f.host.end=async()=>{throw Error('unavailable');};
  const run=f.session.run('Trees');await tick();await f.session.cancel();assert.equal((await run).status,'error');
  assert(readState(f.data).active);assert(!f.events.some(e=>e.type==='turn-end'));
});
test('process failure and provider reroute end native turn without fallback',async t=>{
  for(const kind of ['failure','reroute']){
    const f=fixture(t);await f.session.connect();const run=f.session.run('Trees');await tick();
    if(kind==='failure')f.client.emit('failure',Error('CODEX_PROCESS_EXIT:7'));
    else f.client.emit('notification',{method:'model/rerouted',params:{threadId:'thread-a',turnId:f.client.turnId,toModel:'substitute'}});
    assert.equal((await run).status,'error');assert.equal(f.ends[0].status,'error');
  }
});
test('durable lock refuses a second author and domain images use actual image blocks',t=>{
  const data=directory(t);const unlock=acquireLock(data);assert.throws(()=>acquireLock(data),/AUTHOR_BUSY/);unlock();
  assert.equal(toolOutput(true,{text:'capture',images:[{mimeType:'image/png',data:'iVBORw0KGgo='}]}).contentItems[1].type,'inputImage');
  assert.throws(()=>toolOutput(true,{images:[{mimeType:'image/png',data:'file://private'}]}),/INVALID_DOMAIN_IMAGE/);
});
