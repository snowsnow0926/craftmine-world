import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedEntryAction} from './helpers/player-world-entry.mjs';
test('retained entry chooses the exact host slot rather than a matching engine',()=>{
  const cards=[{kind:'godot',worldId:'new-godot',state:'ready',disabled:false},{kind:'web',worldId:'old-web',state:'ready',disabled:false}];
  assert.equal(retainedEntryAction({entry:true,cards,canReturn:false},'old-godot'),'advanced-saves');
  assert.equal(retainedEntryAction({entry:true,cards,canReturn:false},'old-web'),'matching-card');
  assert.equal(retainedEntryAction({entry:true,cards,canReturn:true},'old-godot'),'return-current');
});
test('entry waits for slot facts and preserves legacy or already-open paths',()=>{
  assert.equal(retainedEntryAction({entry:true,cards:[{state:'loading'}]},'old'),'wait');
  assert.equal(retainedEntryAction({entry:false,cards:[]},'old'),'already-open');
  assert.equal(retainedEntryAction({entry:true,cards:[]},'old'),'legacy-ui');
});
