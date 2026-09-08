import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fork} from 'node:child_process';
import {register} from 'node:module';
import {pathToFileURL} from 'node:url';
import coreClient from '../plugins/craftmine-world/core-client.cjs';

fs.mkdirSync('test-results',{recursive:true});
const dir=fs.mkdtempSync(path.resolve('test-results/desktop-core-'));
const binary=path.resolve('vendor/pi-desktop/target/release/craftmine-core.exe');
const checks=[],errors=[];
const check=(name,value,detail)=>{checks.push({name,passed:!!value,detail});assert.ok(value,name);console.log('PASS '+name);};
const binding={projectId:'world-a',sessionId:'session-a',turnId:'turn-a',taskId:'task-a',baseBuild:'build-a'};
const draft={format:'craftmine.scene/3',objects:[]};
let client=new coreClient.CoreClient(binary,path.join(dir,'domain'));
let runtime;
const previous=process.env.PI_DESKTOP_DATA_DIR;
try {
  const hello=await client.start();
  check('独立 Rust 服务真实启动并使用 SQLite',hello.storage==='sqlite');
  await client.call('task.start',{binding,draft});
  const params={binding,toolCallId:'real_call_1',revision:0,request:{add:'tree'},draft:{...draft,objects:[{id:'tree'}]}};
  const receipt=await client.call('task.commit',params);
  await client.stop();client=new coreClient.CoreClient(binary,path.join(dir,'domain'));await client.start();
  const replay=await client.call('task.commit',params);
  check('进程重启后重复回执不会再次修改草稿',receipt.revision===1&&replay.revision===1);
  await assert.rejects(client.call('task.inspect',{binding:{...binding,sessionId:'other'}}),/BINDING_MISMATCH/);
  check('其他会话不能读取任务',true);
  await client.call('task.cancel',{binding});
  await assert.rejects(client.call('task.commit',{...params,toolCallId:'late',revision:1}),/TASK_INACTIVE/);
  check('取消后 Rust 拒绝迟到修改',true);
  await client.stop();

  process.env.PI_DESKTOP_DATA_DIR=path.join(dir,'pi-host');
  const desktop=path.resolve('vendor/pi-desktop/apps/desktop');
  register(pathToFileURL(path.join(desktop,'test/helpers/ts-import-hooks.mjs')));
  const {PluginRuntime}=await import(pathToFileURL(path.join(desktop,'electron/main/plugin-runtime.ts')).href);
  runtime=new PluginRuntime({
    hostEntry:path.join(desktop,'electron/main/plugin-host-process.mjs'),
    spawnProcess:({entry})=>{
      const child=fork(entry,[],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,CRAFTMINE_CORE_BIN:binary}});
      return {postMessage:message=>{if(child.connected)child.send(message);},onMessage:handler=>child.on('message',handler),onExit:handler=>child.on('exit',code=>handler(code??0)),kill:()=>child.kill()};
    },
  });
  await runtime.loadFromPath(path.resolve('desktop/build/craftmine.world'),['ui.view','agent.tool.register','background.service']);
  check('PI 插件宿主自动启动 Rust 常驻服务',runtime.getServiceStates().some(service=>service.serviceId==='world-core'&&service.state==='running'));
  const tool=runtime.getTools().find(tool=>tool.name==='runtime_info');
  const result=await tool.execute({toolCallId:'forged'},{sessionId:'s',turnId:'t',toolCallId:'host-call',executionId:'dispatch'});
  check('PI 工具调用连接真实 Rust 服务且保留宿主身份',result.core.storage==='sqlite'&&result.invocation.toolCallId==='host-call');
  check('尚未接入的世界写入能力如实关闭',result.worldWritesAvailable===false);
  await runtime.unload('craftmine.world');
  check('插件卸载后常驻服务停止',!runtime.getServiceStates().some(service=>service.state==='running'));
} catch(error) {errors.push(error.stack);process.exitCode=1;console.error(error);}
finally {
  await client.stop();
  if(runtime)for(const loaded of runtime.listLoaded())await runtime.unload(loaded.manifest.id);
  if(previous===undefined)delete process.env.PI_DESKTOP_DATA_DIR;else process.env.PI_DESKTOP_DATA_DIR=previous;
  fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({checks,errors},null,2));
  console.log('Report: '+path.join(dir,'report.json'));
}
