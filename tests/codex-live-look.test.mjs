import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLiveCommand} from '../scripts/lib/codex-live-service.mjs';
test('private aiming accepts only finite bounded native look angles',()=>{
 assert.doesNotThrow(()=>validateLiveCommand('look',{yaw:0.5,pitch:-0.1}));
 assert.doesNotThrow(()=>validateLiveCommand('openPaused',{}));
 assert.throws(()=>validateLiveCommand('openPaused',{snapshot:{}}),/LIVE_OPERATION_NOT_ALLOWED/);
 for(const value of [{},{yaw:0},{yaw:NaN,pitch:0},{yaw:0,pitch:Infinity},{yaw:4,pitch:0},{yaw:0,pitch:2},{yaw:0,pitch:0,worldId:'foreign'},{yaw:0,pitch:0,script:'arbitrary'}])assert.throws(()=>validateLiveCommand('look',value),/LIVE_LOOK_INVALID|LIVE_OPERATION_NOT_ALLOWED/);
});
