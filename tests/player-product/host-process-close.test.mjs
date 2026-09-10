import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {EventEmitter, once} from 'node:events';
import {PassThrough} from 'node:stream';
import {createInterface} from 'node:readline';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';

const source=stripTypeScriptTypes(fs.readFileSync(new URL('../../vendor/pi-desktop/apps/desktop/electron/main/host-process.ts',import.meta.url),'utf8'),{mode:'transform'});
const body=source.slice(source.indexOf('export class HostProcess')).replace('export class HostProcess','class HostProcess');
function createHost(child,grace=20,force=15) {
  const Host=vm.runInNewContext(body+'\nHostProcess',{
    setTimeout,clearTimeout,console,randomUUID,createInterface,process,
    resolveHostBinary:()=>process.execPath,resolveBuiltinPluginsDir:()=>null,
    stripProxyEnv:env=>env,glibcMissingSymbol:()=>false,
    ErrorCodes:{HOST_UNAVAILABLE:'HOST_UNAVAILABLE'},
    HOST_DISPOSE_GRACE_MS:grace,HOST_FORCE_KILL_GRACE_MS:force,
    spawn:(_binary,_args,options)=>{assert.equal(options.windowsHide,true);return child;},
  });
  return new Host('owned-test-profile',()=>{});
}
function childFixture() {
  const child=new EventEmitter();
  Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,killed:false,kills:0});
  child.kill=()=>{child.kills++;child.killed=true;};
  return child;
}
const drain=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('host shares disposal, closes the transport, and waits beyond exit for child close',async()=>{
  const child=childFixture(),host=createHost(child);
  let rejected;
  host.pending.set('pending',{reject:error=>rejected=error,resolve(){}});
  const first=host.dispose(),second=host.dispose();assert.equal(first,second);
  assert.equal(child.stdin.writableEnded,true);assert.equal(rejected.errorCode,'HOST_UNAVAILABLE');
  let done=false;first.then(()=>done=true);
  child.emit('exit',0,null);await drain();assert.equal(done,false);assert.equal(child.kills,0);
  child.emit('close',0,null);await first;assert.equal(done,true);
});

test('already closed host completes without an extra kill',async()=>{
  const child=childFixture(),host=createHost(child);
  child.emit('exit',0,null);child.emit('close',0,null);
  await host.dispose();assert.equal(child.kills,0);
});

test('missing exit and close fail all callers after one owned kill',async()=>{
  const child=childFixture(),host=createHost(child),first=host.dispose(),second=host.dispose();
  assert.equal(first,second);
  const results=await Promise.allSettled([first,second]);
  assert.ok(results.every(r=>r.status==='rejected'&&r.reason.message==='HOST_CORE_CLOSE_TIMEOUT'));
  assert.equal(child.kills,1);assert.equal(results[0].reason,results[1].reason);
});

test('kill fallback must still reach actual close',async()=>{
  const child=childFixture(),host=createHost(child);let eofBeforeKill=false;
  child.kill=()=>{child.kills++;eofBeforeKill=child.stdin.writableEnded;child.emit('exit',null,'SIGKILL');child.emit('close',null,'SIGKILL');};
  await host.dispose();assert.equal(child.kills,1);assert.equal(eofBeforeKill,true);
});

test('an exited host with unclosed pipes reports timeout without killing again',async()=>{
  const child=childFixture(),host=createHost(child);child.emit('exit',0,null);
  await assert.rejects(host.dispose(),/HOST_CORE_CLOSE_TIMEOUT/);assert.equal(child.kills,0);
});

test('spawn error followed by close is a terminal boundary even without exit',async()=>{
  const child=childFixture(),host=createHost(child);
  child.emit('error',Error('controlled spawn failure'));child.emit('close',null,null);
  await host.dispose();assert.equal(child.kills,0);
});

test('real isolated Node child completes EOF and closes both pipes before host disposal returns',async t=>{
  const child=spawn(process.execPath,['-e','process.stdout.write("ready\\n");process.stderr.write("owned\\n");process.stdin.resume();process.stdin.on("end",()=>{process.stdout.write("done\\n");});'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();});
  const ready=once(child.stdout,'data'),host=createHost(child,3000,1000);
  let closed=false;child.once('close',()=>closed=true);
  await ready;await host.dispose();
  assert.equal(closed,true);assert.equal(child.exitCode,0);
  assert.equal(child.stdout.closed,true);assert.equal(child.stderr.closed,true);
});
