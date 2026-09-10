// Fixed, headless broker compatibility probe. No UI, model or input automation.
// node this-file --broker <fixed exe> --engine-root <pinned version dir> --out <new short dir>
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const arg=name=>process.argv[process.argv.indexOf(name)+1];
for(const name of ['--broker','--engine-root','--out']) assert(process.argv.includes(name),`Missing ${name}`);
const root=path.resolve(arg('--out')), broker=path.resolve(arg('--broker')), engineRoot=path.resolve(arg('--engine-root'));
await fs.mkdir(root); // Exclusive new evidence directory; never reuse a task.
const project=path.join(root,'project');await fs.mkdir(project);
const source='config_version=5\n[application]\nconfig/name="Fixed long path diagnosis"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n';
await fs.writeFile(path.join(project,'project.godot'),source);
const sha=b=>createHash('sha256').update(b).digest('hex');
const results=[];
for(const target of [180,245,266]) {
 const taskId='im-fixedlength0000000000000000';
 const suffix=`/${taskId}/work/Packages/craftmine.godot.task.${taskId}/AC/Godot`;
 const base=`${root}/tasks-${target}/`;
 assert(target-base.length-suffix.length>0,'Use a shorter owned probe output path');
 const tasksRoot=base+'p'.repeat(target-base.length-suffix.length);await fs.mkdir(tasksRoot,{recursive:true});
 const request={schemaVersion:1,requestId:taskId,taskId,operation:'import',projectRoot:project,tasksRoot,engineRoot,
  sourceBinding:{worldId:'fixed-diag',buildId:'fixed-diag',sourceRevision:1,sourceDigest:sha(source)},inputHash:sha(source)};
 await fs.writeFile(path.join(root,`${target}-request.json`),JSON.stringify(request,null,2));
 const raw=await new Promise((resolve,reject)=>{
  const child=spawn(broker,['run'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,stdout,stderr}));
  child.stdin.on('error',()=>{});child.stdin.write(JSON.stringify(request)+'\n');
 });
 await fs.writeFile(path.join(root,`${target}-raw.json`),JSON.stringify(raw,null,2));
 const response=JSON.parse(raw.stdout.trim());
 const log=await fs.readFile(path.join(tasksRoot,taskId,'logs/task.log'),'utf8').catch(()=> '');
 await fs.writeFile(path.join(root,`${target}-task.log`),log);
 const entries=await fs.readdir(tasksRoot);
 const row={cacheUtf16Units:(tasksRoot+suffix).length,code:raw.code,state:response.state,exitCode:response.exitCode??null,
  error:response.error??null,cleanup:response.cleanup??null,processVerified:response.processVerification?.verified??null,
  networkVerified:response.networkPreflight?.verified??null,cacheError:log.includes('Could not create editor cache directory'),
  settingsError:log.includes('Error saving editor settings'),tasksRootEmpty:entries.length===0,
  sourceUnchanged:sha(await fs.readFile(path.join(project,'project.godot')))===sha(source)};
 results.push(row);console.log(JSON.stringify(row));
 await fs.writeFile(path.join(root,'report.json'),JSON.stringify({at:new Date().toISOString(),brokerSha256:sha(await fs.readFile(broker)),results},null,2));
 assert(row.sourceUnchanged);
 if(target<=245) {
  assert.equal(row.code,0);assert.equal(row.exitCode,0);assert.equal(row.processVerified,true);
  assert.equal(row.networkVerified,true);assert.equal(row.cleanup?.verified,true);
  assert.equal(row.cacheError,false);assert.equal(row.settingsError,false);
 } else {
  assert.equal(row.code,1);assert.match(row.error,/^GODOT_TASK_PATH_TOO_LONG:/);
  assert.equal(row.processVerified,null);assert.equal(row.networkVerified,null);
  assert.equal(row.tasksRootEmpty,true);assert.equal(log,'');
 }
}
