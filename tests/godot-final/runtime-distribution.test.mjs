import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {runtimeRepositoryPath,runtimeDecision,stageRuntimeSourceSnapshot} from '../../desktop/delivery/lib/runtime-distribution.mjs';
import {checkPackage} from '../../desktop/delivery/lib/preflight-core.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('actual packaged runtime layout maps to its exact repository path',()=>{
  assert.equal(runtimeRepositoryPath('resources/godot/shared/tests/progress.mjs'),'desktop/godot/shared/tests/progress.mjs');
  assert.equal(runtimeRepositoryPath('resources/plugins/another/progress.mjs'),null);
});
test('missing declarations and unresolved third-party redistribution fail closed',()=>{
  assert.throws(()=>runtimeDecision('desktop/godot/shared/unknown.mjs',new Map()),/UNDECLARED/);
  const index=new Map([['x',[{distribution:['app-bundle'],redistribution:'unreviewed'}]]]);
  assert.throws(()=>runtimeDecision('x',index),/REDISTRIBUTION_DENIED/);
});
test('real stage copies permitted bytes and excludes declared tests before writing',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'craftmine-distribution-')),sources=new Map(),index=new Map();
  for(const [relative,include]of [['desktop/godot/shared/materialize.mjs',true],['desktop/godot/shared/tests/progress.mjs',false],['desktop/godot/bases/side-view/tools/new-world.mjs',true]]){
    const bytes=Buffer.from(relative);sources.set(relative,{bytes});index.set(relative,[{distribution:[include?'app-bundle':'development-only'],redistribution:'permitted',bytes:bytes.length,sha256:hash(bytes)}]);
  }
  const destination=path.join(root,'godot'),result=stageRuntimeSourceSnapshot(sources,destination,index);
  assert.equal(result.included.length,2);assert.equal(result.excluded.length,1);
  assert.equal(fs.existsSync(path.join(destination,'shared/tests/progress.mjs')),false);
  assert.equal(fs.readFileSync(path.join(destination,'bases/side-view/tools/new-world.mjs'),'utf8'),'desktop/godot/bases/side-view/tools/new-world.mjs');
  const other=path.join(root,'rejected');index.get('desktop/godot/shared/materialize.mjs')[0].sha256='wrong';
  assert.throws(()=>stageRuntimeSourceSnapshot(sources,other,index),/PIN_MISMATCH/);assert.equal(fs.existsSync(other),false);
});
test('K detects development-only leakage at actual resources/godot paths',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'craftmine-package-path-')),directory=path.join(root,'package');
  fs.mkdirSync(path.join(root,'desktop/delivery/base-assets'),{recursive:true});
  fs.writeFileSync(path.join(root,'desktop/delivery/base-assets/shared.json'),JSON.stringify({format:'craftmine.base-assets/1',sourceDirectory:'desktop/godot/shared',entries:[{path:'tests/progress.mjs',distribution:['development-only']}]}));
  fs.mkdirSync(path.join(directory,'resources/godot/shared/tests'),{recursive:true});fs.writeFileSync(path.join(directory,'resources/godot/shared/tests/progress.mjs'),'leaked test');
  const result=checkPackage(root,directory);
  assert.ok(result.failures.some(x=>x.code==='DEVELOPMENT_ONLY_FILE_SHIPPED'));
  assert.ok(result.failures.some(x=>x.code==='PACKAGE_ASSET_DISTRIBUTION'));
});
