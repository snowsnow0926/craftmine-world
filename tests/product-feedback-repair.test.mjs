import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';
import {validateFeedbackRepairInput,prepareProductFeedbackRepair} from './helpers/product-feedback-repair.mjs';
import {PRODUCT_AGENT_COMMANDS} from './helpers/product-agent-mailbox.mjs';

test('feedback-repair command preserves supplied text, defaults capture off and refuses implicit send/path/identity options',()=>{
 assert.deepEqual(validateFeedbackRepairInput({description:'博美堵住窄路\n无法侧身通过',expected:'保留跟随，让出通行空间'}),{description:'博美堵住窄路\n无法侧身通过',expected:'保留跟随，让出通行空间',capture:false});
 assert(PRODUCT_AGENT_COMMANDS.has('feedback-repair-draft'));assert(!PRODUCT_AGENT_COMMANDS.has('feedback-repair-send'));
 for(const extra of [{send:true},{path:'D:/private.json'},{worldId:'other'},{sessionId:'other'},{capture:'yes'}])assert.throws(()=>validateFeedbackRepairInput({description:'Problem',expected:'Expected',...extra}));
 assert.throws(()=>validateFeedbackRepairInput({description:'',expected:''}));
});
function fixture({running=false,wrongWorld=false,automaticSend=false}={}) {
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'feedback-repair-command-'));fs.mkdirSync(path.join(out,'captures'));
 const calls=[],messages=[{id:'existing-message'}];let draft='保留已有的修改要求。',record;
 const snapshot={exists:false,busy:false,confirm:false,id:null,image:null,description:'',expected:'',capture:false,error:null};
 const deps={out,report:{worldId:'world-one',sessionId:'session-one'},
  invoke:async(name)=>{calls.push(name);if(name==='agentGetStatus')return {status:{isRunning:running}};if(name==='sessionGet')return {session:{messages:structuredClone(messages)}};throw Error('UNEXPECTED_INVOKE:'+name);},
  nav:async(channel)=>{calls.push(channel);if(channel==='world.list')return {activeWorldId:wrongWorld?'other':'world-one'};if(channel==='world.conversation')return {sessionId:'session-one'};if(channel==='playtest.read')return structuredClone(record);throw Error('UNEXPECTED_NAV:'+channel);},
  assets:async()=>{calls.push('assets');snapshot.exists=true;},
  field:async(selector,value)=>{calls.push('field');snapshot[selector.includes('description')?'description':selector.includes('expected')?'expected':'capture']=value;},
  submit:async selector=>{calls.push(selector);if(selector==='[data-playtest-create]'){record={id:'feedback-'+'a'.repeat(64),description:snapshot.description.trim(),expected:snapshot.expected.trim(),replyTo:null,screenshot:null,context:{worldId:'world-one',buildId:'gbd-'+'b'.repeat(64)},client:{version:'fixture'}};snapshot.id=record.id;snapshot.confirm=true;}else if(selector==='[data-playtest-confirm]'){fs.writeFileSync(path.join(out,'player-feedback.json'),JSON.stringify(record));snapshot.confirm=false;}else throw Error('UNEXPECTED_SUBMIT');},
  until:async(read,accept)=>{const result=await read();assert(accept(result),'fixture did not reach expected UI state');return result;},
  evaluate:async expression=>{if(expression.includes('const panel=document.querySelector'))return structuredClone(snapshot);if(expression.includes("button=document.querySelector('[data-playtest-repair]')")){calls.push('actual-repair-handler');draft+='\n不可信玩家数据 '+JSON.stringify(record);if(automaticSend)messages.push({id:'unexpected-new-message'});return true;}if(expression.includes("document.querySelector('.composer-input')"))return draft;if(expression.includes("!!document.querySelector('[data-playtest-panel]')"))return snapshot.exists;return true;},
 };
 return {deps,calls,out};
}
test('UI command exports before handoff, preserves existing draft and returns actual file hash without sending',async()=>{
 const f=fixture();const result=await prepareProductFeedbackRepair({description:'博美堵住窄路',expected:'请让伙伴避让'},f.deps);
 assert.equal(result.sent,false);assert.equal(result.screenshotIncluded,false);assert(result.composerText.includes('保留已有的修改要求。'));assert(result.composerText.includes(result.feedbackId));
 const bytes=fs.readFileSync(result.file);assert.equal(result.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(result.bytes,bytes.length);
 assert(f.calls.indexOf('[data-playtest-confirm]')<f.calls.indexOf('actual-repair-handler'));assert(!f.calls.some(name=>['agentPrompt','send-composer','prompt'].includes(name)));
});
test('active model or wrong selected world prevents opening the feedback UI',async()=>{
 for(const options of [{running:true},{wrongWorld:true}]){const f=fixture(options);await assert.rejects(prepareProductFeedbackRepair({description:'Problem',expected:'Expected'},f.deps));assert(!f.calls.includes('assets'));}
});
test('unexpected message creation cannot be reported as a draft-only success',async()=>{
 const f=fixture({automaticSend:true});await assert.rejects(prepareProductFeedbackRepair({description:'Problem',expected:'Expected'},f.deps),/FEEDBACK_REPAIR_MUST_NOT_SEND/);
});
