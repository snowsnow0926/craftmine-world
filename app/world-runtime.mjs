import { objectContentBounds } from './asset-binding.mjs';
import { WorldAssets } from './world-assets.mjs';
import { GameplaySession } from './gameplay.mjs';
import { primitiveVertices,intersects,rayBox } from './geometry.mjs';
import { BehaviorSession } from './behavior-session.mjs';
export function makeWorldRuntime({send,inform,enter,isFrozen=()=>false}){
  const {VoxelRuntime,B,index,basis}=WorldRuntime;
  class BlankRuntime extends VoxelRuntime {
    bindInput() {
      this.listen(document,'pointerlockchange',()=>{this.locked=document.pointerLockElement===this.canvas;this.input=this.locked;this.keys.clear();enter.hidden=this.locked;});
      this.listen(document,'pointerlockerror',()=>{if(!isFrozen()){this.input=true;inform('按住画面拖动环顾，WASD 移动');}});
      this.listen(document,'mousemove',e=>{if(!isFrozen()&&this.active&&this.input&&(this.locked||this.dragging)){this.p.yaw-=e.movementX*.0022;this.p.pitch=Math.max(-1.52,Math.min(1.52,this.p.pitch-e.movementY*.0022));}});
      this.listen(this.canvas,'pointerdown',e=>{if(isFrozen()||this.play?.dead)return;this.input=true;this.canvas.focus();if(!this.locked){this.dragging=true;this.canvas.setPointerCapture(e.pointerId);}else if(e.button===0)this.attack();enter.hidden=true;});
      for(const type of ['pointerup','pointercancel','lostpointercapture'])this.listen(this.canvas,type,()=>this.dragging=false);
      this.listen(this.canvas,'contextmenu',e=>e.preventDefault());
      this.listen(document,'keydown',e=>{
        if(isFrozen())return;
        if(e.code==='KeyT'&&!e.repeat){e.preventDefault();this.pauseInput();enter.hidden=false;send('agent',{selected:this.target?.treeId||null});return;}
        if(e.code==='Escape'){this.pauseInput();enter.hidden=false;return;}
        if(e.code==='Enter'&&this.play?.dead){this.revive();return;}
        if(this.input&&!e.repeat){
          if(e.code==='Digit1')this.play?.equip('ranged');
          if(e.code==='Digit2')this.play?.equip('melee');
          if(e.code==='KeyR'&&this.play?.reload())inform('正在换弹');
          if(e.code==='KeyF'&&this.play?.equip('melee'))this.attack();
          if(e.code==='KeyE'){e.preventDefault();this.interact();}
        }
        if(this.input&&['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight'].includes(e.code)){e.preventDefault();this.keys.add(e.code);}
      });
      this.listen(document,'keyup',e=>this.keys.delete(e.code));
      this.listen(window,'blur',()=>{this.pauseInput();enter.hidden=false;});
      this.listen(document,'visibilitychange',()=>{if(document.hidden)this.pauseInput();});
      this.listen(this.canvas,'webglcontextlost',e=>{e.preventDefault();this.setActive(false);send('error',{message:'图形上下文丢失，请刷新以恢复已保存的世界。'});});
    }
    async generateBuild(value,snapshot) {
      const wasActive=this.active;this.setActive(false);this.worldAssets=new WorldAssets(this);await this.worldAssets.load(value);
      this.config={night:value.scene.night,speed:4.5,treeStyle:'pine'};
      this.world.fill(0);this.trees.clear();this.treeAt.clear();this.edits={};this.collected=[];
      for(let z=-48;z<48;z++)for(let x=-48;x<48;x++){
        this.heightmap[(z+48)*96+x+48]=6;
        for(let y=0;y<6;y++)this.put(x,y,z,y===0?B.BEDROCK:y===5?B.GRASS:B.DIRT);
      }
      this.objects=new Map(value.scene.objects.map(o=>[o.id,o]));
      this.primitives=value.primitives||[];
      this.play=new GameplaySession(value.scene.systems||[],value.scene.objects,snapshot.gameplay);
      for(const [x,y,z,material,id]of value.voxels){this.put(x,y,z,material);this.treeAt.set(index(x,y,z),id);}
      this.p={...snapshot.player};this.fly=false;this.vy=0;this.grounded=false;
      this.behaviors=new BehaviorSession(value,snapshot.behaviors,{context:()=>this.behaviorContext(),apply:(result,view)=>this.applyBehavior(result,view),notice:inform,gameplay:this.play.state});
      this.primitives=this.behaviors.data.view.primitives;this.objects=new Map(this.behaviors.data.view.objects.map(o=>[o.id,o]));
      for(let z=-48;z<48;z+=16)for(let x=-48;x<48;x+=16)this.rebuild(x,z);
      for(const o of value.scene.objects)if(this.play.alive(o.id)&&this.objects.get(o.id).visible!==false){
        this.rebuildObject(o.id);
      }
      this.makeWater();this.makeClouds();this.night=value.scene.night?1:0;this.safePosition();this.changed();
      await this.behaviors.start();this.updateHud();this.setActive(wasActive);
    }
    drawMesh(mesh,locations){if(mesh?.asset){this.assetDraws.push(mesh);return;}super.drawMesh(mesh,locations);if(mesh===this.clouds&&this.assetDraws?.length){this.worldAssets.drawAll(this.assetDraws);this.assetDraws=[];}}
    rebuildObject(id){const key='object:'+id,old=this.meshes.get(key);if(old?.buffer)this.gl.deleteBuffer(old.buffer);this.meshes.delete(key);const object=this.objects.get(id);if(!object||object.visible===false||!this.play.alive(id))return;const parts=this.primitives.filter(p=>p.id===id);if(parts.length)this.meshes.set(key,object.appearance?this.worldAssets.mesh(object):this.upload(primitiveVertices(parts)));}
    behaviorContext(){return {player:{position:{x:this.p.x,y:this.p.y,z:this.p.z},grounded:this.grounded,health:this.play.player?.health??null},objects:[...this.objects.values()].map(o=>({id:o.id,position:o.position,visible:o.visible!==false&&this.play.alive(o.id),solid:this.primitives.some(p=>p.id===o.id&&p.solid),health:this.play.state.targets[o.id]?.health||0}))};}
    inspectObject(id){
      const object=this.objects.get(id);if(!object)throw Error('这一版中没有这个对象');
      const parts=this.primitives.filter(p=>p.id===id);
      const min={},max={};for(const k of ['x','y','z']){min[k]=parts.length?Math.min(...parts.map(p=>p.min[k])):object.position[k]+Math.min(...object.parts.map(p=>p.offset[k]));max[k]=parts.length?Math.max(...parts.map(p=>p.max[k])):object.position[k]+Math.max(...object.parts.map(p=>p.offset[k]+p.size[k]));}
      if(object.appearance){const visual=objectContentBounds(object);for(const k of ['x','y','z']){min[k]=Math.min(min[k],visual.min[k]);max[k]=Math.max(max[k],visual.max[k]);}}
      const center=Object.fromEntries(['x','y','z'].map(k=>[k,(min[k]+max[k])/2])),distance=Math.max(2.4,...['x','y','z'].map(k=>(max[k]-min[k])*1.5));
      for(const angle of [0,Math.PI/2,Math.PI,-Math.PI/2,Math.PI/4]){
        const x=center.x+Math.sin(angle)*distance,z=center.z+Math.cos(angle)*distance,y=Math.max(6,Math.min(36,center.y-.9));
        if(this.collision(x,y,z))continue;this.p={x,y,z,yaw:angle,pitch:Math.max(-1.4,Math.min(1.4,Math.atan2(center.y-y-1.56,distance)))};this.vy=0;this.impulse=null;this.fallPeak=y;this.update(0,performance.now());this.render(performance.now()/1000);enter.hidden=false;return;
      }
      throw Error('对象周围暂时没有合适的观察位置，可直接在副本中走动查看');
    }
    applyBehavior({changed,effects},view){
      this.primitives=view.primitives;this.objects=new Map(view.objects.map(o=>[o.id,o]));
      for(const id of changed)this.rebuildObject(id);
      for(const effect of effects){
        if(effect.type==='hud.message')inform(effect.text);
        if(effect.type==='player.impulse'){this.vy=effect.velocity.y;this.impulse={x:effect.velocity.x,z:effect.velocity.z};this.grounded=false;}
      }
    }
    async interact(){
      if(isFrozen()||this.play?.dead)return;
      const hit=this.pick([this.p.x,this.p.y+1.56,this.p.z],basis(this.p).f,4);
      if(hit?.treeId){await this.behaviors.dispatch('interact',hit.treeId);this.updateHud();}
      else inform('靠近物体并对准它，再按 E 互动');
    }
    collision(x,y,z){
      if(Math.abs(x)>47.4||Math.abs(z)>47.4||y>38)return true;
      if(super.collision(x,y,z))return true;
      const body={min:{x:x-.29,y:y+.001,z:z-.29},max:{x:x+.29,y:y+1.719,z:z+.29}};
      return (this.primitives||[]).some(p=>p.visible!==false&&p.solid&&this.play.alive(p.id)&&intersects(body,p));
    }
    moveAxis(axis,amount){
      if(!amount)return;const steps=Math.ceil(Math.abs(amount)/.12),step=amount/steps;
      for(let i=0;i<steps;i++){
        const q={...this.p,[axis]:this.p[axis]+step};
        if(!this.collision(q.x,q.y,q.z)){this.p[axis]+=step;continue;}
        if(axis!=='y'&&this.grounded&&!this.collision(q.x,q.y+.5,q.z)){this.p[axis]+=step;this.p.y+=.5;continue;}
        let lo=0,hi=1;for(let j=0;j<12;j++){const mid=(lo+hi)/2,at={...this.p,[axis]:this.p[axis]+step*mid};if(this.collision(at.x,at.y,at.z))hi=mid;else lo=mid;}
        this.p[axis]+=step*lo;
        if(axis==='y'){if(step<0)this.grounded=true;this.vy=0;if(Math.abs(this.p.y-6)<.002)this.p.y=6;}break;
      }
    }
    pick(origin,dir,reach,attack=false){
      let hit=super.raycast(origin,dir,reach);
      for(const p of this.primitives||[]){
        if(p.visible===false||!this.play.alive(p.id)||(attack&&!p.solid&&!this.play.state.targets[p.id]))continue;
        const found=rayBox(origin,dir,p,reach);
        if(found&&(!hit||found.distance<hit.distance))hit={...found,x:p.min.x,y:p.min.y,z:p.min.z,treeId:p.id,id:p.id,primitive:true,name:this.objects.get(p.id)?.name};
      }
      return hit;
    }
    raycast(origin,dir,reach=7){return this.pick(origin,dir,reach);}
    attack(){
      if(isFrozen()||!this.input)return;const definition=this.play?.get(this.play.state.equipped);if(!definition)return;
      const hit=this.pick([this.p.x,this.p.y+1.56,this.p.z],basis(this.p).f,definition.config.range,true);
      const result=this.play.attack(hit?{id:hit.treeId,distance:hit.distance}:null);
      if(!result.fired){if(result.reason)inform(result.reason);return;}
      const weapon=document.getElementById('held-item');weapon.classList.remove('swing','fire');void weapon.offsetWidth;weapon.classList.add(result.type==='melee'?'swing':'fire');
      document.getElementById('hit-marker').classList.toggle('hit',result.damage>0);clearTimeout(this.hitTimer);this.hitTimer=setTimeout(()=>document.getElementById('hit-marker').classList.remove('hit'),180);
      if(result.damage)inform(`${this.objects.get(result.id)?.name} −${result.damage}${result.destroyed?' · 已击破':''}`);
      if(result.destroyed){const key='object:'+result.id,mesh=this.meshes.get(key);if(mesh?.buffer)this.gl.deleteBuffer(mesh.buffer);this.meshes.delete(key);}
      if(hit?.treeId)this.behaviors?.dispatch('attack',hit.treeId);
      this.updateHud();
    }
    update(dt,time){
      if(this.play?.dead)this.pauseInput();
      const playing=this.input;
      const wasGrounded=this.grounded;
      this.fallPeak=Math.max(this.fallPeak??this.p.y,this.p.y);
      super.update(dt,time);
      if(this.play&&playing){
        if(this.impulse){for(const axis of ['x','z']){this.moveAxis(axis,this.impulse[axis]*dt);this.impulse[axis]*=Math.exp(-dt*5);}}
        this.play.tick(dt);
        this.behaviors?.tick(dt);
        if(this.grounded&&!wasGrounded)this.behaviors?.dispatch('land',this.contactTarget());
        if(this.grounded){this.play.fall(this.fallPeak-this.p.y);this.fallPeak=this.p.y;}
        const body={min:{x:this.p.x-.4,y:this.p.y,z:this.p.z-.4},max:{x:this.p.x+.4,y:this.p.y+1.72,z:this.p.z+.4}},hurt=new Set();
        for(const p of this.primitives)if(p.visible!==false&&this.play.alive(p.id)&&!hurt.has(p.id)&&intersects(body,p)){hurt.add(p.id);this.play.hurt((this.objects.get(p.id).components.contactDamage||0)*dt);}
        this.contactElapsed=(this.contactElapsed||0)+dt;
        if(this.contactElapsed>=.1){this.contactElapsed=0;for(const id of this.contactTargets())this.behaviors?.dispatch('contact',id);}
      }
      this.updateHud();
    }
    contactTargets(){const body={min:{x:this.p.x-.32,y:this.p.y-.04,z:this.p.z-.32},max:{x:this.p.x+.32,y:this.p.y+1.72,z:this.p.z+.32}};return [...new Set(this.primitives.filter(p=>p.visible!==false&&this.play.alive(p.id)&&intersects(body,p)).map(p=>p.id))];}
    contactTarget(){return this.contactTargets()[0]||null;}
    updateHud(){
      if(!this.play)return;const health=this.play.player,weapon=this.play.get(this.play.state.equipped),ranged=this.play.get('ranged'),ammo=ranged?this.play.state.systems[ranged.id]:null;
      document.getElementById('health-hud').hidden=!health;
      if(health){document.getElementById('health-value').textContent=`${Math.ceil(health.health)} / ${health.maxHealth}`;document.getElementById('health-meter').max=health.maxHealth;document.getElementById('health-meter').value=health.health;}
      document.getElementById('weapon-hud').hidden=!weapon;document.getElementById('held-item').hidden=!weapon;
      if(weapon){document.getElementById('weapon-name').textContent=weapon.name;document.getElementById('ammo').textContent=weapon.type==='ranged'?(ammo.reloadRemaining?`换弹 ${ammo.reloadRemaining.toFixed(1)}s`:`${ammo.ammo} / ${ranged.config.magazine}`):'近战';document.getElementById('held-item').dataset.weapon=weapon.type;document.getElementById('weapon-controls').textContent=[ranged?'1 射击 · R 换弹':null,this.play.get('melee')?'2 / F 近战':null,'左键攻击'].filter(Boolean).join(' · ');}
      document.getElementById('death').hidden=!this.play.dead;if(this.play.dead){enter.hidden=true;this.pauseInput();}
      const target=this.target?.treeId,life=this.play.state.targets[target];
      document.getElementById('target').textContent=target?`${this.objects.get(target)?.name||''}${life?' · '+Math.ceil(life.health)+' / '+life.maxHealth:''}`:'';
      const interactive=this.target?.distance<=4&&this.behaviors?.data.definitions.some(b=>b.definition.targets.includes(target));
      document.getElementById('interact').hidden=!interactive;document.getElementById('interact').textContent='E · 互动';
      const items=Object.entries(this.behaviors?.data.value.inventory||{});document.getElementById('inventory-hud').hidden=!items.length;document.getElementById('inventory-hud').textContent=items.map(([id,count])=>`${id} × ${count}`).join(' · ');
    }
    render(time){this.assetDraws=[];const target=this.target;if(target?.primitive)this.target=null;super.render(time);this.target=target;}
    revive(){this.play?.revive();this.respawn(false);this.updateHud();inform('已复活，世界中的变化仍保留');enter.hidden=false;}
    respawn(notify=true){this.p={x:.5,y:6,z:12.5,yaw:0,pitch:0};for(let y=6;y<38;y+=.5)if(!this.collision(this.p.x,y,this.p.z)){this.p.y=y;break;}this.vy=0;this.fallPeak=this.p.y;if(notify)inform('已回到出生位置');}
    dispose(){this.behaviors?.dispose();this.worldAssets?.dispose();for(const [key,mesh]of this.meshes)if(mesh.asset)this.meshes.delete(key);super.dispose();}
  }
  return BlankRuntime;
}
