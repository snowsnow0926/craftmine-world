// Read-only replay of a recorded native check's immutable source and artifacts.
// Does not open Core, a source profile, or a model session; never registers a check.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {deriveAdditiveProgress} from '../desktop/godot/shared/progress-migration.mjs';

const [buildRoot,eventsFile,snapshotsFile,failedCheckFile]=process.argv.slice(2);
for(const value of [buildRoot,eventsFile,snapshotsFile,failedCheckFile])assert(value&&path.isAbsolute(value),'Pass absolute build root, recorded events, snapshots and failed verifier report');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const original=JSON.parse(await fs.readFile(failedCheckFile,'utf8')).evidence;
const inputs=JSON.parse(await fs.readFile(snapshotsFile,'utf8'));
const events=(await fs.readFile(eventsFile,'utf8')).split('\n').filter(Boolean).map(JSON.parse);
const record=events.find(event=>event.type==='tool-result'&&event.name==='godot_build_read'&&event.result?.jobId===original.jobId)?.result;
assert(record,'A native build-read record for the failed check is required');
const manifest=JSON.parse(await fs.readFile(path.join(buildRoot,'manifest.json'),'utf8'));
for(const key of ['worldId','buildId','baseId','sourceRevision','manifestHash'])assert.equal(manifest[key],record[key]);
for(const key of ['jobId','worldId','buildId'])assert.equal(original[key],record[key]);
assert.equal(original.inputHash,record.output.inputHash);assert.equal(inputs.previous.worldId,record.worldId);
assert.equal(record.output.format,'craftmine.godot-job-result/1');assert.equal(original.error,'MIGRATION_CREATION_STATE_INVALID');
const artifacts=record.output.artifacts;
assert.deepEqual(artifacts.map(({path,bytes,sha256})=>({path,bytes,sha256})),record.artifacts.map(({path,bytes,sha256})=>({path,bytes,sha256})));
const verify=async()=>{
  for(const [directory,files] of [[path.join(buildRoot,'source'),manifest.files],[path.join(buildRoot,'artifacts'),artifacts]]){
    for(const entry of files){assert(!path.isAbsolute(entry.path)&&!entry.path.split(/[\\/]/).includes('..'));
      const bytes=await fs.readFile(path.join(directory,entry.path));assert.equal(bytes.length,entry.bytes);assert.equal(sha(bytes),entry.sha256);}
  }
};
await verify();
const output=await fs.mkdtemp(path.resolve('test-results/desktop-native-creation-progress-'));
const profile=path.join(output,'profile'),empty=path.join(output,'empty');await fs.mkdir(profile);await fs.mkdir(empty);
const token=randomUUID();await fs.writeFile(path.join(profile,'headless-profile.json'),JSON.stringify({format:'craftmine.headless-profile/1',token,legacySource:empty,rendering:'offscreen'}));
const require=createRequire(path.resolve('vendor/pi-desktop/apps/desktop/package.json'));
const {build}=createRequire(path.resolve('vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
const appRoot=path.join(output,'app');
for(const [source,target] of [['tests/helpers/creation-progress-check-main.ts','main/index.cjs'],['vendor/pi-desktop/apps/desktop/electron/preload/godot-check.ts','preload/godot-check.cjs'],['vendor/pi-desktop/apps/desktop/electron/preload/craftmine-headless.ts','preload/craftmine-headless.cjs']])
  await build({entryPoints:[path.resolve(source)],outfile:path.join(appRoot,target),bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],logLevel:'warning'});
await fs.writeFile(path.join(appRoot,'package.json'),JSON.stringify({main:'main/index.cjs'}));
const env={CRAFTMINE_HEADLESS_TEST:'1',CRAFTMINE_HEADLESS_ROOT:output,CRAFTMINE_DATA_DIR:profile,CRAFTMINE_HEADLESS_TOKEN:token};
for(const key of ['SystemRoot','WINDIR','COMSPEC','PATH'])if(process.env[key])env[key]=process.env[key];
for(const key of ['APPDATA','LOCALAPPDATA','USERPROFILE','TEMP','TMP']){env[key]=path.join(output,key.toLowerCase());await fs.mkdir(env[key]);}
const child=spawn(require('electron'),[appRoot],{cwd:output,env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe','ipc']});
let resolveReady,rejectReady,guards;const ready=new Promise((r,j)=>{resolveReady=r;rejectReady=j;});
const pending=new Map(),logs=[];
for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{logs.push(String(chunk));if(logs.length>80)logs.shift();});
const started=setTimeout(()=>{rejectReady(Error('HELPER_STARTUP_TIMEOUT'));child.kill();},30000);
const exited=new Promise(resolve=>child.on('close',code=>{clearTimeout(started);rejectReady(Error('HELPER_EXITED:'+code));for(const call of pending.values())call.reject(Error('HELPER_EXITED:'+code));resolve(code);}));
child.on('error',rejectReady);
child.on('message',message=>{
  if(message?.kind==='creation-progress-ready'){clearTimeout(started);resolveReady();}
  if(message?.type==='craftmine-headless-exit')guards=message;
  if(message?.kind==='creation-progress-result'){const call=pending.get(message.id);if(call){pending.delete(message.id);message.error?call.reject(Error(message.error)):call.resolve(message.value);}}
});
const check=(label,descriptor)=>new Promise((resolve,reject)=>{const id=randomUUID();pending.set(id,{resolve,reject});child.send({kind:'creation-progress-check',method:'check',id,label,descriptor});});
const cancel=()=>child.connected&&child.send({kind:'creation-progress-check',method:'cancel'});
process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
const descriptor={format:'craftmine.godot-check-descriptor/1',phase:'check',jobId:record.jobId,worldId:record.worldId,buildId:record.buildId,
  baseId:record.baseId,inputHash:record.output.inputHash,root:path.join(buildRoot,'artifacts'),entry:'web/index.html',threads:true,artifacts,snapshot:inputs.previous};
const report={format:'craftmine.creation-progress-restore-test/1',output,passed:false,registration:'none; read-only artifact replay',
  sourceRevision:record.sourceRevision,manifestHash:record.manifestHash,buildId:record.buildId,originalJobId:record.jobId,originalError:original.error,
  sourceEdits:0,modelCalls:0,checks:{}};
let checked=false;
try {
  await ready;
  const saved=await check('saved',descriptor);report.checks.saved=saved;
  assert.equal(saved.evidence.passed,true,JSON.stringify(saved.evidence));assert.equal(saved.evidence.snapshot.equal,true);
  assert.deepEqual(saved.evidence.progressMigration.snapshot,inputs.previous);
  assert(saved.capture);assert.equal(saved.graphics.hardwareAcceleration,true);assert.equal(saved.graphics.angle,'platform-default');
  const outside=structuredClone(descriptor);outside.snapshot.body.player.position[0]=1e100;
  outside.jobId='gjob-'+sha(record.jobId+':outside');outside.inputHash=sha(JSON.stringify(outside.snapshot));
  assert.deepEqual(deriveAdditiveProgress(outside.snapshot,inputs.defaults).snapshot,outside.snapshot);
  const refused=await check('outside',outside);report.checks.outside=refused;
  assert.equal(refused.evidence.passed,false);assert.equal(refused.evidence.ready.ok,true);
  assert(refused.evidence.errors.runtime.includes('Saved player pose is outside the authored city'));
  assert.match(refused.evidence.error,/Saved player pose is outside the authored city/);
  assert(!refused.evidence.error.includes('MIGRATION_CREATION_STATE_INVALID'));
  // This is a deliberately rejected restore into the existing bridge surface,
  // not navigation, a source edit, or a replacement for the player's real save.
  const collision=structuredClone(descriptor);collision.snapshot.body.player.position[1]-=0.5;
  collision.jobId='gjob-'+sha(record.jobId+':collision');collision.inputHash=sha(JSON.stringify(collision.snapshot));
  assert.deepEqual(deriveAdditiveProgress(collision.snapshot,inputs.defaults).snapshot,collision.snapshot);
  const blocked=await check('collision',collision);report.checks.collision=blocked;
  assert.equal(blocked.evidence.passed,false);assert.equal(blocked.evidence.ready.ok,true);
  assert.match(blocked.evidence.error,/CREATION_COLLISION_GUARD_FAILED:PLAYER_PENETRATION/);
  await verify();checked=true;
} finally {
  process.off('SIGINT',cancel);process.off('SIGTERM',cancel);
  if(child.connected)child.send({kind:'creation-progress-check',method:'close'});
  const shutdown=setTimeout(()=>child.kill(),10000);const code=await exited;clearTimeout(shutdown);
  report.exitCode=code;report.guards=guards;
  report.passed=checked&&code===0&&['violations','pageErrors','shutdownFailures'].every(key=>Array.isArray(guards?.[key])&&guards[key].length===0);
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(output,'helper.log'),logs.join(''));
  assert.equal(code,0);assert.deepEqual(guards?.violations,[]);assert.deepEqual(guards?.pageErrors,[]);assert.deepEqual(guards?.shutdownFailures,[]);
}
console.log(JSON.stringify({passed:report.passed,output,position:inputs.previous.body.player.position,sourceRevision:record.sourceRevision}));
