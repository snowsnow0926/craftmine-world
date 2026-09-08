// Headless game-runtime play probe. All actions call game logic directly in an
// owned /verify iframe; no input events, pointer lock or foreground operations.
export async function playWorld(w,build,snapshot,actions){
  const page=await w.page.context().newPage();await page.goto(new URL('/verify',w.page.url()).href);
  try{return await page.frameLocator('iframe').locator('body').evaluate(async(_,{build,snapshot,actions})=>{
    const {makeWorldRuntime}=await import('/app/world-runtime.mjs'),notices=[],steps=[];
    const Runtime=makeWorldRuntime({send:()=>{},inform:text=>notices.push(text),enter:document.getElementById('enter')});
    const engine=new Runtime(document.getElementById('world'),{onTarget:()=>{},onStats:()=>{},onNotice:()=>{},onControl:()=>{}});
    const save=()=>({format:'craftmine.progress/3',player:{...engine.p},gameplay:engine.play.snapshot(),behaviors:engine.behaviors.snapshot()});
    const collisions=()=>Object.fromEntries(build.scene.objects.map(o=>{const p=build.primitives.filter(p=>p.id===o.id&&p.solid).sort((a,b)=>a.min.y-b.min.y)[0];return [o.id,p?engine.collision((p.min.x+p.max.x)/2,6,(p.min.z+p.max.z)/2):false];}));
    function aim(id){
      const parts=engine.primitives.filter(p=>p.id===id&&p.visible!==false).sort((a,b)=>(Number(b.solid)-Number(a.solid))||a.min.y-b.min.y);
      for(const p of parts)for(const side of [0,Math.PI/2,Math.PI,-Math.PI/2]){
        const center={x:(p.min.x+p.max.x)/2,y:Math.max(p.min.y+.01,Math.min(p.max.y-.01,7.3)),z:(p.min.z+p.max.z)/2};
        const distance=1.3+(Math.abs(Math.sin(side))*(p.max.x-p.min.x)+Math.abs(Math.cos(side))*(p.max.z-p.min.z))/2;
        const x=center.x+Math.sin(side)*distance,z=center.z+Math.cos(side)*distance;if(engine.collision(x,6,z))continue;
        engine.p={x,y:6,z,yaw:side,pitch:Math.atan2(center.y-7.56,distance)};
        const hit=engine.pick([x,7.56,z],WorldRuntime.basis(engine.p).f,4);
        if(hit?.treeId===id)return;
      }
      throw Error('无法从四米内的可站立位置瞄准 '+id);
    }
    try{
      engine.setActive(false);await engine.generateBuild(build,snapshot);
      for(const action of actions){
        const before=save();if(action.id)aim(action.id);
        if(action.type==='interact')await engine.interact();
        else if(action.type==='attack'){
          if(!engine.play.equip(action.weapon||'melee'))throw Error('世界未启用所需武器');engine.input=true;
          for(let i=0;i<(action.count||20)&&engine.play.alive(action.id);i++){
            engine.attack();await engine.behaviors.flush();
            const weapon=engine.play.get(engine.play.state.equipped);engine.play.tick(weapon.config.cooldown+.02);engine.behaviors.data.value.time+=weapon.config.cooldown+.02;
            await engine.behaviors.dispatch('tick',null,.1);
          }
          engine.input=false;
        }else if(action.type==='tick'){engine.behaviors.data.value.time+=.1;await engine.behaviors.dispatch('tick',null,.1);}
        else throw Error('未知测试动作');
        engine.updateHud();const object=engine.objects.get(action.id),parts=engine.primitives.filter(p=>p.id===action.id);
        steps.push({action,before,snapshot:save(),notices:notices.slice(-8),mesh:engine.meshes.has('object:'+action.id),solid:parts.some(p=>p.solid&&p.visible!==false),objectVisible:object?.visible,collisions:collisions(),failures:structuredClone(engine.behaviors.failures)});
      }
      engine.render(1);return {steps,snapshot:save(),notices,collisions:collisions(),failures:engine.behaviors.failures,pointerLock:document.pointerLockElement!==null};
    }finally{engine.dispose();}
  },{build,snapshot,actions});}finally{await page.close();}
}
