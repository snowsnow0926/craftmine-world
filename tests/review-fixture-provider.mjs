// Explicitly preloaded only in the independent review test server; no model call is claimed.
import { AgentRunner } from '../app/agent.mjs';
import { encodeAgentScene } from '../app/scene.mjs';
import { flower } from './scene-fixtures.mjs';
AgentRunner.prototype.generate=async function(input){
  const task=this.store.data.tasks.find(t=>t.id===input.active.id),scene=structuredClone(this.store.readBuild(task.base).scene);
  if(task.prompt.includes('移除花'))scene.objects=scene.objects.filter(o=>o.id!=='review-flower');
  else{
    scene.objects[0].name='苔绿色木门';scene.objects[0].parts[0].color='#99b271';
    scene.objects.push(flower('review-flower',3,9));scene.behaviors[0].params.travel=2.4;scene.behaviors[0].code+='\n// 让通道更宽。';
  }
  this.attempt(input.active,input.number,a=>{a.generator='test-fixture';});
  return JSON.stringify({summary:task.prompt,notes:[],reuseCreations:[],scene:encodeAgentScene(scene)});
};
