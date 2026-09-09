import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {GPL3_TEXT} from '../../desktop/delivery/lib/gpl-text-pin.mjs';
import {checkGplText,checkLgpl,checkPackage} from '../../desktop/delivery/lib/preflight-core.mjs';
import {stageGplText} from '../../desktop/prepare-runtime-resources.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const code=result=>result.failures.filter(item=>item.code.startsWith('GPL_')).map(item=>item.code);

test('official independent full text satisfies the real LGPL source check without altering its licence',()=>{
  const result=checkLgpl(root);assert.deepEqual(result.failures,[]);assert.deepEqual(result.warnings,[]);
  assert.equal(result.facts.gplFullText.sha256,GPL3_TEXT.sha256);
});

test('actual fixed text stages into the managed package path and K rejects missing or altered copies',async()=>{
  const directory=await fs.mkdtemp(path.join(tmpdir(),'craftmine-gpl-stage-'));
  await stageGplText(root,path.join(directory,'resources'));
  const target=path.join(directory,'resources',GPL3_TEXT.resource);
  assert.deepEqual(checkGplText(target),[]);assert.deepEqual(code(checkPackage(root,directory)),[]);
  assert.deepEqual(code(checkLgpl(root,{packageDirectory:directory})),[]);
  await fs.writeFile(target,'GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007');
  assert.deepEqual(code(checkPackage(root,directory)),['GPL_FULL_TEXT_MISMATCH']);
  assert.deepEqual(code(checkLgpl(root,{packageDirectory:directory})),['GPL_FULL_TEXT_MISMATCH']);
  await fs.unlink(target);assert.deepEqual(code(checkPackage(root,directory)),['GPL_FULL_TEXT_MISSING']);
});

test('source substitution is rejected before a GPL package resource is written',async()=>{
  const directory=await fs.mkdtemp(path.join(tmpdir(),'craftmine-gpl-substitution-'));
  const source=path.join(directory,GPL3_TEXT.source);await fs.mkdir(path.dirname(source),{recursive:true});
  await fs.writeFile(source,'MIT replacement');
  const output=path.join(directory,'stage');
  await assert.rejects(stageGplText(directory,output),/RUNTIME_INPUT_PIN_MISMATCH/);
  await assert.rejects(fs.stat(path.join(output,GPL3_TEXT.resource)),{code:'ENOENT'});
});
