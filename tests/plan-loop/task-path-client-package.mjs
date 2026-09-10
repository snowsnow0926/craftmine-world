import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

export function taskPathPackageArguments(args) {
 const allowed=new Set(['--packaged-root','--expected-commit','--expected-build-manifest-sha256','--deps-app','--output-parent']);
 const value={};
 for(let i=0;i<args.length;i+=2){const key=args[i],argument=args[i+1];if(!allowed.has(key)||Object.hasOwn(value,key)||!argument||argument.startsWith('--'))throw Error('INVALID_PATH_PACKAGE_ARGUMENT');value[key]=argument;}
 for(const key of allowed)if(!value[key])throw Error('MISSING_PATH_PACKAGE_ARGUMENT:'+key);
 if(!/^[a-f0-9]{40}$/.test(value['--expected-commit'])||!/^[a-f0-9]{64}$/.test(value['--expected-build-manifest-sha256']))throw Error('PACKAGE_EXPECTED_IDENTITY_REQUIRED');
 for(const key of ['--packaged-root','--deps-app','--output-parent'])if(!path.isAbsolute(value[key]))throw Error('ABSOLUTE_PATH_REQUIRED:'+key);
 if(path.basename(value['--output-parent'])!=='test-results')throw Error('OWNED_TEST_RESULTS_PARENT_REQUIRED');
 return {packaged:path.resolve(value['--packaged-root']),expectedCommit:value['--expected-commit'],expectedManifestHash:value['--expected-build-manifest-sha256'],deps:path.resolve(value['--deps-app']),parent:path.resolve(value['--output-parent'])};
}

export function assertTaskPathWorld(world,worldId) {
 assert.equal(world.id,worldId);assert.equal(world.state,'failed');assert.notEqual(world.playable,true);
 assert.equal(world.creation.stage,'build');assert.equal(world.creation.error.stage,'build');
 assert.equal(world.creation.error.code,'GODOT_TASK_PATH_TOO_LONG');
 assert.match(world.creation.error.message,/路径过长/);
 assert.equal(/(?:[A-Za-z]:[\\/]|\\\\)/.test(world.creation.error.message),false,'Player message must not disclose filesystem paths');
 assert.deepEqual(world.creation.stages.map(({id,status})=>({id,status})),[
  {id:'materialize',status:'passed'},{id:'project',status:'passed'},{id:'build',status:'failed'},{id:'confirm',status:'pending'}]);
}

export function refusedImportEvidence(profile,worldId) {
 const root=path.join(profile,'plugins/data/craftmine.world/godot'),file=path.join(root,'executor-ledger.json');
 const ledger=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(ledger.format,'craftmine.godot-executor-ledger/1');
 const jobs=Object.values(ledger.jobs).filter(job=>job.worldId===worldId);assert.equal(jobs.length,1,'One fixed initialization job, without automatic retry');
 const job=jobs[0];assert.equal(job.state,'failed');assert.equal(job.reason,'GODOT_TASK_PATH_TOO_LONG');
 assert.equal(job.attempts.length,1);const attempt=job.attempts[0];assert.equal(attempt.operation,'import');
 assert.match(attempt.failure.error,/^GODOT_TASK_PATH_TOO_LONG:/);assert.equal(attempt.failure.engineExitCode,null);
 assert.match(attempt.requestId,/^im-[a-f0-9]{24}$/);
 const task=path.join(root,'tasks',attempt.requestId);assert.equal(fs.existsSync(task),false,'Rejected import must allocate no task directory or engine log');
 return {jobId:job.jobId,requestId:attempt.requestId,reason:job.reason,failure:attempt.failure,taskDirectoryAbsent:true};
}
