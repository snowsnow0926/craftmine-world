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
    this.extensions=extensions;this.extensionStates=new Map();this.gameplay=gameplay;
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
        const draft=this.data.fork(),applied=draft.apply(artifact,result,{...frame,...this.context()});
        const batch={draft,changed:new Set(applied.changed),effects:applied.effects.filter(effect=>!this.extensions?.has(effect.type)),extensionStates:new Map()};
        // Neither state nor visible effects escape while any extension may fail.
        // Later commands observe the staged state of earlier commands.
        await this.resolveExtensions(artifact,applied.effects,frame,batch);
        if(this.disposed)return;
        draft.value.time=this.data.value.time;
        if(event.type==='start')draft.value.modules[id].initialized=true;
        const visible=draft.finalize(draft.value,batch.changed,batch.effects,this.stagedFrame(frame,batch));
        this.data.value=draft.value;this.data.view=draft.view;
        for(const [extensionId,state]of batch.extensionStates)this.extensionStates.set(extensionId,state);
        this.apply(visible,this.data.view);
        this.onStep({id,frame,result});
      }catch(error){
        if(this.disposed)return;
        disposeRunner(this.runners.get(id));this.data.value.modules[id].error=String(error.message).slice(0,600);
        const failure={id,name:artifact.definition.name,message:this.data.value.modules[id].error};this.failures.push(failure);
        if(strict)throw Error(`「${failure.name}」检查失败：${failure.message}`);
        this.notice(`「${failure.name}」已停止：${failure.message}`);
      }
    }
  }
  stagedFrame(frame,batch){
    const live=this.context(),view=batch.draft.view;
    const value={...frame,...live,time:this.data.value.time,player:structuredClone(live.player),objects:view.objects.map(object=>({
      id:object.id,position:structuredClone(object.position),visible:object.visible!==false,
      solid:view.primitives.some(primitive=>primitive.id===object.id&&primitive.solid),
      health:live.objects.find(item=>item.id===object.id)?.health??0,
    }))};
    if(Object.hasOwn(frame,'inventory'))value.inventory=structuredClone(batch.draft.value.inventory);
    for(const effect of batch.effects){
      if(effect.type==='health.add'&&value.player.health!==null){
        const maximum=Object.values(this.gameplay?.systems||{}).find(system=>system.type==='health')?.maxHealth??10000;
        value.player.health=Math.max(0,Math.min(maximum,value.player.health+effect.amount));
      }
      if(effect.type==='player.impulse')value.player.grounded=false;
      const target=value.objects.find(object=>object.id===effect.id);
      if(target&&effect.type==='target.damage')target.health=Math.max(0,target.health-effect.amount);
      if(target&&effect.type==='target.revive')target.health=this.gameplay?.targets?.[effect.id]?.maxHealth??0;
    }
    for(const object of value.objects)if(this.gameplay?.targets?.[object.id]&&object.health===0)object.visible=false;
    return value;
  }
  async resolveExtensions(artifact,effects,frame,batch){
    if(!this.extensions?.size||!effects?.length)return;
    for(const command of effects){
      const entry=this.extensions.get(command.type);
      if(!entry)continue;
        const record=batch.draft.value.modules[artifact.definition.id],previous=record.extensions[entry.extensionId];
        if(previous&&previous.version!==entry.version)throw Error('扩展状态版本不匹配，原进度已保留');
        const binding=this.bindings.get(artifact.definition.id),currentFrame=this.stagedFrame(frame,batch);
        const call=binding.extensionCall(command,currentFrame);
        const result=await entry.runner.apply({...call,state:previous?.state??null});
        if(this.disposed)return;
        const extensionState=jsonRecord(result.state);
        // Validate and commit effects before persisting the returned state.
        if(result.effects.length){
          const scoped={...entry,targets:entry.targets.map(id=>binding.localToWorld.get(id)||id)};
          const applied=batch.draft.applyExtensionEffects(artifact.definition.id,scoped,binding.extensionEffects(result.effects),this.stagedFrame(frame,batch));
          for(const id of applied.changed)batch.changed.add(id);
          batch.effects.push(...applied.effects);
        }
        batch.draft.value.modules[artifact.definition.id].extensions[entry.extensionId]={version:entry.version,state:extensionState};
        batch.extensionStates.set(entry.extensionId,structuredClone(extensionState));
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
