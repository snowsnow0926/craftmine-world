import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fork} from 'node:child_process';
import {register} from 'node:module';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {desktopRuntimePaths} from './helpers/desktop-runtime-paths.mjs';
import {flower} from './scene-fixtures.mjs';

fs.mkdirSync('test-results',{recursive:true});
const directory=fs.mkdtempSync(path.resolve('test-results/desktop-drafts-'));
const {desktop,plugin,binary,hostEntry}=desktopRuntimePaths(directory);
const checks=[],errors=[];
const check=(name,condition)=>{assert.ok(condition,name);checks.push({name,passed:true});console.log('PASS '+name);};
const previous=process.env.PI_DESKTOP_DATA_DIR;
process.env.PI_DESKTOP_DATA_DIR=path.join(directory,'profile');
register(pathToFileURL(path.join(desktop,'test/helpers/ts-import-hooks.mjs')));
const {PluginRuntime,pluginProcessEnv}=await import(pathToFileURL(path.join(desktop,'electron/main/plugin-runtime.ts')));
const runtime=new PluginRuntime({hostEntry,spawnProcess:({entry,pluginId})=>{
  const child=fork(entry,[],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:pluginProcessEnv(pluginId,{...process.env,CRAFTMINE_CORE_BIN:binary})});
  return {postMessage:value=>{if(child.connected)child.send(value);},onMessage:handler=>child.on('message',handler),onExit:handler=>child.on('exit',code=>handler(code??0)),kill:()=>child.kill()};
}});
const panel=(channel,payload={})=>runtime.invokePanelBridge('craftmine.world',channel,payload);
const context={projectId:'pi-project-a',sessionId:'session-a',turnId:'turn-a',toolCallId:'host-call',executionId:'dispatch-1'};
let calls=0;
const run=(name,args={},scope=context)=>runtime.getTools().find(tool=>tool.name===name).execute(args,{...scope,toolCallId:scope.toolCallId+'-'+(++calls)});
const load=()=>runtime.loadFromPath(plugin,['ui.view','agent.tool.register','background.service','fs.read']);
try {
  await load();
  const a=await panel('world.create',{title:'测试花园'});
  const b=await panel('world.create',{title:'另一个世界'});
  await panel('world.open',{id:a.id});
  const tools=runtime.getTools();
  check('真实插件注册查询、契约、资源读取与草稿修改工具',tools.filter(t=>['project_inspect','capabilities_read','resource_read','workspace_patch'].includes(t.name)).length===4);
  await assert.rejects(run('project_inspect',{},{}),/HOST_IDENTITY_REQUIRED/);
  await assert.rejects(run('project_inspect',{sessionId:'forged'}),/参数|字段/);
  const initial=await run('project_inspect');
  check('首次查询绑定 Rust 世界，伪造身份不能成为参数',initial.worldId===a.id&&initial.workspaceRevision===0);
  await panel('world.open',{id:b.id});
  check('切换世界面板不会重定向正在创作的会话',(await run('project_inspect')).worldId===a.id);
  await panel('world.open',{id:a.id});
  await assert.rejects(run('project_inspect',{}, {...context,sessionId:'session-b'}),/WORLD_BUSY/);
  check('另一会话不能同时获得同一世界的草稿写入权',true);
  const contract=await run('capabilities_read',{section:'objects',limit:100});
  check('能力契约按需分段，不把完整世界和代码塞进返回值',contract.text.length===100&&contract.next===100);
  const behavior={format:'craftmine.behavior/2',id:'flower-action',name:'花的动作',description:'测试新模块',code:'export function step({state}) {return {state,commands:[]};}',stateVersion:1,initialState:{},params:{},targets:['test-flower'],permissions:['objects.write'],requires:[],binding:null,keys:[]};
  const request={workspaceRevision:0,operations:[
    {op:'add',kind:'object',id:'test-flower',expectedHash:null,value:flower('test-flower',4,4)},
    {op:'add',kind:'behavior',id:behavior.id,expectedHash:null,value:behavior},
  ]};
  const patch=tools.find(tool=>tool.name==='workspace_patch');
  const receipt=await patch.execute(request,context);
  check('新增花与玩法模块一起编译并存入 Rust 草稿',receipt.workspaceRevision===1&&receipt.changed.length===2);
  const read=await run('resource_read',{kind:'object',id:'test-flower'});
  const value={...JSON.parse(read.text),name:'修改后的花'};
  await runtime.unload('craftmine.world');await load();
  const replay=await runtime.getTools().find(t=>t.name==='workspace_patch').execute(request,{...context,executionId:'dispatch-2'});
  check('重启插件和 Rust 后恢复旧回执，不重复新增',replay.replayed&&replay.workspaceRevision===1&&(await run('project_inspect')).total===2);
  await assert.rejects(runtime.getTools().find(t=>t.name==='workspace_patch').execute({...request,workspaceRevision:1},context),/REPLAY_MISMATCH/);
  const replace={workspaceRevision:1,operations:[{op:'replace',kind:'object',id:value.id,expectedHash:read.hash,value}]};
  const changed=await run('workspace_patch',replace);
  check('重启后读取来源仍有效，可以用原哈希替换资源',changed.workspaceRevision===2);
  await assert.rejects(run('workspace_patch',replace),/STALE_DRAFT/);
  const bad={workspaceRevision:2,operations:[{op:'add',kind:'object',id:'invalid',expectedHash:null,value:{...value,id:'invalid',parts:[]}}]};
  await assert.rejects(run('workspace_patch',bad),/几何/);
  check('编译失败和过期补丁保留最后一次有效草稿',(await run('project_inspect')).workspaceRevision===2);
  await assert.rejects(run('workspace_patch',{...bad,operations:[{...bad.operations[0],value:{...bad.operations[0].value,name:'花'.repeat(65000)}}]}),/TOOL_INPUT_TOO_LARGE/);
  check('中文工具载荷按 UTF-8 字节限制大小',(await run('project_inspect')).workspaceRevision===2);
  const formal=await panel('world.open',{id:a.id});
  check('草稿修改没有改动正式世界和玩家进度',formal.contentHash===a.contentHash);
  await assert.rejects(panel('lifecycle.turnEnded',{sessionId:context.sessionId,turnId:context.turnId,status:'aborted'}),/Unsupported/);
  await runtime.endCraftmineTurn({sessionId:context.sessionId,turnId:context.turnId,status:'aborted'});
  await assert.rejects(run('project_inspect'),/TURN_ENDED/);
  check('宿主停止会拒绝迟到工具，页面不能伪造停止其他会话',true);
  const next={...context,turnId:'turn-b'};
  const resumed=await run('project_inspect',{},next);
  const resumedResource=await run('resource_read',{kind:'object',id:'test-flower'},next);
  check('新一轮继续保留修改后的代码并指明来源',resumed.resumedFrom===initial.taskId&&JSON.parse(resumedResource.text).name==='修改后的花');
  await runtime.endCraftmineTurn({sessionId:context.sessionId,turnId:'turn-b',status:'completed'});
  const other=await run('project_inspect',{}, {...context,sessionId:'session-b'});
  check('上一轮结束后另一会话可以获得世界写入权',other.worldId===a.id);
  const locked=new DatabaseSync(path.join(directory,'profile/plugins/data/craftmine.world/tasks.sqlite'));
  locked.exec('BEGIN IMMEDIATE');
  try {
    await assert.rejects(runtime.endCraftmineTurn({sessionId:'session-b',turnId:context.turnId,status:'aborted'}),/locked/);
    await assert.rejects(run('project_inspect',{}, {...context,sessionId:'session-b'}),/TURN_ENDED/);
  }finally {locked.exec('ROLLBACK');locked.close();}
  await runtime.endCraftmineTurn({sessionId:'session-b',turnId:context.turnId,status:'aborted'});
  check('停止写库失败时仍拒绝迟到工具，解锁后可补写停止记录',true);
  await runtime.endCraftmineTurn({sessionId:'late-session',turnId:'late-turn',status:'aborted'});
  await assert.rejects(run('project_inspect',{}, {...context,sessionId:'late-session',turnId:'late-turn'}),/TURN_ENDED/);
  check('停止早于首个工具时也不会事后创建任务',true);
}catch(error){errors.push(error.stack);console.error(error);process.exitCode=1;}
finally {
  for(const plugin of runtime.listLoaded())await runtime.unload(plugin.manifest.id);
  if(previous===undefined)delete process.env.PI_DESKTOP_DATA_DIR;else process.env.PI_DESKTOP_DATA_DIR=previous;
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({scope:'Rust service and real PI plugin process; fixture host invocation identity; no real model or Electron main acceptance',checks,errors},null,2));
  console.log('Report: '+path.join(directory,'report.json'));
}
