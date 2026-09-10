import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {assertEvaluationSession,recordEvaluationSession} from '../electron/main/creation-evaluation-session.ts';
const session={id:'01234567-1234-1234-1234-0123456789ab',providerId:'provider-a',modelId:'deepseek-flash',thinkingLevel:'high',mode:'agent',title:'造物世界真实模型评测'},provider={id:'provider-a',vendorKey:'deepseek',baseUrl:'https://api.deepseek.com'};
test('automatic title changes cannot break resumption of the same actual evaluation configuration',()=>{
 const original=assertEvaluationSession(session,provider,'deepseek-flash','high');
 assert.deepEqual(assertEvaluationSession({...session,title:'放置树木并保留原有内容'},provider,'deepseek-flash','high'),original);
 assert.throws(()=>assertEvaluationSession({...session,modelId:'different'},provider,'deepseek-flash','high'));
 assert.throws(()=>assertEvaluationSession(session,{...provider,baseUrl:'https://unrelated.invalid'},'deepseek-flash','high'));
 assert.throws(()=>assertEvaluationSession(session,provider,'deepseek-flash','off'));
});
test('private evaluation identity persists across reopen and detects configuration substitution',()=>{
 const parent=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(parent,'creation-eval-session-'));
 try{const identity=assertEvaluationSession(session,provider,'deepseek-flash','high');recordEvaluationSession(dir,identity);recordEvaluationSession(dir,identity);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'creation-evaluation-sessions.json'))).sessions[session.id],identity);assert.throws(()=>recordEvaluationSession(dir,{...identity,providerId:'other'}),/CONFIGURATION_CHANGED/);}finally{const resolved=fs.realpathSync(dir);assert.equal(path.dirname(resolved),parent);assert.ok(path.basename(resolved).startsWith('creation-eval-session-'));fs.rmSync(resolved,{recursive:true,force:true});}
});
