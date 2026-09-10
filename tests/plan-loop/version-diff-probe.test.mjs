import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../vendor/pi-desktop/apps/desktop/electron/main/craftmine-history-acceptance.ts',import.meta.url),'utf8');
const {historyProbeScript}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source,{mode:'transform'})).toString('base64'));
test('history probe accepts only finite navigation and bounded observed identifiers',()=>{
 for(const action of ['open','close','read','refresh','compareHead','next','previous'])assert.equal(typeof historyProbeScript({action,worldId:'world-a'}),'string');
 for(const payload of [{action:'evaluate',worldId:'world-a',script:'bad'},{action:'read',worldId:'world-a',channel:'world.create'},{action:'diff',worldId:'world-a',path:'x\0gd'},{action:'compareVersion',worldId:'world-a',targetOid:'main'},{action:'read',worldId:'../a'},{action:'read',worldId:'world-a',path:'a.gd'}])assert.throws(()=>historyProbeScript(payload),/INVALID_HISTORY_PROBE/);
});
function documentFixture(){
 const forms=new Map();let submissions=0;
 const form={querySelector:()=>button,querySelectorAll:()=>[button],requestSubmit:target=>{assert.equal(target,button);submissions++;}};
 const button={form,disabled:false,dataset:{historyCompare:'a'.repeat(40),comparePath:'a.gd'}};forms.set('[data-history-select-form]',form);forms.set('[data-comparison-form]',form);
 const document={querySelector:selector=>selector.startsWith('.craftmine-world-item')?{dataset:{worldId:'world-a'}}:selector==='[data-godot-history]'?null:forms.get(selector)??null};
 return {document,button,submissions:()=>submissions};
}
test('real serialized probe refuses unknown DOM target and another world without action',()=>{
 const f=documentFixture(),context={document:f.document,__craftmineHeadless:{focus:0,pointerLock:0}};
 assert.throws(()=>vm.runInNewContext(historyProbeScript({action:'compareVersion',worldId:'world-a',targetOid:'b'.repeat(40)}),context),/CONTROL_UNAVAILABLE/);
 assert.throws(()=>vm.runInNewContext(historyProbeScript({action:'diff',worldId:'world-a',path:'other.gd'}),context),/CONTROL_UNAVAILABLE/);
 assert.throws(()=>vm.runInNewContext(historyProbeScript({action:'compareVersion',worldId:'world-b',targetOid:'a'.repeat(40)}),context),/GODOT_WORLD_CHANGED/);
 assert.equal(f.submissions(),0);
});
test('real serialized probe submits only the existing enabled form control',()=>{
 const f=documentFixture(),context={document:f.document,__craftmineHeadless:{focus:0,pointerLock:0}};
 vm.runInNewContext(historyProbeScript({action:'compareVersion',worldId:'world-a',targetOid:'a'.repeat(40)}),context);assert.equal(f.submissions(),1);
 f.button.disabled=true;assert.throws(()=>vm.runInNewContext(historyProbeScript({action:'compareVersion',worldId:'world-a',targetOid:'a'.repeat(40)}),context),/CONTROL_UNAVAILABLE/);assert.equal(f.submissions(),1);
});
