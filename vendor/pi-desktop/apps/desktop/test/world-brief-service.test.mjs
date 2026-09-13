import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorldBriefService} from '../electron/main/world-brief-service.ts';

test('world brief exposes only fixed native product methods and selected world',async()=>{
  const calls=[];let selected='a';
  const service=createWorldBriefService({selected:async()=>selected,busy:()=>false,call:async(method,args)=>{calls.push({method,args});return {worldId:'a',revision:0};}});
  await service.request({worldId:'a',action:'read'});
  assert.deepEqual(calls,[{method:'worldBrief.read',args:{worldId:'a'}}]);
  for(const input of [{worldId:'b',action:'read'},{worldId:'a',action:'read',context:{}},{worldId:'a',action:'tool'},{worldId:'a',action:'constructor'},{worldId:'../b',action:'read'}])await assert.rejects(service.request(input));
  assert.equal(calls.length,1);
});
test('busy mutation refused but read remains available',async()=>{
  let calls=0;
  const service=createWorldBriefService({selected:async()=>'a',busy:()=>true,call:async()=>{calls++;return {worldId:'a'};}});
  await assert.rejects(service.request({worldId:'a',action:'add',operationId:'op',expectedRevision:0,kind:'goal',text:'play'}),/WORLD_BUSY/);
  await service.request({worldId:'a',action:'read'});assert.equal(calls,1);
});
test('late results cannot appear in a newly selected world and errors expose no path',async()=>{
  let selected='a';
  const service=createWorldBriefService({selected:async()=>selected,busy:()=>false,call:async()=>{selected='b';return {worldId:'a'};}});
  await assert.rejects(service.request({worldId:'a',action:'read'}),/WORLD_CHANGED/);
  const failure=createWorldBriefService({selected:async()=>'a',busy:()=>false,call:async()=>{throw Error('private C:/user/profile/database.sqlite');}});
  await assert.rejects(failure.request({worldId:'a',action:'read'}),error=>error.message==='WORLD_BRIEF_UNAVAILABLE');
});
