import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLiveCommand,validateLiveDomain} from '../scripts/lib/codex-live-service.mjs';
test('private operator commands cannot select a world, descriptor, arbitrary RPC or page script',()=>{
  const id='gcan-'+'a'.repeat(64);
  validateLiveCommand('apply',{candidateId:id});
  for(const args of [{candidateId:id,worldId:'other'},{candidateId:id,descriptor:{}},{candidateId:'../../private'}])assert.throws(()=>validateLiveCommand('apply',args));
  for(const method of ['exec','evaluate','core.call','godotApplication.commit'])assert.throws(()=>validateLiveCommand(method,{}),/NOT_ALLOWED/);
});
test('helper Core proxy admits only product runtime/application methods in the bound world',()=>{
  validateLiveDomain('world-a','godotRuntime.describe',{worldId:'world-a'});
  for(const method of ['godotExecutor.register','godotJob.finish','world.create','godotProject.patch','shell.exec'])assert.throws(()=>validateLiveDomain('world-a',method,{}),/NOT_ALLOWED/);
  assert.throws(()=>validateLiveDomain('world-a','world.read',{id:'world-b'}),/WORLD_MISMATCH/);
  assert.throws(()=>validateLiveDomain('world-a','godotApplication.prepare',{worldId:'world-b'}),/WORLD_MISMATCH/);
  assert.throws(()=>validateLiveDomain('world-a','content.apply.prepare',{worldId:'world-a',context:{worldId:'world-b'}}),/WORLD_MISMATCH/);
});
