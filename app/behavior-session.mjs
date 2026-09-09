import { BehaviorRunner } from './behavior-runner.mjs';
import { BehaviorState } from './behavior-state.mjs';
import { BehaviorBinding } from './behavior-binding.mjs';
import { jsonRecord } from './behavior-contracts.mjs';

const disposeRunner=runner=>{try{Promise.resolve(runner?.dispose()).catch(()=>{});}catch{}};

// The world owns committed state and effects. Workers only propose one bounded step.
export class BehaviorSession {
  constructor(build,saved,{context,apply,notice=()=>{},gameplay,onStep=()=>{},extensions=null,runnerFactory=null}){
    this.data=new BehaviorState(build,saved,gameplay,extensions);this.context=context;this.apply=apply;this.notice=notice;
    this.runners=new Map();this.queue=[];this.pending=null;this.disposed=false;this.failures=[];this.elapsed=0;
    this.extensions=extensions;this.extensionStates=new Map();
    // runnerFactory 只用于测试注入假 Worker；生产路径始终是隔离 Worker。
    this.runnerFactory=runnerFactory||((authored,options)=>new BehaviorRunner(authored,options));
    this.bindings=new Map(this.data.definitions.map(b=>[b.definition.id,new BehaviorBinding(b.definition,extensions)]));
    this.onStep=onStep;
  }
  async start(){
    if(this.started)return;this.started=true;
    try{
      await Promise.all(this.data.definitions.map(async artifact=>{
        const record=this.data.value.modules[artifact.definition.id];if(record.error){this.notice(`「${artifact.definition.name}」仍已停止：${record.error}`);return;}
        const binding=this.bindings.get(artifact.definition.id),runner=this.runnerFactory(binding.authored,{localCoordinates:!!binding.binding,extensions:this.extensions});this.runners.set(artifact.definition.id,runner);await runner.ready;
      }));
      await this.execute({type:'start',targetId:null},0,true);
    }catch(error){this.dispose();throw error;}
  }
  async execute(event,dt,strict=false){
    // Stable order makes each consumer see inventory committed by earlier modules.
    // Each worker receives its own clone, never the host's mutable inventory.
    for(const artifact of this.data.definitions){
      if(this.disposed)return;
      const id=artifact.definition.id,runner=this.runners.get(id);if(!runner||runner.closed||this.data.value.modules[id].error)continue;
      if(event.type==='start'&&this.data.value.modules[id].initialized)continue;
      if(event.targetId&&!artifact.definition.targets.includes(event.targetId))continue;
      const frame={dt,time:this.data.value.time,event,...this.context(),...(artifact.definition.capabilities?.includes('inventory.read@1')?{inventory:structuredClone(this.data.value.inventory)}:{})};
      try{
        const binding=this.bindings.get(id),result=binding.result(await runner.step(binding.frame(frame),this.data.value.modules[id].state),frame);
        if(this.disposed)return;
        // Recheck against current geometry and player position, which may have moved
        // during the asynchronous computation. Commit only after the whole batch passes.
        const applied=this.data.apply(artifact,result,{...frame,...this.context()});
        this.onStep({id,frame,result});
        // 扩展命令本身不交给运行时：先派发，运行时只看到派发后的内核效果。
        const visible=this.extensions?.size?{...applied,effects:applied.effects.filter(effect=>!this.extensions.has(effect.type))}:applied;
        this.apply(visible,this.data.view);
        // 扩展命令：玩法只提出调用，效果由扩展沙箱算出来，再由宿主按扩展声明的权限落地。
        await this.resolveExtensions(artifact,applied.effects,frame);
        if(this.disposed)return;
        if(event.type==='start')this.data.value.modules[id].initialized=true;
      }catch(error){
        if(this.disposed)return;
        disposeRunner(this.runners.get(id));this.data.value.modules[id].error=String(error.message).slice(0,600);
        const failure={id,name:artifact.definition.name,message:this.data.value.modules[id].error};this.failures.push(failure);
        if(strict)throw Error(`「${failure.name}」检查失败：${failure.message}`);
        this.notice(`「${failure.name}」已停止：${failure.message}`);
      }
    }
  }
  async resolveExtensions(artifact,effects,frame){
    if(!this.extensions?.size||!effects?.length)return;
    const grouped=new Map();
    for(const command of effects){
      const entry=this.extensions.get(command.type);
      if(!entry)continue;
      const list=grouped.get(entry)||[];
      list.push(command);grouped.set(entry,list);
    }
    for(const [entry,commands] of grouped){
      for(const command of commands){
        const record=this.data.value.modules[artifact.definition.id],previous=record.extensions[entry.extensionId];
        if(previous&&previous.version!==entry.version)throw Error('扩展状态版本不匹配，原进度已保留');
        const binding=this.bindings.get(artifact.definition.id),currentFrame={...frame,...this.context()};
        const call=binding.extensionCall(command,currentFrame);
        const result=await entry.runner.apply({...call,state:previous?.state??null});
        if(this.disposed)return;
        const extensionState=jsonRecord(result.state);
        // Validate and commit effects before persisting the returned state.
        if(result.effects.length){
          const scoped={...entry,targets:entry.targets.map(id=>binding.localToWorld.get(id)||id)};
          const applied=this.data.applyExtensionEffects(artifact.definition.id,scoped,binding.extensionEffects(result.effects),{...frame,...this.context()});this.apply(applied,this.data.view);
        }
        this.data.value.modules[artifact.definition.id].extensions[entry.extensionId]={version:entry.version,state:extensionState};
        this.extensionStates.set(entry.extensionId,structuredClone(extensionState));
      }
    }
  }
  dispatch(type,targetId=null,dt=0,code=null){
    if(this.disposed||!this.runners.size)return Promise.resolve();
    if(type==='tick'&&this.pending)return this.pending;
    if(this.queue.length>=8)return this.pending||Promise.resolve();
    this.queue.push({event:{type,targetId,...(code?{code}:{})},dt});
    if(!this.pending)this.pending=this.drain().finally(()=>{this.pending=null;});
    return this.pending;
  }
  async drain(){while(this.queue.length&&!this.disposed){const item=this.queue.shift();await this.execute(item.event,item.dt);}}
  tick(dt){
    if(this.disposed)return;this.data.value.time+=dt;this.elapsed+=dt;
    if(this.elapsed>=.1&&!this.pending){const step=Math.min(.5,this.elapsed);this.elapsed=Math.max(0,this.elapsed-step);this.dispatch('tick',null,step);}
  }
  async flush(){if(this.pending)await this.pending;}
  snapshot(){return this.data.snapshot();}
  dispose(){this.disposed=true;this.queue=[];for(const runner of this.runners.values())disposeRunner(runner);this.runners.clear();}
}
