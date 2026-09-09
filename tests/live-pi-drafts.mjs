// Real pinned pi-agent-core + pi-ai + DeepSeek, real plugin and Rust drafts.
// The invocation session is an isolated harness fixture, not Electron's UI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {register} from 'node:module';
import {fork} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {desktopRuntimePaths} from './helpers/desktop-runtime-paths.mjs';
import {loadLocalConfig} from '../app/local-config.mjs';
import {deepseekKey,modelId,modelProvider,thinkingEnabled,reasoningEffort} from '../app/agent-model.mjs';

const secrets=process.env.CRAFTMINE_LIVE_CONFIG;
if(!secrets||!path.isAbsolute(secrets))throw Error('Set CRAFTMINE_LIVE_CONFIG to the authorized project secrets file');
loadLocalConfig(secrets);
if(modelProvider()!=='deepseek'||!deepseekKey())throw Error('Configured DeepSeek credentials are required; no fallback model is used');
const dependencies=path.resolve('vendor/pi-desktop/packages/agent-runtime/node_modules/@earendil-works');
const {Agent}=await import(pathToFileURL(path.join(dependencies,'pi-agent-core/dist/index.js')));
const {streamSimple}=await import(pathToFileURL(path.join(dependencies,'pi-ai/dist/api/openai-completions.js')));
fs.mkdirSync('test-results',{recursive:true});
const directory=fs.mkdtempSync(path.resolve('test-results/live-pi-drafts-'));
const {desktop,plugin,binary,hostEntry}=desktopRuntimePaths(directory);
process.env.PI_DESKTOP_DATA_DIR=path.join(directory,'profile');
register(pathToFileURL(path.join(desktop,'test/helpers/ts-import-hooks.mjs')));
const {PluginRuntime,pluginProcessEnv}=await import(pathToFileURL(path.join(desktop,'electron/main/plugin-runtime.ts')));
const runtime=new PluginRuntime({hostEntry,spawnProcess:({entry,pluginId})=>{
  const child=fork(entry,[],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:pluginProcessEnv(pluginId,{...process.env,CRAFTMINE_CORE_BIN:binary})});
  return {postMessage:value=>{if(child.connected)child.send(value);},onMessage:handler=>child.on('message',handler),onExit:handler=>child.on('exit',code=>handler(code??0)),kill:()=>child.kill()};
}});
const context={projectId:'pi-live-fixture',sessionId:randomUUID(),turnId:randomUUID()};
const calls=[],requests=[],checks=[],errors=[];
const model={id:modelId(),name:modelId(),provider:'deepseek',api:'openai-completions',baseUrl:'https://api.deepseek.com',reasoning:true,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:1000000,maxTokens:32768,compat:{thinkingFormat:'deepseek',supportsDeveloperRole:false,maxTokensField:'max_tokens'}};
let agent;
const check=(name,condition)=>{checks.push({name,passed:!!condition});assert.ok(condition,name);console.log('PASS '+name);};
const tool=(name)=>runtime.getTools().find(entry=>entry.name===name);
const inspect=()=>tool('project_inspect').execute({}, {...context,toolCallId:'inspection-'+randomUUID(),executionId:randomUUID()});
const read=async(id)=>{
  let start=0,text='';
  do {
    const result=await tool('resource_read').execute({kind:'object',id,start,limit:16000},{...context,toolCallId:'inspection-'+randomUUID(),executionId:randomUUID()});
    text+=result.text;start=result.next;
  }while(start!==null);
  return JSON.parse(text);
};
const load=()=>runtime.loadFromPath(plugin,['ui.view','agent.tool.register','background.service','fs.read']);
const bindTools=()=>runtime.getTools().filter(entry=>entry.name!=='runtime_info').map(entry=>({
  name:entry.fullName,label:entry.name,description:entry.description,parameters:entry.schema,executionMode:'sequential',
  execute:async(toolCallId,args,signal)=>{
    if(signal?.aborted)throw Error('Aborted before tool execution');
    const record={name:entry.name,toolCallId,args,turnId:context.turnId};calls.push(record);
    console.log('PI tool '+entry.name);
    try {
      const result=await tool(entry.name).execute(args,{...context,toolCallId,executionId:randomUUID()});
      record.result=result;return {content:[{type:'text',text:JSON.stringify(result)}],details:result};
    }catch(error){record.error=String(error);throw error;}
  },
}));
const deadline=setTimeout(()=>agent?.abort(),10*60*1000);
try {
  await load();
  const world=await runtime.invokePanelBridge('craftmine.world','world.create',{title:'真实 PI 创作试验'});
  agent=new Agent({
    initialState:{systemPrompt:'你是 craftmine world / 最中幻想里的世界创作助手。根据玩家要求，实际调用提供的世界工具编写草稿。先检查世界和必要契约；修改已有资源前读取它及哈希。遵守工具返回的真实错误并修复。不要模拟工具调用或工具结果。只把已通过工具的工作报告为已完成。当前阶段只保存草稿，尚未接通候选验收和应用，请如实告知。继续请求沿用已有草稿，不要重建世界。',model,tools:bindTools(),thinkingLevel:thinkingEnabled()?reasoningEffort():'off'},
    streamFn:(m,ctx,options)=>{
      requests.push({turnId:context.turnId,model:m.id,messages:ctx.messages.length});
      console.log('DeepSeek request '+requests.length+' ('+m.id+')');
      if(requests.length>20)agent.abort();
      return streamSimple(m,ctx,{...options,maxTokens:32768,maxRetries:1});
    },
    getApiKey:()=>deepseekKey(),toolExecution:'sequential',
    beforeToolCall:async()=>calls.length>=32?{block:true,terminate:true,reason:'Live acceptance tool budget exhausted'}:undefined,
  });
  agent.subscribe(event=>{
    if(event.type==='message_end'&&event.message.role==='assistant') {
      const {usage,stopReason,errorMessage}=event.message;
      requests.at(-1).response={usage,stopReason,...(errorMessage?{errorMessage}: {})};
    }
  });
  await agent.prompt('请在空白世界的 (3,6,3) 处种一棵树，给它 ID forest-tree。有清楚的树干和树冠，树干材质 wood，树叶材质 leaves，总高度至少 3 米。请真正写入草稿。');
  const first=await inspect(),tree=await read('forest-tree');
  const trunk=tree.parts.filter(part=>part.material==='wood'),leaves=tree.parts.filter(part=>part.material==='leaves');
  check('真实 DeepSeek 经 PI 工具调用生成树的持久草稿',first.total===1&&first.workspaceRevision>0&&trunk.length>0&&leaves.length>0);
  check('树干与树叶具有要求的几何和位置',tree.position.x===3&&tree.position.y===6&&tree.position.z===3&&Math.max(...tree.parts.map(part=>part.offset.y+part.size.y))>=3);
  check('树干实际接触地面，没有把部件中心误当最小角',Math.abs(Math.min(...trunk.map(part=>tree.position.y+part.offset.y))-6)<0.001);
  const firstCalls=calls.length;
  await runtime.endCraftmineTurn({...context,status:'completed'});
  await runtime.unload('craftmine.world');await load();
  context.turnId=randomUUID();agent.state.tools=bindTools();
  await agent.prompt('继续修改刚才的 forest-tree：把树冠放大一些。树干、树的位置都保持原样，不要增加第二棵树。先重新读取当前草稿，因为服务已经重启。');
  const second=await inspect(),modified=await read('forest-tree');
  const volume=parts=>parts.reduce((n,part)=>n+part.size.x*part.size.y*part.size.z,0);
  check('真实模型重启后读取原资源并按哈希修改同一棵树',calls.slice(firstCalls).some(call=>call.name==='resource_read'&&!call.error)&&second.total===1&&second.resumedFrom===first.taskId);
  check('放大树冠保留树干和树的位置',JSON.stringify(modified.parts.filter(part=>part.material==='wood'))===JSON.stringify(trunk)&&JSON.stringify(modified.position)===JSON.stringify(tree.position)&&volume(modified.parts.filter(part=>part.material==='leaves'))>volume(leaves));
  const formal=await runtime.invokePanelBridge('craftmine.world','world.open',{id:world.id});
  check('两轮真实创作仍未越过玩家应用，正式世界保持原状',formal.contentHash===world.contentHash);
  fs.writeFileSync(path.join(directory,'trees.json'),JSON.stringify({first:tree,second:modified},null,2));
}catch(error){errors.push(String(error.stack||error));console.error(String(error));process.exitCode=1;}
finally {
  clearTimeout(deadline);agent?.abort();await agent?.waitForIdle();
  await runtime.endCraftmineTurn({...context,status:errors.length?'error':'completed'}).catch(error=>errors.push(String(error)));
  for(const entry of runtime.listLoaded())await runtime.unload(entry.manifest.id);
  const transcript=agent?.state.messages.map(message=>({...message,content:Array.isArray(message.content)?message.content.filter(block=>block.type!=='thinking'):message.content}));
  fs.writeFileSync(path.join(directory,'transcript.json'),JSON.stringify(transcript,null,2));
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({format:'craftmine.live-pi-drafts/1',time:new Date().toISOString(),model:model.id,thinking:thinkingEnabled()?reasoningEffort():'off',scope:'Actual pinned pi-agent-core/pi-ai, DeepSeek, plugin process and Rust; fixture host invocation session, no native model configuration, candidate verification or application',pricing:'not reported; zero rates in probe model are placeholders',passed:!errors.length&&checks.every(check=>check.passed),checks,requests,calls,errors},null,2));
  console.log('Live PI draft report: '+path.join(directory,'report.json'));
}
