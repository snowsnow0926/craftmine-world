import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {ActiveTurns}=await import('../electron/main/active-turns.ts');
test('a fast request remains detectable after it starts and ends during a suspended read',async()=>{
  const turns=new ActiveTurns(),before=turns.generation('s');
  let release;const delayed=new Promise(r=>release=r);
  const result=delayed.then(()=>turns.generation('s')===before);
  turns.set('s','new-turn');turns.delete('s');assert.equal(turns.get('s'),undefined);
  release();assert.equal(await result,false);assert.equal(turns.generation('other'),0);
  turns.set('s','next');assert.equal(turns.size,1);assert.deepEqual([...turns],[['s','next']]);
});
