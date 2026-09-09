import {worldSnapshot,observableChange} from './harness/acceptance.mjs';
import {validateRequestStep} from './request-plan.mjs';

// Data-only diagnostics on an isolated preview. The caller enforces preview
// ownership; no input events, source evaluation or formal-world writes occur.
export function observePreview(engine) {
  const value=engine.behaviors.data.value,panels={};
  for(const [moduleId,module]of Object.entries(value.modules))for(const [key,panel]of Object.entries(module.panels||{}))panels[moduleId+':'+key]=panel;
  return {...worldSnapshot({playerHealth:engine.play.player?.health,
    objects:[...engine.objects.values()].map(object=>{
      const parts=engine.primitives.filter(p=>p.id===object.id),alive=engine.play.alive(object.id);
      return {...object,visible:object.visible!==false&&alive,solid:parts.some(p=>p.solid)&&alive,
        mesh:engine.meshes.has('object:'+object.id),health:engine.play.state.targets[object.id]?.health??0,
        color:object.appearanceTint||(parts.length&&parts.every(p=>p.color===parts[0].color)?parts[0].color:null)};
    }),inventory:value.inventory,items:value.items||{},resources:Object.fromEntries(engine.play.resources().map(resource=>[resource.id,resource])),panels}),gameplay:engine.play.snapshot()};
}

export async function stepPreview(engine,input) {
  const step=validateRequestStep(input);
  if(step.event.targetId&&!engine.objects.has(step.event.targetId))throw Error('REQUEST_TARGET_NOT_FOUND');
  if(step.event.type==='key'&&!engine.behaviorKeys.has(step.event.code))throw Error('REQUEST_KEY_NOT_DECLARED');
  if(step.player){
    if(engine.collision(step.player.x,step.player.y,step.player.z))throw Error('REQUEST_PLAYER_BLOCKED');
    Object.assign(engine.p,step.player);
  }
  await engine.behaviors.flush();
  const before=observePreview(engine),commands=[],previous=engine.behaviors.onStep,failedBefore=engine.behaviors.failures.length;
  engine.behaviors.onStep=value=>{commands.push(...value.result.commands);previous(value);};
  try{
    const dt=step.dt??.1;engine.play.tick(dt);engine.behaviors.data.value.time+=dt;
    if(step.event.type==='attack'){engine.performAttack();await engine.behaviors.flush();}
    else if(step.event.type==='equip')engine.play.equip(step.event.weapon);
    else if(step.event.type==='reload')engine.play.reload();
    else await engine.behaviors.execute({...step.event,targetId:step.event.targetId??null},dt,true);
    if(engine.behaviors.failures.length>failedBefore)throw Error(engine.behaviors.failures.at(-1).message);
    engine.render(performance.now()/1000);
    const after=observePreview(engine);
    return {label:step.label,event:step.event,player:{...engine.p},commands,before,after,change:observableChange(before,after)};
  }finally{engine.behaviors.onStep=previous;}
}
