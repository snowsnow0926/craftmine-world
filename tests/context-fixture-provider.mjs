// No real model call: this provider exercises context recording and the production pipeline.
import { AgentRunner } from '../app/agent.mjs';
import { encodeAgentScene } from '../app/scene.mjs';
import { flower } from './scene-fixtures.mjs';
AgentRunner.prototype.generate=async function(input){
  const task=this.store.data.tasks.find(t=>t.id===input.active.id),scene=structuredClone(this.store.readBuild(task.base).scene);
  if(task.prompt.includes('修复'))scene.behaviors[0].code=scene.behaviors[0].code.split('\n').filter(line=>!line.includes('CONTEXT_TEST_FAULT')).join('\n');
  else if(!scene.objects.some(o=>o.id==='context-flower'))scene.objects.push(flower('context-flower',3,9));
  else scene.objects.find(o=>o.id==='context-flower').parts[0].color='#bce293';
  this.attempt(input.active,input.number,a=>{a.generator='test-fixture';});
  return JSON.stringify({summary:task.prompt,notes:[],reuseCreations:[],scene:encodeAgentScene(scene)});
};
