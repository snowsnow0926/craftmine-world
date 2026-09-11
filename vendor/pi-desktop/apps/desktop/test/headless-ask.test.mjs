import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {createHeadlessAskBridge,installHeadlessAskBridge} from '../src/lib/headless-ask.ts';
import {validateHeadlessAskEnvelope,headlessAskScript} from '../electron/main/craftmine-headless-ask.ts';
import {projectHeadlessAsk,validateHeadlessAskInput} from '../shared/headless-ask-contract.ts';
const original=()=>({sessionId:'session-a',requestId:'ask-a',toolCallId:'tool-a',questions:[{question:'想要哪种怪物？',options:['游荡','会追逐（推荐）']},{question:'重开后如何？',options:['重置','保留'],multiSelect:false}]});
function fixture(){const state={ask:original(),calls:[]};const bridge=createHeadlessAskBridge({head:()=>state.ask,resolve:async(session,resolution)=>{state.calls.push({session,resolution});state.ask=null;}});return {state,bridge};}
const pending={sessionId:'session-a'},answer={sessionId:'session-a',requestId:'ask-a',choices:[[1],[0]]};
test('ordinary renderer gets no bridge and pending exposes only bounded question fields',()=>{
 const scope={},f=fixture();assert.equal(installHeadlessAskBridge(scope,{head:()=>null,resolve:async()=>{}}),false);assert.equal(scope.__craftmineHeadlessAsk,undefined);
 f.state.ask.secret='credential-not-part-of-question';f.state.ask.provider={apiKey:'private'};
 const read=f.bridge.pending(pending);assert.deepEqual(read,original());assert.ok(!JSON.stringify(read).includes('private'));
 read.questions[0].options[0]='modified display';assert.equal(f.state.ask.questions[0].options[0],'游荡');
 const isolated={__craftmineHeadless:{}};assert.equal(installHeadlessAskBridge(isolated,{head:()=>null,resolve:async()=>{}}),true);assert.ok(Object.isFrozen(isolated.__craftmineHeadlessAsk));
});
test('pending then answer maps indices through current original options into regular resolve API',async()=>{
 const {state,bridge}=fixture();bridge.pending(pending);const result=await bridge.resolve(answer);
 assert.deepEqual(state.calls,[{session:'session-a',resolution:{sessionId:'session-a',requestId:'ask-a',answers:[['会追逐（推荐）'],['重置']]}}]);
 assert.equal(result.status,'resolved');assert.equal(bridge.pending(pending),null);
 assert.deepEqual(await bridge.resolve(answer),result);assert.equal(state.calls.length,1);
 await assert.rejects(bridge.resolve({...answer,choices:[[0],[0]]}),/ALREADY_RESOLVED/);
});
test('unread, stale, replaced and cross-session questions cannot receive an answer',async()=>{
 const {state,bridge}=fixture();await assert.rejects(bridge.resolve(answer),/CHANGED/);bridge.pending(pending);
 state.ask.questions[0].question='Changed question';await assert.rejects(bridge.resolve(answer),/CHANGED/);
 bridge.pending(pending);state.ask.requestId='ask-b';await assert.rejects(bridge.resolve(answer),/CHANGED/);
 assert.throws(()=>bridge.pending({sessionId:'session-b'}),/INVALID/);assert.equal(state.calls.length,0);
});
test('only exact bounded option indices, null skips and question counts are accepted',async()=>{
 for(const choices of [[],[[9],[0]],[[-1],[0]],[[0,0],[0]],[[.5],[0]],[['custom code'],[0]],[[0,1],[0]],[[0]],[[0],[]]]){
  const f=fixture();f.bridge.pending(pending);await assert.rejects(f.bridge.resolve({...answer,choices}));assert.equal(f.state.calls.length,0);
 }
 const f=fixture();f.bridge.pending(pending);assert.deepEqual((await f.bridge.resolve({...answer,choices:[null,[0]]})).answers,[null,['重置']]);
});
test('concurrent requests cannot double-answer and failed API is not reported as success',async()=>{
 let finish;const ask=original(),bridge=createHeadlessAskBridge({head:()=>ask,resolve:()=>new Promise(resolve=>{finish=resolve;})});bridge.pending(pending);
 const first=bridge.resolve(answer);await assert.rejects(bridge.resolve(answer),/BUSY/);finish();await first;
 const failed=createHeadlessAskBridge({head:()=>ask,resolve:async()=>{throw Error('API_FAILURE');}});failed.pending(pending);await assert.rejects(failed.resolve(answer),/API_FAILURE/);
});
test('parent IPC requires exact envelope and authorization; script cannot select an arbitrary method',async()=>{
 const request={type:'craftmine-headless',id:'ipc-a',method:'headlessAskPending',payload:pending};
 assert.throws(()=>validateHeadlessAskEnvelope(request,false),/PARENT_REQUIRED/);
 for(const changes of [{method:'executeJavaScript'},{script:'arbitrary()'},{payload:{...pending,secret:'no'}},{id:''}])assert.throws(()=>validateHeadlessAskEnvelope({...request,...changes},true));
 assert.throws(()=>headlessAskScript('resolve;arbitrary()',answer),/INVALID/);
 const f=fixture(),script=validateHeadlessAskEnvelope(request,true);
 const found=vm.runInNewContext(script,{__craftmineHeadless:{},__craftmineHeadlessAsk:f.bridge});assert.deepEqual(found,original());
 const result=await vm.runInNewContext(validateHeadlessAskEnvelope({...request,method:'headlessAskResolve',payload:answer},true),{__craftmineHeadless:{},__craftmineHeadlessAsk:f.bridge});assert.equal(result.status,'resolved');
 assert.throws(()=>vm.runInNewContext(script,{}),/RENDERER_UNAVAILABLE/);
});
test('oversized or malformed question data fails rather than silently truncating evidence',()=>{
 for(const mutate of [a=>a.questions=Array(9).fill(a.questions[0]),a=>a.questions[0].question='x'.repeat(2001),a=>a.questions[0].options=Array(13).fill('x'),a=>a.questions[0].options[0]='\0',a=>a.toolCallId='bad/id']){
  const ask=original();mutate(ask);assert.throws(()=>projectHeadlessAsk(ask,'session-a'),/INVALID/);
 }
 assert.throws(()=>validateHeadlessAskInput('pending',{sessionId:'session-a',requestId:'no'}),/INVALID/);
});
