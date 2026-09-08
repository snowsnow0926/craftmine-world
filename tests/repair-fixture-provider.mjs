// Only loaded via --import by an independent test server. Production does not load this file.
import { AgentRunner } from '../app/agent.mjs';
import { encodeAgentScene } from '../app/scene.mjs';
const original=AgentRunner.prototype.generate;
AgentRunner.prototype.generate=async function(input){
  const task=this.store.data.tasks.find(t=>t.id===input.active.id),mode=process.env.CRAFTMINE_REPAIR_FIXTURE;
  if(!['live','live-cancel','scripted','cancel','limit'].includes(mode))throw Error('Missing explicit repair test mode');
  if(input.number>1&&['live','live-cancel'].includes(mode)){
    const result=original.call(this,input);if(mode==='live-cancel')this.attempt(input.active,input.number,a=>{a.testProviderPid=this.child.pid;});return result;
  }
  this.attempt(input.active,input.number,a=>{a.generator='test-fixture';});
  if(mode==='cancel'&&input.number>1){await new Promise(resolve=>input.active.abort.signal.addEventListener('abort',resolve,{once:true}));throw Error('Fixture cancelled');}
  if(mode==='limit')return '{ invalid fixture JSON';
  const scene=structuredClone(this.store.readBuild(task.base).scene),door=scene.behaviors.find(d=>d.params.travel);
  door.params.travel=2.4;
  if(input.number===1)door.code=door.code.replace('export function step(','function originalStep(')+'\nexport function step(context){ if(context.frame.event.type === "interact") return missingDoorMotion(context); return originalStep(context); }';
  return JSON.stringify({summary:'调整门的滑动距离为 2.4 米',notes:[],reuseCreations:[],scene:encodeAgentScene(scene)});
};
