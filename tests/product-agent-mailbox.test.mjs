import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readProductAgentCommand,atomicProductAgentJson,measureProductAgentFiles,checkProductAgentIntegrity} from './helpers/product-agent-mailbox.mjs';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'product-mailbox-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('operator commands retain exact text and a byte digest for durable no-replay receipts',t=>{
  const dir=fixture(t),file=path.join(dir,'001-first.json');atomicProductAgentJson(file,{id:'001-first',command:'prompt',args:{text:'保留整城\n不要把飞机改成摆设。'}});
  const value=readProductAgentCommand(dir,'001-first.json');assert.equal(value.args.text,'保留整城\n不要把飞机改成摆设。');assert.match(value.sha256,/^[a-f0-9]{64}$/);assert.equal(fs.existsSync(file+'.tmp'),false);
});
test('mailbox refuses traversal, directories, mismatched IDs and arbitrary evaluation commands',t=>{
  const dir=fixture(t);assert.throws(()=>readProductAgentCommand(dir,'../foreign.json'),/NAME_INVALID/);fs.mkdirSync(path.join(dir,'directory.json'));assert.throws(()=>readProductAgentCommand(dir,'directory.json'),/FILE_INVALID/);
  for(const value of [{id:'other',command:'status'},{id:'bad',command:'evaluate',args:{script:'steal()'}},{id:'bad',command:'status',worldId:'other'},{id:'bad',command:'status',args:[]}]){atomicProductAgentJson(path.join(dir,'bad.json'),value);assert.throws(()=>readProductAgentCommand(dir,'bad.json'),/COMMAND_INVALID/);}
});
test('explicit answers keep custom player wishes and never substitute the first option',t=>{
  const dir=fixture(t),answers=[['保留整座城市，扩展独立跑道；伙伴继续跟随。'],['保留战斗玩法']];atomicProductAgentJson(path.join(dir,'answer.json'),{id:'answer',command:'answer',args:{requestId:'ask-one',answers}});assert.deepEqual(readProductAgentCommand(dir,'answer.json').args.answers,answers);
});
test('artifact evidence hashes actual bytes and records changed or missing files before final report save',t=>{
  const dir=fixture(t),file=path.join(dir,'main.js');fs.writeFileSync(file,'actual source bytes');const expected=measureProductAgentFiles({main:file});
  assert.equal(expected.main.bytes,19);assert.equal(checkProductAgentIntegrity(expected).status,'passed');
  fs.writeFileSync(file,'changed bytes');const changed=checkProductAgentIntegrity(expected);assert.equal(changed.status,'failed');assert.match(changed.error,/ARTIFACT_CHANGED:main/);
  atomicProductAgentJson(path.join(dir,'report.json'),{integrity:changed});assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'report.json'))).integrity.status,'failed');
  fs.unlinkSync(file);assert.equal(checkProductAgentIntegrity(expected).status,'failed');
});
test('packaged launch assertion failure remains serializable evidence instead of escaping after save',t=>{
  const dir=fixture(t),file=path.join(dir,'core.exe');fs.writeFileSync(file,'binary');const checked=checkProductAgentIntegrity(measureProductAgentFiles({core:file}),()=>{throw Error('PACKAGED_PAYLOAD_CHANGED');});assert.equal(checked.status,'failed');assert.match(checked.error,/PACKAGED_PAYLOAD_CHANGED/);
});
