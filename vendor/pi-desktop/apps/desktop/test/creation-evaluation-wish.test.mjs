import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {register} from 'node:module';
register('./helpers/ts-import-hooks.mjs',import.meta.url);
const {parseEvaluationWish,createEvaluationWishJournal}=await import('../electron/main/creation-evaluation-wish.ts');
test('wish entry accepts player words only, not evaluator answers or injected targets',()=>{
  assert.deepEqual(parseEvaluationWish({id:'PET01',text:'我希望有条宠物狗。'}),{id:'PET01',text:'我希望有条宠物狗。'});
  for(const value of [null,[],{id:'x',text:''},{id:'x',text:'x'.repeat(4001)},{id:'x',text:'狗',expected:'pass'},{id:'x',text:'狗',target:{id:'fabricated'}}])assert.throws(()=>parseEvaluationWish(value));
});
test('a lost reply or restart cannot resubmit the same wish under another world/session',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'evaluation-wish-'));
  const first=createEvaluationWishJournal(dir),entry=first.claim({id:'PET01',text:'狗'},'session','world');
  assert.equal(entry.status,'claimed');
  const restart=createEvaluationWishJournal(dir);
  assert.throws(()=>restart.claim({id:'PET01',text:'狗'},'another-session','another-world'),/ALREADY_CLAIMED/);
  restart.finish('PET01','uncertain');
  assert.equal(first.snapshot()[0].status,'uncertain');
  assert.throws(()=>first.finish('PET01','submitted'),/CLAIM_REQUIRED/);
});
test('separate journal readers retain earlier submissions and reject corrupt records',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'evaluation-wish-')),a=createEvaluationWishJournal(dir),b=createEvaluationWishJournal(dir);
  a.claim({id:'one',text:'树'},'session','world');b.claim({id:'two',text:'花'},'session','world');
  assert.equal(a.snapshot().length,2);a.finish('one','submitted');
  fs.writeFileSync(path.join(dir,'creation-evaluation-wishes.json'),'{}');assert.throws(()=>b.snapshot(),/CORRUPT/);
});
