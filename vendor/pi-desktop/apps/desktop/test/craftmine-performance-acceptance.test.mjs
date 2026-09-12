import test from 'node:test';import assert from 'node:assert/strict';
import {validatePerformanceAcceptance} from '../electron/main/craftmine-performance-acceptance.ts';
const request={type:'craftmine-headless',id:'request',method:'godotPerformanceTool',payload:{worldId:'world-1',sessionId:'session-1'}};
test('protected controller can invoke only the fixed performance read with exact identities',()=>{
  assert.deepEqual(validatePerformanceAcceptance(request,true),request.payload);
  assert.throws(()=>validatePerformanceAcceptance(request,false),/CONTROLLER/);
  for(const change of [{method:'godot_source_apply'},{type:'other'},{toolName:'godot_performance_observe'}])assert.throws(()=>validatePerformanceAcceptance({...request,...change},true));
  for(const payload of [{...request.payload,toolName:'anything'},{...request.payload,context:{}},{...request.payload,worldId:'../other'},null,[],{sessionId:'s'}])assert.throws(()=>validatePerformanceAcceptance({...request,payload},true),/IDENTITY/);
});
