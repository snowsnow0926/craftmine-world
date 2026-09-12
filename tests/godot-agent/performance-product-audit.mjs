// Read-only post-shutdown audit of the isolated full product test databases.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const reportPath=process.argv[2];
assert.ok(reportPath&&path.isAbsolute(reportPath),'Absolute performance product report required');
const source=JSON.parse(fs.readFileSync(reportPath)),directory=path.dirname(path.resolve(reportPath));
assert.equal(source.format,'craftmine.performance-product/1');assert.equal(source.passed,true);
assert.equal(path.resolve(source.out),directory);
assert.equal(source.launches.length,2);
for(const launch of source.launches){
  assert.equal(launch.exit.code,0);
  for(const key of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(launch.audit[key],[]);
}
const dbFiles=['pi.sqlite','plugins/data/craftmine.world/tasks.sqlite'];
const hashes=()=>Object.fromEntries(dbFiles.map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(directory,'profile',file))).digest('hex')]));
const before=hashes();
const pi=new DatabaseSync(path.join(directory,'profile',dbFiles[0]),{readOnly:true});
const core=new DatabaseSync(path.join(directory,'profile',dbFiles[1]),{readOnly:true});
let audit;
try{
  audit={format:'craftmine.performance-product-database-audit/1',passed:false,reportPath,
    reportSha256:createHash('sha256').update(fs.readFileSync(reportPath)).digest('hex'),
    turns:pi.prepare('SELECT id,session_id,status,input_tokens,output_tokens FROM turns').all(),
    modelCallCount:pi.prepare('SELECT count(*) AS n FROM task_metric_calls').get().n,
    budgetRequestCount:core.prepare('SELECT count(*) AS n FROM craftmine_budget_requests').get().n,
    projects:core.prepare('SELECT world_id,revision,hash FROM craftmine_godot_projects').all(),
    jobs:core.prepare('SELECT id,kind,status,world_id,source_revision,build_id FROM craftmine_godot_jobs').all()};
  assert.equal(audit.turns.length,2);
  const expectedTurns=[source.first.probe.context.turnId,source.reopened.probe.context.turnId].sort();
  assert.deepEqual(audit.turns.map(turn=>turn.id).sort(),expectedTurns);
  for(const turn of audit.turns){assert.equal(turn.session_id,source.sessionId);assert.equal(turn.status,'completed');assert.equal(turn.input_tokens,0);assert.equal(turn.output_tokens,0);}
  assert.equal(audit.modelCallCount,0);assert.equal(audit.budgetRequestCount,0);
  assert.equal(audit.projects.length,1);assert.equal(audit.projects[0].world_id,source.worldId);assert.equal(audit.projects[0].revision,1);
  assert.equal(audit.jobs.length,1);const job=audit.jobs[0];
  assert.equal(job.kind,'check');assert.equal(job.status,'passed');assert.equal(job.source_revision,1);
  assert.equal(job.world_id,source.worldId);assert.equal(job.build_id,source.first.probe.result.scope.buildId);
}finally{pi.close();core.close();}
assert.deepEqual(hashes(),before);audit.databaseSha256=before;audit.databaseBytesUnchanged=true;audit.passed=true;
fs.writeFileSync(path.join(directory,'database-audit.json'),JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify(audit,null,2));
