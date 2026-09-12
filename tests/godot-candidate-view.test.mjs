import assert from 'node:assert/strict';
import test from 'node:test';
import {candidateIdentity} from '../plugins/craftmine-world/godot-candidate-view.mjs';

test('Godot candidate UI uses coordinator candidateId and accepts legacy id records', () => {
  assert.equal(candidateIdentity({candidateId:'candidate-1',id:'row-1'}), 'candidate-1');
  assert.equal(candidateIdentity({id:'legacy-1'}), 'legacy-1');
  assert.throws(() => candidateIdentity({candidateId:''}), /INVALID_GODOT_CANDIDATE_ID/);
  assert.throws(() => candidateIdentity({}), /INVALID_GODOT_CANDIDATE_ID/);
});
