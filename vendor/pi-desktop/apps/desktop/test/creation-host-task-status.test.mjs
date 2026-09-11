import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./helpers/ts-import-hooks.mjs',import.meta.url);
const {creationTaskStatus}=await import('../electron/main/creation-task-status.ts');
const formal={worldId:'w',baseId:'creation-sandbox',buildId:'old'};

test('only the same pending host application changes a passed candidate to applying',()=>{
  const job={worldId:'w',kind:'check',status:'passed',buildId:'new'};
  assert.equal(creationTaskStatus('w','s',job,formal,true).phase,'applying');
  assert.equal(creationTaskStatus('w','s',job,{...formal,buildId:'new'},true).phase,'applied');
  assert.equal(creationTaskStatus('w','s',null,formal,true).phase,'idle');
  assert.equal(creationTaskStatus('w','s',{...job,status:'cancelled'},formal,true).phase,'cancelled');
});
test('startup-only candidate remains explicitly unsupported for requirement completion',()=>{
  const state=creationTaskStatus('w','s',{worldId:'w',kind:'check',status:'passed',buildId:'new'},formal);
  assert.equal(state.phase,'ready');assert.equal(state.requirementStatus,'unsupported');
});
test('only the actual formal build is presented as adopted across restart',()=>{
  const job={worldId:'w',kind:'check',status:'passed',buildId:'new',checkRequirements:{format:'host-frozen'}};
  assert.equal(creationTaskStatus('w','s',job,formal).phase,'ready');
  const actual=creationTaskStatus('w','s',job,{...formal,buildId:'new'});
  assert.equal(actual.phase,'applied');assert.equal(actual.requirementStatus,'passed');
});
test('cancelled and interrupted jobs retain their actual outcome and wrong worlds are rejected',()=>{
  for(const status of ['cancelled','interrupted'])assert.equal(creationTaskStatus('w','s',{worldId:'w',status},formal).phase,status);
  assert.throws(()=>creationTaskStatus('w','s',{worldId:'other'},formal),/WORLD_CHANGED/);
});
