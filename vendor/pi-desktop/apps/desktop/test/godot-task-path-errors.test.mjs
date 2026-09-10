import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {initializationJobFailure}=await import('../electron/main/godot-world-initialization.ts');
const {initStatusToCreation}=await import('../electron/main/godot-world-creation.ts');

test('hash-checked job output preserves a finite preparation error without log paths',()=>{
 const reason=initializationJobFailure({status:'failed',output:{compile:{errors:['GODOT_TASK_PATH_TOO_LONG']}}});
 assert.equal(reason,'GODOT_TASK_PATH_TOO_LONG');
 const mapped=initStatusToCreation({status:'failed',reason,playable:false});
 assert.equal(mapped.creation.stage,'build');assert.equal(mapped.creation.error.stage,'build');
 assert.equal(mapped.creation.error.code,reason);
 assert.deepEqual(mapped.creation.stages.map(row=>row.status),['passed','passed','failed','pending']);
 assert.match(mapped.creation.error.message,/路径过长/);
 assert.equal(mapped.creation.error.message.includes('C:'),false);
 assert.equal(initializationJobFailure({status:'failed',output:{compile:{errors:['unknown C:/private/source']}}}),'GODOT_JOB_FAILED');
});

test('other failed stages report the failed stage rather than the previous passed stage',()=>{
 const mapped=initStatusToCreation({status:'failed',reason:'PROJECT_CONFIG_REQUIRED'});
 assert.equal(mapped.creation.stage,'project');assert.equal(mapped.creation.error.stage,'project');
});
