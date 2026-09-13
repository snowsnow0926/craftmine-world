// Native regression: import an existing world-template archive into a NEW
// profile, check/apply, save real movement, recheck identical source, first-load
// and apply again, then cold reopen. No model calls, fake verdicts or OS input.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {register} from 'node:module';
import {CoreClient} from '../plugins/craftmine-world/core-client.cjs';
import {createPlayerWorldLibrary} from '../plugins/craftmine-world/player-world-library.cjs';
import {writeState,STATE_FORMAT} from '../scripts/lib/codex-world-session.mjs';
import {CodexWorldHost} from '../scripts/lib/codex-world-host.mjs';
import {startCodexLiveService} from '../scripts/lib/codex-live-service.mjs';
import {checkCurrentSource} from '../scripts/codex-live-world.mjs';
register(new URL('../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {createGodotWorldFactory}=await import('../vendor/pi-desktop/apps/desktop/electron/main/godot-world-creation.ts');
const {initializationFileBatches}=await import('../vendor/pi-desktop/apps/desktop/electron/main/godot-world-initialization.ts');
const [runtime,pluginRoot,archivePath,data]=process.argv.slice(2);
for(const value of [runtime,pluginRoot,archivePath,data])assert(value&&path.isAbsolute(value),'Pass runtime, built plugin, readonly template ZIP and NEW output as absolute paths');
fs.mkdirSync(data);fs.mkdirSync(path.join(data,'empty'));
const root=path.resolve(import.meta.dirname,'..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={format:'craftmine.godot-applied-recheck-native/1',data,modelCalls:0,physicalInputSent:false,archivePath,archiveSha256:sha(fs.readFileSync(archivePath)),stages:[],passed:false};
const write=()=>fs.writeFileSync(path.join(data,'report.json'),JSON.stringify(report,null,2));write();
const state={format:STATE_FORMAT,model:'gpt-6-astra',effort:'xhigh',projectId:'codex-world-'+randomUUID(),sessionId:'codex-'+randomUUID(),runtime,coreData:path.join(data,'core'),pluginRoot,threadId:null,active:null};
process.env.CRAFTMINE_BUNDLED_GIT=path.join(runtime,'resources/git/bin/git.exe');
let core=new CoreClient(path.join(runtime,'resources/bin/craftmine-core.exe'),state.coreData),host,live;
const controller=new AbortController();process.on('SIGINT',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
const stage=async(name,fn)=>{const entry={name,startedAt:new Date().toISOString()};report.stages.push(entry);write();try{entry.result=await fn();entry.passed=true;return entry.result;}catch(error){entry.error=error.stack;throw error;}finally{entry.endedAt=new Date().toISOString();write();}};
async function start(){host=new CodexWorldHost({state,data});live=await startCodexLiveService({state,data,core:host.core});host=new CodexWorldHost({state,data,core:host.core,services:live});await host.start();return {helper:live.directory};}
async function stop(){if(!host)return;const helper=live.directory;await host.stop({beforeCoreStop:()=>live.stop()});const guards=JSON.parse(fs.readFileSync(path.join(helper,'guards.json')));assert.deepEqual(guards.violations,[]);assert.deepEqual(guards.pageErrors,[]);host=null;live=null;return {helper,guards};}
try{
 await stage('import-and-initialize-reference-source',async()=>{
  await core.start();const call=(method,args)=>core.call(method,args,120000),directory=path.join(data,'template-operations');
  const library=createPlayerWorldLibrary({call,selected:async()=>state.worldId??'pending',directory});
  const imported=await library.importArchive({operationId:'import-reference',archivePath,archiveSha256:report.archiveSha256});
  const worldsRoot=path.join(data,'managed-worlds'),factory=createGodotWorldFactory({worldsRoot,catalogFile:path.join(root,'desktop/godot/bases/base-catalog.json'),basesRoot:path.join(root,'desktop/godot/bases'),libraryStagingRoot:path.join(directory,'prepared'),domain:(method,args)=>method==='worldTemplate.prepare'?library.prepare(args):call(method,args),materialize:()=>{throw Error('REFERENCE_MUST_USE_WORLD_LIBRARY');}});
  const created=await factory.create({title:'Applied artifact recheck regression',baseId:'creation-sandbox',starterId:'library',operationId:'create-reference',libraryRef:imported.ref});state.worldId=created.id;
  const project=path.join(worldsRoot,created.id),manifest=JSON.parse(fs.readFileSync(path.join(project,'managed-base.json'))),context={projectId:state.projectId,sessionId:state.sessionId,turnId:randomUUID()};
  await call('workspace.open',{context,selectedWorld:created.id});const task=await call('task.context',{context});
  let index=await call('godotProject.create',{context,worldId:created.id,toolCallId:'initial-project',baseBuild:task.binding.baseBuild,baseId:'creation-sandbox',files:[{path:'project.godot',text:fs.readFileSync(path.join(project,'project.godot'),'utf8')}]});
  const files=manifest.files.filter(item=>item.path!=='project.godot').map(item=>({path:item.path,bytesBase64:fs.readFileSync(path.join(project,item.path)).toString('base64'),expectedHash:null}));
  for(const [number,batch]of initializationFileBatches(files).entries())index=await call('godotProject.applyFiles',{context,worldId:created.id,toolCallId:'initial-files-'+number,revision:index.revision,manifestHash:index.manifestHash,files:batch});
  await call('content.migrate.apply',{worldId:created.id});await call('workspace.endTurn',{sessionId:context.sessionId,turnId:context.turnId,status:'completed'});
  const identity=await call('content.status',{worldId:created.id});state.sourceIdentity={worldId:created.id,repoId:identity.repoId,backend:identity.backend};writeState(data,state);await core.stop();core=null;
  return {imported,worldId:state.worldId,source:index};
 });
 await stage('start-native',start);
 const first=await stage('first-real-check',()=>checkCurrentSource(host,state,{signal:controller.signal}));
 await stage('first-real-firstload-and-apply',async()=>{const result=await live.call('apply',{candidateId:first.candidateId});assert.equal(result.status,'applied');return result;});
 const before=await stage('first-formal-descriptor',()=>host.core.call('godotRuntime.describe',{worldId:state.worldId}));
 await stage('move-and-save-current-progress',async()=>{await live.call('resume');await live.call('walk',{forward:0,right:1,frames:20});await live.call('pause');const save=await live.call('save');assert.equal(save.status,'persisted');const formal=await host.core.call('godotRuntime.describe',{worldId:state.worldId});assert.notDeepEqual(formal.snapshot.body.player.position,before.snapshot.body.player.position);return {save,formal};});
 const saved=report.stages.at(-1).result.formal;
 const fingerprints=before.artifacts.map(a=>({path:a.path,bytes:a.bytes,sha256:sha(fs.readFileSync(path.join(before.root,a.path))),mtimeMs:fs.statSync(path.join(before.root,a.path)).mtimeMs}));
 const second=await stage('second-real-check-same-source',()=>checkCurrentSource(host,state,{signal:controller.signal}));
 await stage('verify-reuse-and-fresh-native-check',async()=>{
  const old=await host.core.call('godotBuild.read',{worldId:state.worldId,jobId:first.jobId}),job=await host.core.call('godotBuild.read',{worldId:state.worldId,jobId:second.jobId});
  assert.equal(job.status,'passed');assert.equal(job.buildId,old.buildId);assert.equal(job.sourceRevision,old.sourceRevision);assert.equal(job.manifestHash,old.manifestHash);assert.notEqual(job.jobId,old.jobId);
  assert.equal(job.output.import.passed,true);assert.equal(job.output.check.passed,true);
  for(const id of ['runtime.ready','runtime.frame','runtime.no-errors','runtime.snapshot','runtime.isolation','runtime.recovery'])assert.equal(job.output.check.assertions.find(a=>a.id===id)?.passed,true);
  assert.deepEqual(job.output.check.progressMigration.snapshot,saved.snapshot);
  const reuse=JSON.parse(job.output.check.assertions.find(a=>a.id==='export.reused').detail);assert.equal(reuse.scope,'current-applied-build');assert.equal(reuse.originJobId,old.jobId);assert.equal(reuse.originOutputHash,old.outputHash);
  assert.deepEqual(job.output.artifacts,old.output.artifacts);
  const after=before.artifacts.map(a=>({path:a.path,bytes:a.bytes,sha256:sha(fs.readFileSync(path.join(before.root,a.path))),mtimeMs:fs.statSync(path.join(before.root,a.path)).mtimeMs}));assert.deepEqual(after,fingerprints);
  return {old,job,reuse,fingerprints};
 });
 await stage('second-real-firstload-and-apply',async()=>{const result=await live.call('apply',{candidateId:second.candidateId});assert.equal(result.status,'applied');await live.call('pause');return result;});
 await stage('save-after-second-apply',async()=>{const snapshot=(await live.call('snapshot')).state;assert.deepEqual(snapshot.body.player.position,saved.snapshot.body.player.position);const result=await live.call('save');assert.equal(result.status,'persisted');return {snapshot,result,capture:await live.capture()};});
 const last=report.stages.at(-1).result.snapshot;
 await stage('retire-first-host',stop);await stage('cold-native-start',start);
 await stage('cold-open-and-verify',async()=>{await live.call('openPaused');const snapshot=(await live.call('snapshot')).state;assert.deepEqual(snapshot,last);return {snapshot,capture:await live.capture()};});
 assert.equal(sha(fs.readFileSync(archivePath)),report.archiveSha256);report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{try{await stage('retire-native',stop);await core?.stop();}catch(error){report.shutdownError=error.stack;report.passed=false;process.exitCode=1;}write();console.log(JSON.stringify({passed:report.passed,data,error:report.error}));}
