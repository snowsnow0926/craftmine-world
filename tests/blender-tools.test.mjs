import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url),deps=createRequire(path.join(root,'vendor/pi-desktop/packages/agent-runtime/package.json'));
const output=await fs.mkdtemp(path.join(os.tmpdir(),'cm-bl-tools-'));
const {build}=deps('esbuild');
await build({entryPoints:[path.join(root,'plugins/craftmine-world/world-tools.cjs')],outfile:path.join(output,'tools.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',alias:{'@babel/parser':deps.resolve('@babel/parser')},plugins:[{name:'domain-source',setup(builder){builder.onResolve({filter:/^\.\/domain\.cjs$/},()=>({path:path.join(root,'plugins/craftmine-world/domain-adapter.mjs')}));}}]});
const {createWorldTools}=require(path.join(output,'tools.cjs'));
test.after(()=>fs.rm(output,{recursive:true,force:true}));
function fixture({discussionOnly=false,runtimeKind='godot'}={}){
  const calls=[],received=[];const core={start:async()=>({godotProjects:true}),call:async(method,args)=>{calls.push(method);if(method==='workspace.open')return {worldId:'bound-world',task:{binding:{taskId:'bound-task'}}};if(method==='world.read')return {runtimeKind};throw Error(method);}};
  const options={blenderTool:async(name,args,binding)=>{received.push({name,args,binding});return {status:'queued'};}};
  const invocation={projectId:'project',sessionId:'session',turnId:'turn',toolCallId:'call',executionId:'execution'};
  const tools=createWorldTools(core,async()=>({activeWorldId:'bound-world',discussionOnly}),()=>false,null,null,options);
  return {tools,calls,received,call:(name,args)=>tools.find(tool=>tool.name===name).execute(args,invocation)};
}
const args={name:'house',script:'import bpy',revision:1,manifestHash:'1'.repeat(64),expectedHash:null};
test('Blender tools are registered with host-only scope and exact source identity',async()=>{const f=fixture();assert.equal(f.tools.filter(tool=>tool.name.startsWith('blender_')).length,4);await f.call('blender_generate',args);assert.deepEqual(f.received[0].args,args);assert.equal(f.received[0].binding.worldId,'bound-world');assert.equal(f.received[0].binding.workspace.task.binding.taskId,'bound-task');assert.deepEqual(f.received[0].binding.context,{projectId:'project',sessionId:'session',turnId:'turn'});});
test('untrusted model executable, path, receipt and identity fields fail before lease acquisition',async()=>{for(const key of ['worldId','projectRoot','executable','receipt','toolchain','context','outputPath']){const f=fixture();await assert.rejects(f.call('blender_generate',{...args,[key]:'forged'}));assert.equal(f.calls.length,0);assert.equal(f.received.length,0);}});
test('discussion turns refuse generation and cancellation but permit status',async()=>{const f=fixture({discussionOnly:true});await assert.rejects(f.call('blender_generate',args),/DISCUSSION_MODE_READ_ONLY/);await assert.rejects(f.call('blender_cancel',{jobId:'0'.repeat(36)}),/DISCUSSION_MODE_READ_ONLY/);assert.equal(f.calls.length,0);await f.call('blender_status',{});assert.equal(f.received.length,1);});
test('legacy worlds cannot use Godot-bound Blender asset writes',async()=>{const f=fixture({runtimeKind:'legacy'});await assert.rejects(f.call('blender_generate',args),/GODOT_WORLD_REQUIRED/);assert.equal(f.received.length,0);});
