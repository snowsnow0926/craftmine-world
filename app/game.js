'use strict';
import { GameplaySession } from './gameplay.mjs';
import { primitiveVertices,intersects,rayBox } from './geometry.mjs';
(() => {
  const nonce = location.hash.slice(1), parentOrigin = new URL(location.href).origin;
  const send = (type,payload={}) => parent.postMessage({channel:'craftmine-game/1',nonce,type,...payload},parentOrigin);
  const {VoxelRuntime,B,index,basis} = WorldRuntime;
  let engine, build, frozen=false, lastTarget=null;
  const enter = document.getElementById('enter'), notice = document.getElementById('notice'); let noticeTimer;
  function inform(text) { notice.textContent=text;notice.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.hidden=true,4500); }
  class BlankRuntime extends VoxelRuntime {
    bindInput() {
      this.listen(document,'pointerlockchange',()=>{this.locked=document.pointerLockElement===this.canvas;this.input=this.locked;this.keys.clear();enter.hidden=this.locked;});
      this.listen(document,'pointerlockerror',()=>{if(!frozen){this.input=true;inform('按住画面拖动环顾，WASD 移动');}});
      this.listen(document,'mousemove',e=>{if(!frozen&&this.active&&this.input&&(this.locked||this.dragging)){this.p.yaw-=e.movementX*.0022;this.p.pitch=Math.max(-1.52,Math.min(1.52,this.p.pitch-e.movementY*.0022));}});
      this.listen(this.canvas,'pointerdown',e=>{if(frozen||this.play?.dead)return;this.input=true;this.canvas.focus();if(!this.locked){this.dragging=true;this.canvas.setPointerCapture(e.pointerId);}else if(e.button===0)this.attack();enter.hidden=true;});
      for(const type of ['pointerup','pointercancel','lostpointercapture'])this.listen(this.canvas,type,()=>this.dragging=false);
      this.listen(this.canvas,'contextmenu',e=>e.preventDefault());
      this.listen(document,'keydown',e=>{
        if(frozen)return;
        if(e.code==='KeyT'&&!e.repeat){e.preventDefault();this.pauseInput();enter.hidden=false;send('agent',{selected:lastTarget});return;}
        if(e.code==='Escape'){this.pauseInput();enter.hidden=false;return;}
        if(e.code==='Enter'&&this.play?.dead){this.revive();return;}
        if(this.input&&!e.repeat){
          if(e.code==='Digit1')this.play?.equip('ranged');
          if(e.code==='Digit2')this.play?.equip('melee');
          if(e.code==='KeyR'&&this.play?.reload())inform('正在换弹');
          if(e.code==='KeyF'&&this.play?.equip('melee'))this.attack();
        }
        if(this.input&&['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight'].includes(e.code)){e.preventDefault();this.keys.add(e.code);}
      });
      this.listen(document,'keyup',e=>this.keys.delete(e.code));
      this.listen(window,'blur',()=>{this.pauseInput();enter.hidden=false;});
      this.listen(document,'visibilitychange',()=>{if(document.hidden)this.pauseInput();});
      this.listen(this.canvas,'webglcontextlost',e=>{e.preventDefault();this.setActive(false);send('error',{message:'图形上下文丢失，请刷新以恢复已保存的世界。'});});
    }
    generateBuild(value,snapshot) {
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
      for(let z=-48;z<48;z+=16)for(let x=-48;x<48;x+=16)this.rebuild(x,z);
      for(const o of value.scene.objects)if(this.play.alive(o.id)){
        const parts=this.primitives.filter(p=>p.id===o.id);if(parts.length)this.meshes.set('object:'+o.id,this.upload(primitiveVertices(parts)));
      }
      this.makeWater();this.makeClouds();this.night=value.scene.night?1:0;this.safePosition();this.changed();
    }
    collision(x,y,z){
      if(super.collision(x,y,z))return true;
      const body={min:{x:x-.29,y:y+.001,z:z-.29},max:{x:x+.29,y:y+1.719,z:z+.29}};
      return (this.primitives||[]).some(p=>p.solid&&this.play.alive(p.id)&&intersects(body,p));
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
        if(!this.play.alive(p.id)||(attack&&!p.solid&&!this.play.state.targets[p.id]))continue;
        const found=rayBox(origin,dir,p,reach);
        if(found&&(!hit||found.distance<hit.distance))hit={...found,x:p.min.x,y:p.min.y,z:p.min.z,treeId:p.id,id:p.id,primitive:true,name:this.objects.get(p.id)?.name};
      }
      return hit;
    }
    raycast(origin,dir,reach=7){return this.pick(origin,dir,reach);}
    attack(){
      if(frozen||!this.input)return;const definition=this.play?.get(this.play.state.equipped);if(!definition)return;
      const hit=this.pick([this.p.x,this.p.y+1.56,this.p.z],basis(this.p).f,definition.config.range,true);
      const result=this.play.attack(hit?{id:hit.treeId,distance:hit.distance}:null);
      if(!result.fired){if(result.reason)inform(result.reason);return;}
      const weapon=document.getElementById('held-item');weapon.classList.remove('swing','fire');void weapon.offsetWidth;weapon.classList.add(result.type==='melee'?'swing':'fire');
      document.getElementById('hit-marker').classList.toggle('hit',result.damage>0);clearTimeout(this.hitTimer);this.hitTimer=setTimeout(()=>document.getElementById('hit-marker').classList.remove('hit'),180);
      if(result.damage)inform(`${this.objects.get(result.id)?.name} −${result.damage}${result.destroyed?' · 已击破':''}`);
      if(result.destroyed){const key='object:'+result.id,mesh=this.meshes.get(key);if(mesh)this.gl.deleteBuffer(mesh.buffer);this.meshes.delete(key);}
      this.updateHud();
    }
    update(dt,time){
      if(this.play?.dead)this.pauseInput();
      const playing=this.input;
      this.fallPeak=Math.max(this.fallPeak??this.p.y,this.p.y);
      super.update(dt,time);
      if(this.play&&playing){
        this.play.tick(dt);
        if(this.grounded){this.play.fall(this.fallPeak-this.p.y);this.fallPeak=this.p.y;}
        const body={min:{x:this.p.x-.4,y:this.p.y,z:this.p.z-.4},max:{x:this.p.x+.4,y:this.p.y+1.72,z:this.p.z+.4}},hurt=new Set();
        for(const p of this.primitives)if(this.play.alive(p.id)&&!hurt.has(p.id)&&intersects(body,p)){hurt.add(p.id);this.play.hurt((this.objects.get(p.id).components.contactDamage||0)*dt);}
      }
      this.updateHud();
    }
    updateHud(){
      if(!this.play)return;const health=this.play.player,weapon=this.play.get(this.play.state.equipped),ranged=this.play.get('ranged'),ammo=ranged?this.play.state.systems[ranged.id]:null;
      document.getElementById('health-hud').hidden=!health;
      if(health){document.getElementById('health-value').textContent=`${Math.ceil(health.health)} / ${health.maxHealth}`;document.getElementById('health-meter').max=health.maxHealth;document.getElementById('health-meter').value=health.health;}
      document.getElementById('weapon-hud').hidden=!weapon;document.getElementById('held-item').hidden=!weapon;
      if(weapon){document.getElementById('weapon-name').textContent=weapon.name;document.getElementById('ammo').textContent=weapon.type==='ranged'?(ammo.reloadRemaining?`换弹 ${ammo.reloadRemaining.toFixed(1)}s`:`${ammo.ammo} / ${ranged.config.magazine}`):'近战';document.getElementById('held-item').dataset.weapon=weapon.type;document.getElementById('weapon-controls').textContent=[ranged?'1 射击 · R 换弹':null,this.play.get('melee')?'2 / F 近战':null,'左键攻击'].filter(Boolean).join(' · ');}
      document.getElementById('death').hidden=!this.play.dead;if(this.play.dead){enter.hidden=true;this.pauseInput();}
      const target=this.target?.treeId,life=this.play.state.targets[target];
      document.getElementById('target').textContent=target?`${this.objects.get(target)?.name||''}${life?' · '+Math.ceil(life.health)+' / '+life.maxHealth:''}`:'';
    }
    render(time){const target=this.target;if(target?.primitive)this.target=null;super.render(time);this.target=target;}
    revive(){this.play?.revive();this.respawn(false);this.updateHud();inform('已复活，世界中的变化仍保留');enter.hidden=false;}
    respawn(notify=true){this.p={x:.5,y:6,z:12.5,yaw:0,pitch:0};for(let y=6;y<38;y+=.5)if(!this.collision(this.p.x,y,this.p.z)){this.p.y=y;break;}this.vy=0;this.fallPeak=this.p.y;if(notify)inform('已回到出生位置');}
  }
  const snapshot=()=>engine.play?.definitions.length||Object.keys(engine.play?.state.targets||{}).length?{format:'craftmine.progress/2',player:{...engine.p},gameplay:engine.play.snapshot()}:{format:'craftmine.progress/1',player:{...engine.p}};
  window.addEventListener('message',async event=>{
    const m=event.data;if(event.source!==parent||event.origin!==parentOrigin||m?.nonce!==nonce||m.channel!=='craftmine-host/1')return;
    try {
      if(m.type==='load'){
        if(engine)return;
        build=m.build;
        engine=new BlankRuntime(document.getElementById('world'),{
          onTarget:t=>{lastTarget=t?.treeId||null;document.getElementById('target').textContent=lastTarget?engine.objects.get(lastTarget)?.name||'':'';},
          onStats:s=>{if(!frozen)send('state',{snapshot:snapshot(),selected:lastTarget,fps:s.fps,renderer:engine.software?'兼容 3D':'WebGL'});},
          onNotice:inform,onControl:()=>{},onError:message=>send('error',{message}),
        });
        engine.generateBuild(m.build,m.snapshot);engine.pauseInput();
        // A hidden candidate iframe may not receive animation frames until activated.
        // Draw explicitly so readiness checks never depend on visibility scheduling.
        engine.render(performance.now()/1000);
        if(!engine.software&&engine.gl.getError()!==engine.gl.NO_ERROR)throw Error('WebGL 绘制检查失败');
        send('loaded',{snapshot:snapshot(),version:build.id,renderer:engine.software?'兼容 3D':'WebGL'});
      }
      if(!engine)return;
      if(m.type==='snapshot'){if(m.freeze){frozen=true;engine.pauseInput();engine.setActive(false);}send('snapshot',{requestId:m.requestId,snapshot:snapshot()});}
      if(m.type==='resume'){frozen=false;engine.setActive(true);enter.hidden=false;}
      if(m.type==='pause'){engine.pauseInput();enter.hidden=false;}
      if(m.type==='respawn')engine.respawn();
    }catch(error){send('error',{message:error.message});}
  });
  enter.onclick=()=>{if(!engine||frozen||engine.play?.dead)return;enter.hidden=true;engine.enter();};
  document.getElementById('revive').onclick=()=>{if(engine&&!frozen)engine.revive();};
  send('ready');
})();
