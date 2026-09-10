import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {taskPathPackageArguments,assertTaskPathWorld,refusedImportEvidence} from './task-path-client-package.mjs';
const args=['--packaged-root',path.resolve('package'),'--expected-commit','a'.repeat(40),'--expected-build-manifest-sha256','b'.repeat(64),'--deps-app',path.resolve('deps'),'--output-parent',path.resolve('test-results')];
test('package acceptance requires explicit full identity and denies runtime or script overrides',()=>{
 assert.equal(taskPathPackageArguments(args).expectedCommit,'a'.repeat(40));
 for(const extra of [['--script','bad'],['--runtime-source','other'],['--expected-commit','c'.repeat(40)]])assert.throws(()=>taskPathPackageArguments([...args,...extra]));
 assert.throws(()=>taskPathPackageArguments(args.filter((_,i)=>i!==2&&i!==3)),/MISSING/);
 assert.throws(()=>taskPathPackageArguments(args.map(value=>value==='b'.repeat(64)?'unknown':value)),/IDENTITY/);
});
const world=()=>({id:'world-a',state:'failed',creation:{stage:'build',error:{stage:'build',code:'GODOT_TASK_PATH_TOO_LONG',message:'任务目录路径过长，无法开始构建。'},stages:[{id:'materialize',status:'passed'},{id:'project',status:'passed'},{id:'build',status:'failed'},{id:'confirm',status:'pending'}]}});
test('misleading stages, generic failure, leaked paths or playable worlds fail acceptance',()=>{
 assertTaskPathWorld(world(),'world-a');
 for(const mutate of [w=>w.creation.stage='project',w=>w.creation.error.stage='project',w=>w.creation.error.code='GODOT_JOB_FAILED',w=>w.creation.error.message+=' C:/private',w=>w.playable=true,w=>w.state='ready']){const item=world();mutate(item);assert.throws(()=>assertTaskPathWorld(item,'world-a'));}
});
test('refused import proof rejects retry, engine evidence or any allocated task directory',()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cm-path-ledger-')),root=path.join(profile,'plugins/data/craftmine.world/godot');fs.mkdirSync(root,{recursive:true});
 const id='im-'+'a'.repeat(24),job={jobId:'gjob-fixed',worldId:'world-a',state:'failed',reason:'GODOT_TASK_PATH_TOO_LONG',attempts:[{operation:'import',requestId:id,failure:{error:'GODOT_TASK_PATH_TOO_LONG: prepare',engineExitCode:null}}]};
 const write=()=>fs.writeFileSync(path.join(root,'executor-ledger.json'),JSON.stringify({format:'craftmine.godot-executor-ledger/1',jobs:{one:job}}));write();assert.equal(refusedImportEvidence(profile,'world-a').taskDirectoryAbsent,true);
 job.attempts[0].failure.engineExitCode=0;write();assert.throws(()=>refusedImportEvidence(profile,'world-a'));job.attempts[0].failure.engineExitCode=null;
 job.attempts.push(job.attempts[0]);write();assert.throws(()=>refusedImportEvidence(profile,'world-a'));job.attempts.pop();write();
 fs.mkdirSync(path.join(root,'tasks',id),{recursive:true});assert.throws(()=>refusedImportEvidence(profile,'world-a'));
});
