import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createHostRequests}=require('../../../desktop/build/craftmine.world/host-requests.cjs');
const context={projectId:'p',sessionId:'s',turnId:'t'};
const binding={...context,taskId:'task',baseBuild:'base'};
const params={context,binding,generation:1,requestId:'r',purpose:'creation',estimatedInputTokens:100,maxOutputTokens:100};
function fixture(count=0){const calls=[];let fail=false;const snapshot={binding,generation:1,budget:{requestCount:count,limits:{maxRequests:80,maxTokens:null,maxCompactions:8,deadlineAt:null}}};const core={start:async()=>{},call:async(method,args)=>{if(method==='task.context')return snapshot;calls.push({method,args});if(fail){fail=false;throw Error('lost reply');}return {status:'reserved'};}};return {calls,snapshot,fail:()=>{fail=true;},call:createHostRequests(core,{})};}
test('configured unused policy initializes one retry-stable host deadline',async()=>{const f=fixture();f.fail();await assert.rejects(f.call('budget.reserve',params),/lost reply/);await new Promise(resolve=>setTimeout(resolve,5));await f.call('budget.reserve',params);assert.equal(f.calls[0].args.limits.deadlineAt,f.calls[1].args.limits.deadlineAt);assert.ok(f.calls[0].args.limits.deadlineAt>Date.now());assert.equal(f.calls[0].args.limits.maxTokens,null);});
test('used null policy remains null and existing deadlines are reused',async()=>{const f=fixture(4);await f.call('budget.reserve',params);assert.equal(f.calls[0].args.limits.deadlineAt,null);f.snapshot.budget.limits.deadlineAt=123456;await f.call('budget.reserve',{...params,requestId:'next'});assert.equal(f.calls[1].args.limits.deadlineAt,123456);});
test('model reservation fields cannot smuggle limits into dedicated player configuration',async()=>{const f=fixture();await assert.rejects(f.call('budget.reserve',{...params,limits:{maxTokens:null}}));await assert.rejects(f.call('budget.configure',{...params,maxTokens:null}));assert.equal(f.calls.length,0);});
