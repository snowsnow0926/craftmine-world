// Materialize a known historical source fixture; never discover or open personal saves.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync,spawn} from 'node:child_process';
const root=path.resolve(process.env.CRAFTMINE_SOURCE_ROOT??process.cwd()),currentBases=path.resolve(process.env.CRAFTMINE_EVAL_BASES??path.join(root,'desktop/godot'));
const runtime=path.resolve(currentBases,'../build/runtime-resources/godot');assert.ok(fs.existsSync(path.join(runtime,'toolchain.lock.json')),'Prepared actual runtime is required');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const fixture=fs.mkdtempSync(path.join(root,'test-results/creation-legacy-c166-'));
const files=execFileSync('git',['ls-tree','-r','--name-only','c1660f12','desktop/godot'],{cwd:root,encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/);
assert.ok(files.length>0&&files.every(file=>file.startsWith('desktop/godot/')&&!file.split('/').includes('..')));
const archive=path.join(fixture,'source.zip');execFileSync('git',['archive','--format=zip','--output='+archive,'c1660f12','desktop/godot'],{cwd:root,windowsHide:true});execFileSync('tar',['-xf',archive,'-C',fixture],{windowsHide:true});
const target=path.join(fixture,'desktop/build/runtime-resources/godot');fs.mkdirSync(path.dirname(target),{recursive:true});fs.cpSync(runtime,target,{recursive:true,dereference:true});
fs.writeFileSync(path.join(fixture,'fixture.json'),JSON.stringify({format:'craftmine.legacy-source-fixture/1',revision:'c1660f12',sourceFiles:files.length,legacyBases:path.join(fixture,'desktop/godot'),currentBases,runtimeReadOnly:runtime},null,2));
const child=spawn(process.execPath,[path.join(import.meta.dirname,'creation-edit-native.mjs')],{cwd:root,env:{...process.env,CRAFTMINE_EDIT_LEGACY_BASES:path.join(fixture,'desktop/godot'),CRAFTMINE_EVAL_BASES:currentBases},windowsHide:true,stdio:'inherit'});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});child.on('exit',code=>{console.log('Historical source fixture: '+fixture);process.exitCode=code??1;});
