'use strict';
import { makeWorldRuntime } from './world-runtime.mjs';
(() => {
  const nonce = location.hash.slice(1), parentOrigin = new URL(location.href).origin;
  const send = (type,payload={}) => parent.postMessage({channel:'craftmine-game/1',nonce,type,...payload},parentOrigin);
  let engine, build, frozen=false, lastTarget=null;
  const enter = document.getElementById('enter'), notice = document.getElementById('notice'); let noticeTimer;
  function inform(text) { notice.textContent=text;notice.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.hidden=true,4500); }
  const BlankRuntime=makeWorldRuntime({send,inform,enter,isFrozen:()=>frozen});
  const snapshot=()=>build?.scene.format==='craftmine.scene/3'||engine.behaviors?.data.value.archive.length||Object.keys(engine.behaviors?.data.value.inventory||{}).length?{format:'craftmine.progress/3',player:{...engine.p},gameplay:engine.play.snapshot(),behaviors:engine.behaviors.snapshot()}:engine.play?.definitions.length||Object.keys(engine.play?.state.targets||{}).length||Object.keys(engine.play?.state.archivedTargets||{}).length?{format:'craftmine.progress/2',player:{...engine.p},gameplay:engine.play.snapshot()}:{format:'craftmine.progress/1',player:{...engine.p}};
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
        await engine.generateBuild(m.build,m.snapshot);engine.pauseInput();
        // A hidden candidate iframe may not receive animation frames until activated.
        // Draw explicitly so readiness checks never depend on visibility scheduling.
        engine.render(performance.now()/1000);
        if(!engine.software&&engine.gl.getError()!==engine.gl.NO_ERROR)throw Error('WebGL 绘制检查失败');
        send('loaded',{snapshot:snapshot(),version:build.id,renderer:engine.software?'兼容 3D':'WebGL'});
      }
      if(!engine)return;
      if(m.type==='snapshot'){if(m.freeze){frozen=true;engine.pauseInput();engine.setActive(false);}await engine.behaviors?.flush();send('snapshot',{requestId:m.requestId,snapshot:snapshot()});}
      if(m.type==='resume'){frozen=false;engine.setActive(true);enter.hidden=false;}
      if(m.type==='pause'){engine.pauseInput();enter.hidden=false;}
      if(m.type==='respawn')engine.respawn();
    }catch(error){send('error',{message:error.message});}
  });
  enter.onclick=()=>{if(!engine||frozen||engine.play?.dead)return;enter.hidden=true;engine.enter();};
  document.getElementById('revive').onclick=()=>{if(engine&&!frozen)engine.revive();};
  document.getElementById('interact').onclick=()=>engine?.interact();
  addEventListener('pagehide',()=>engine?.dispose());
  send('ready');
})();
