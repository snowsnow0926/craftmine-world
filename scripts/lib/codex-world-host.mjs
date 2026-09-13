import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash, randomUUID} from 'node:crypto';
import {materializeBase} from '../../desktop/godot/shared/materialize.mjs';

const require = createRequire(import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Only domain tools; no generic RPC, library proposals across worlds, legacy
// verification or model-selected draft recovery. Recovery is owned by begin().
const TOOL_NAMES = new Set(['godot_docs','godot_guidance','godot_project_index',
  'godot_file_read','godot_project_query','godot_project_patch','godot_project_facts',
  'godot_capability_report','godot_runtime_state','godot_view_capture',
  'godot_performance_observe','godot_asset_put','godot_asset_list',
  'godot_build_start','godot_build_read','godot_build_cancel',
  'godot_candidate_read','godot_candidate_list','godot_jobs','creation_operation',
  'requirements_read','blender_status','blender_generate','blender_job_read','blender_cancel']);

export class CodexWorldHost {
  constructor({state, data, core, services = {}, logger = {log(){},warn(){}}}) {
    this.state = state; this.data = data; this.ended = new Set();
    const resources = path.join(state.runtime, 'resources');
    const plugin = state.pluginRoot ?? path.join(resources,'plugins/craftmine.world');
    const {CoreClient}=require(path.join(plugin,'core-client.cjs'));
    const {createWorldTools}=require(path.join(plugin,'world-tools.cjs'));
    const {createHostRequests}=require(path.join(plugin,'host-requests.cjs'));
    const {createGodotExecutor}=require(path.join(plugin,'godot-executor.cjs'));
    const {createBlenderJobs}=require(path.join(plugin,'blender-jobs.cjs'));
    process.env.CRAFTMINE_BUNDLED_GIT = path.join(resources,'git/bin/git.exe');
    this.core = core ?? new CoreClient(path.join(resources,'bin/craftmine-core.exe'), state.coreData);
    const godot = path.join(resources,'godot');
    this.executor = createGodotExecutor(this.core,{dataPath:state.coreData,logger,verifier:services.verifier,
      toolchain:{broker:path.join(godot,'broker/godot-host-broker.exe'),brokerIdentity:path.join(godot,'broker/broker-identity.json'),
        engineRoot:path.join(godot,'engine/4.7.2-stable'),toolchainLock:path.join(godot,'toolchain.lock.json'),bridgePath:path.join(godot,'web/bridge.js')}});
    const blender = path.join(resources,'blender');
    this.blender = createBlenderJobs(this.core,{dataPath:state.coreData,
      toolchain:{runtimeRoot:blender,broker:path.join(blender,'broker/blender-host-broker.exe'),
        brokerIdentity:path.join(blender,'broker/broker-identity.json'),toolchainLock:path.join(blender,'toolchain.lock.json')},
      assertActive:async context => {
        this.assertActive(context);
        const current = await this.core.call('task.context',{context});
        if (current.world?.id !== state.worldId) throw Error('WORLD_BINDING_MISMATCH');
        this.assertActive(context);
      }});
    this.hostRequest = createHostRequests(this.core,{getSettings:async()=>({activeWorldId:state.worldId})});
    this.tools = createWorldTools(this.core,async()=>({activeWorldId:state.worldId}),context=>this.ended.has(context.turnId),undefined,undefined,{
      ...services.toolServices,
      blenderTool:(name,args,binding)=>this.blender.tool(name,args,binding),
      executorStatus:()=>this.executor.status(), executorEnqueue:(job,context)=>this.executor.enqueue(job,context),
      executorCancel:id=>this.executor.cancel(id), executorCreationCompletion:binding=>this.executor.creationCompletion(binding),
      executorNativeDiagnosticEvidence:record=>this.executor.nativeDiagnosticEvidence(record), buildReadWaitMs:30000,
    }).filter(tool=>TOOL_NAMES.has(tool.name));
  }
  assertActive(context) { if(this.ended.has(context.turnId)) throw Error('TURN_ENDED'); }
  async start({engines=true}={}) {
    await this.core.start();
    if (path.resolve(this.core.directory) !== path.resolve(this.state.coreData)) throw Error('CORE_SOURCE_STORE_CHANGED');
    this.engines=engines;
    if(engines) { await this.executor.start(); await this.blender.start(); }
  }
  async begin(context, text) {
    this.assertActive(context);
    if(this.enginesStopped) {await this.executor.start();this.enginesStopped=false;}
    if(context.projectId!==this.state.projectId||context.sessionId!==this.state.sessionId)throw Error('WORLD_BINDING_MISMATCH');
    const previous=await this.core.call('workspace.current',{projectId:context.projectId,sessionId:context.sessionId});
    if(previous&&previous.worldId!==this.state.worldId)throw Error('WORLD_BINDING_MISMATCH');
    // Use the existing native recovery contract without PI's provider request
    // window renewal. Codex owns its requests; this entry adds no model budget.
    if(previous?.task?.binding) {
      const binding=previous.task.binding;
      const retained=await this.core.call('task.context',{context:{projectId:binding.projectId,sessionId:binding.sessionId,turnId:binding.turnId}});
      if(retained.recovery==='interrupted') {
        if(retained.world?.id!==this.state.worldId||binding.projectId!==context.projectId||binding.sessionId!==context.sessionId||binding.turnId===context.turnId||!Number.isSafeInteger(retained.generation))throw Error('RECOVERY_BINDING_MISMATCH');
        const resumed=await this.core.call('task.resume',{context,taskId:binding.taskId,generation:retained.generation});
        if(resumed.workspace?.worldId!==this.state.worldId||resumed.workspace.task?.binding?.turnId!==context.turnId||resumed.generation!==retained.generation+1)throw Error('RECOVERY_BINDING_UNCONFIRMED');
      }
    }
    const result = await this.hostRequest('turn.begin',{context,selectedWorld:this.state.worldId,request:{id:context.turnId,text}});
    if(result.world.id!==this.state.worldId || result.binding.sessionId!==this.state.sessionId) throw Error('WORLD_BINDING_MISMATCH');
    this.assertActive(context);
    return result;
  }
  async end(context, status) {
    this.ended.add(context.turnId);
    // Fence source RPCs first. No result may be reported as cancelled before
    // this barrier commits. Native workers then drain under their own fences.
    await this.core.call('workspace.endTurn',{sessionId:context.sessionId,turnId:context.turnId,status});
    await Promise.all([this.blender.cancelTurn(context),this.executor.cancelTurn(context)]);
    if(status!=='completed'&&this.engines) {
      await this.executor.stop();this.enginesStopped=true;
    }
  }
  async sourceIdentity() {
    const content = await this.core.call('content.status',{worldId:this.state.worldId});
    return {worldId:this.state.worldId,repoId:content.repoId,backend:content.backend};
  }
  async stop() { await this.blender.stop(); await this.executor.stop(); await this.core.stop(); }

  async initializeBlank() {
    const {worldId,projectId,sessionId} = this.state;
    const directory=path.join(this.data,'managed-base');
    const metadata=materializeBase({baseId:'creation-sandbox',worldId,template:'blank',out:directory,enginePerformanceProfile:'engine-monitor/1'});
    const initial=JSON.parse(await fs.readFile(path.join(directory,'craftmine_initial_state.json'),'utf8'));
    const baseBuild=`initial-${worldId}`;
    await this.core.call('godotWorld.initialize',{worldId,title:worldId,baseId:metadata.baseId,baseBuild,
      snapshot:{format:'craftmine.godot-progress/1',worldId,baseId:metadata.baseId,baseVersion:metadata.baseVersion,stateVersion:1,body:initial.initialProgress}});
    const context={projectId,sessionId,turnId:randomUUID()};
    await this.begin(context,'Initialize the shipped blank creation sandbox source. This is not a playable application receipt.');
    try {
      const sourceExtensions=new Set(['.godot','.gd','.tscn','.tres','.gdshader','.gdshaderinc','.json','.cfg','.txt','.md','.csv','.svg','.obj','.mtl','.uid','.png','.jpg','.jpeg','.webp','.glb','.ogg','.wav']);
      const files=[];
      for(const item of metadata.files) {
        if(!sourceExtensions.has(path.extname(item.path))) continue;
        const bytes=await fs.readFile(path.join(directory,item.path));
        if(sha(bytes)!==item.sha256) throw Error('MANAGED_BASE_FILE_CHANGED');
        files.push({path:item.path,bytesBase64:bytes.toString('base64'),expectedHash:null});
      }
      const projectFile=files.find(file=>file.path==='project.godot');
      const project=await this.core.call('godotProject.create',{context,worldId,toolCallId:'base-create',baseBuild,baseId:metadata.baseId,
        files:[{path:'project.godot',text:Buffer.from(projectFile.bytesBase64,'base64').toString('utf8')}]});
      await this.core.call('godotProject.applyFiles',{context,worldId,toolCallId:'base-files',revision:project.revision,manifestHash:project.manifestHash,
        files:files.filter(file=>file!==projectFile)},60000);
      await this.core.call('content.migrate.apply',{worldId},60000);
      await this.end(context,'completed');
    } catch(error) { await this.end(context,'error'); throw error; }
    return this.sourceIdentity();
  }
}
