import test from 'node:test';import assert from 'node:assert/strict';
import {evaluationGroundHasSpace} from '../electron/main/creation-evaluation-placement.ts';
const world=(entities=[])=>({payload:{player:{position:[0,.9,6]},creation:{target:{surface:'ground',position:[0,0,2]},entities}}});
test('a real ground hit beside an existing object is not necessarily a valid placement',()=>{
 assert.equal(evaluationGroundHasSpace(world()),true);
 assert.equal(evaluationGroundHasSpace(world([{collisionBounds:{min:[.6,0,1.5],max:[1.8,4,2.5]}}])),false);
 assert.equal(evaluationGroundHasSpace(world([{collisionBounds:{min:[2,0,1.5],max:[3,4,2.5]}}])),true);
});
test('evaluator refuses unknown geometry, player overlap and boundary overflow without inventing a point',()=>{
 assert.equal(evaluationGroundHasSpace(world([{}])),false);
 const a=world();a.payload.creation.target.position=[0,0,6];assert.equal(evaluationGroundHasSpace(a),false);
 a.payload.creation.target.position=[28,0,0];assert.equal(evaluationGroundHasSpace(a),false);
 a.payload.creation.target={surface:'entity',position:[0,0,2]};assert.equal(evaluationGroundHasSpace(a),false);
});
