import { BehaviorRunner } from './behavior-runner.mjs';
import { BehaviorState } from './behavior-state.mjs';

// The world owns committed state and effects. Workers only propose one bounded step.
export class BehaviorSession {
  constructor(build,saved,{context,apply,notice=()=>{},gameplay}){
    this.data=new BehaviorState(build,saved,gameplay);this.context=context;this.apply=apply;this.notice=notice;
    this.runners=new Map();this.queue=[];this.pending=null;this.disposed=false;this.failures=[];this.elapsed=0;
  }
  async start(){
    try{
      await Promise.all(this.data.definitions.map(async artifact=>{
        const record=this.data.value.modules[artifact.definition.id];if(record.error){this.notice(`「${artifact.definition.name}」仍已停止：${record.error}`);return;}
        const runner=new BehaviorRunner(artifact.definition);this.runners.set(artifact.definition.id,runner);await runner.ready;
      }));
      await this.execute({type:'start',targetId:null},0,true);
    }catch(error){this.dispose();throw error;}
  }
  async execute(event,dt,strict=false){
    const context=this.context(),frame={dt,time:this.data.value.time,event,...context};
    const results=await Promise.all(this.data.definitions.map(async artifact=>{
      const id=artifact.definition.id,runner=this.runners.get(id);if(!runner||runner.closed||this.data.value.modules[id].error)return null;
      if(event.targetId&&!artifact.definition.targets.includes(event.targetId))return null;
      try{return {artifact,result:await runner.step(frame,this.data.value.modules[id].state)};}catch(error){return {artifact,error};}
    }));
    if(this.disposed)return;
    for(const entry of results.filter(Boolean)){
      const {artifact}=entry,id=artifact.definition.id;
      try{
        if(entry.error)throw entry.error;
        // Recheck against current geometry and player position, which may have moved
        // during the asynchronous computation. Commit only after the whole batch passes.
        const applied=this.data.apply(artifact,entry.result,{...frame,...this.context()});
        this.apply(applied,this.data.view);
      }catch(error){
        this.runners.get(id)?.dispose();this.data.value.modules[id].error=String(error.message).slice(0,600);
        const failure={id,name:artifact.definition.name,message:this.data.value.modules[id].error};this.failures.push(failure);
        if(strict)throw Error(`「${failure.name}」检查失败：${failure.message}`);
        this.notice(`「${failure.name}」已停止：${failure.message}`);
      }
    }
  }
  dispatch(type,targetId=null,dt=0){
    if(this.disposed||!this.runners.size)return Promise.resolve();
    if(type==='tick'&&this.pending)return this.pending;
    if(this.queue.length>=8)return this.pending||Promise.resolve();
    this.queue.push({event:{type,targetId},dt});
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
  dispose(){this.disposed=true;this.queue=[];for(const runner of this.runners.values())runner.dispose();this.runners.clear();}
}
