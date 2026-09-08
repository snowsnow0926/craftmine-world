'use strict';
(() => {
  const nonce = location.hash.slice(1), parentOrigin = new URL(location.href).origin;
  const send = (type,payload={}) => parent.postMessage({channel:'craftmine-game/1',nonce,type,...payload},parentOrigin);
  const {VoxelRuntime,B,index} = WorldRuntime;
  let engine, build, frozen=false, lastTarget=null;
  const enter = document.getElementById('enter'), notice = document.getElementById('notice'); let noticeTimer;
  function inform(text) { notice.textContent=text;notice.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.hidden=true,4500); }
  class BlankRuntime extends VoxelRuntime {
    bindInput() {
      this.listen(document,'pointerlockchange',()=>{this.locked=document.pointerLockElement===this.canvas;this.input=this.locked;this.keys.clear();enter.hidden=this.locked;});
      this.listen(document,'pointerlockerror',()=>{if(!frozen){this.input=true;inform('按住画面拖动环顾，WASD 移动');}});
      this.listen(document,'mousemove',e=>{if(!frozen&&this.active&&this.input&&(this.locked||this.dragging)){this.p.yaw-=e.movementX*.0022;this.p.pitch=Math.max(-1.52,Math.min(1.52,this.p.pitch-e.movementY*.0022));}});
      this.listen(this.canvas,'pointerdown',e=>{if(frozen)return;this.input=true;this.canvas.focus();if(!this.locked){this.dragging=true;this.canvas.setPointerCapture(e.pointerId);}enter.hidden=true;});
      for(const type of ['pointerup','pointercancel','lostpointercapture'])this.listen(this.canvas,type,()=>this.dragging=false);
      this.listen(this.canvas,'contextmenu',e=>e.preventDefault());
      this.listen(document,'keydown',e=>{
        if(frozen)return;
        if(e.code==='KeyT'&&!e.repeat){e.preventDefault();this.pauseInput();enter.hidden=false;send('agent',{selected:lastTarget});return;}
        if(e.code==='Escape'){this.pauseInput();enter.hidden=false;return;}
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
      for(const [x,y,z,material,id]of value.voxels){this.put(x,y,z,material);this.treeAt.set(index(x,y,z),id);}
      this.p={...snapshot.player};this.fly=false;this.vy=0;this.grounded=false;
      for(let z=-48;z<48;z+=16)for(let x=-48;x<48;x+=16)this.rebuild(x,z);
      this.makeWater();this.makeClouds();this.night=value.scene.night?1:0;this.safePosition();this.changed();
    }
    respawn(notify=true){this.p={x:.5,y:6,z:12.5,yaw:0,pitch:0};for(let y=6;y<38;y++)if(!this.collision(this.p.x,y,this.p.z)){this.p.y=y;break;}this.vy=0;if(notify)inform('已回到出生位置');}
  }
  const snapshot=()=>({format:'craftmine.progress/1',player:{...engine.p}});
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
  enter.onclick=()=>{if(!engine||frozen)return;enter.hidden=true;engine.enter();};
  send('ready');
})();
