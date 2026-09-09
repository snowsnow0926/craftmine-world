import {observePreview,stepPreview} from './preview-probe.mjs';

// Available only through the dedicated native headless preload. The ordinary
// parent message protocol continues to reject request-step on a formal world.
export function installNativeGameAcceptance({getEngine,freeze}) {
  const capability=globalThis.__craftmineNativeAcceptance;
  if(!capability)return;
  const steps={
    'ranged-hit':{event:{type:'attack'},dt:.2,player:{x:.35,y:6,z:9,yaw:0,pitch:0}},
    'ranged-miss':{event:{type:'attack'},dt:.2,player:{x:3,y:6,z:9,yaw:0,pitch:0}},
    'ranged-far':{event:{type:'attack'},dt:.2,player:{x:.35,y:6,z:40,yaw:0,pitch:0}},
    'attack-now':{event:{type:'attack'},dt:0},
    'equip-melee':{event:{type:'equip',weapon:'melee'},dt:0},
    'equip-ranged':{event:{type:'equip',weapon:'ranged'},dt:0},
    'melee-far':{event:{type:'attack'},dt:.3,player:{x:.35,y:6,z:10,yaw:0,pitch:0}},
    'melee-hit':{event:{type:'attack'},dt:.3,player:{x:.35,y:6,z:8,yaw:0,pitch:0}},
    drain:{event:{type:'key',code:'KeyG'},dt:0},
    reload:{event:{type:'reload'},dt:0},
    'reload-complete':{event:{type:'tick'},dt:.4},
    tick:{event:{type:'tick'},dt:0},
  };
  capability.register(async name=>{
    const engine=getEngine();if(!engine)throw Error('NATIVE_GAME_NOT_LOADED');
    freeze();engine.pauseInput();engine.setActive(false);await engine.behaviors.flush();
    if(name==='observe')return observePreview(engine);
    if(name==='fall'){
      // Advance the actual collision/gravity/landing path, never assign health.
      const before=observePreview(engine);
      Object.assign(engine.p,{x:10,y:19,z:12,yaw:0,pitch:0});
      engine.vy=0;engine.grounded=false;engine.fallPeak=19;engine.input=true;
      try{for(let n=0;n<160&&!engine.grounded;n++){engine.update(.025,performance.now());await engine.behaviors.flush();}}
      finally{engine.pauseInput();}
      if(!engine.grounded)throw Error('NATIVE_FIXED_FALL_DID_NOT_LAND');
      engine.render(performance.now()/1000);
      return {before,after:observePreview(engine),player:{...engine.p}};
    }
    if(!Object.hasOwn(steps,name))throw Error('UNKNOWN_NATIVE_GAME_SCENARIO');
    return stepPreview(engine,{label:name,...structuredClone(steps[name])});
  });
  addEventListener('pagehide',()=>capability.clear(),{once:true});
}
