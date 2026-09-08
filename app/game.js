'use strict';
import { makeWorldRuntime } from './world-runtime.mjs';
(() => {
  const nonce = location.hash.slice(1), parentOrigin = new URL(location.href).origin;
  const send = (type,payload={}) => {if(preview&&type==='agent'){inform('关闭预览后，可以继续描述对原世界的修改。');return;}parent.postMessage({channel:'craftmine-game/1',nonce,type,...payload},parentOrigin);};
  let engine, build, frozen=false, lastTarget=null, preview=false;
  const enter = document.getElementById('enter'), notice = document.getElementById('notice'); let noticeTimer;
  function inform(text,{tone='info',duration=4500}={}) { notice.textContent=text;notice.dataset.tone=tone;notice.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.hidden=true,Math.max(1000,Math.min(10000,Number.isFinite(duration)?duration:4500))); }
  const BlankRuntime=makeWorldRuntime({send,inform,enter,isFrozen:()=>frozen});
  const snapshot=()=>['craftmine.scene/3','craftmine.scene/4'].includes(build?.scene.format)||engine.behaviors?.data.value.format==='craftmine.behavior-state/3'||engine.behaviors?.data.value.archive.length||Object.keys(engine.behaviors?.data.value.inventory||{}).length?{format:'craftmine.progress/3',player:{...engine.p},gameplay:engine.play.snapshot(),behaviors:engine.behaviors.snapshot()}:engine.play?.definitions.length||Object.keys(engine.play?.state.targets||{}).length||Object.keys(engine.play?.state.archivedTargets||{}).length?{format:'craftmine.progress/2',player:{...engine.p},gameplay:engine.play.snapshot()}:{format:'craftmine.progress/1',player:{...engine.p}};
  window.addEventListener('message',async event=>{
    const m=event.data;if(event.source!==parent||event.origin!==parentOrigin||m?.nonce!==nonce||m.channel!=='craftmine-host/1')return;
    try {
      if(m.type==='load'){
        if(engine)return;
        build=m.build;
        preview=m.preview===true;if(preview){document.body.dataset.preview='true';enter.firstChild.textContent='试玩这个副本 ';enter.querySelector('small').textContent='WASD 移动 · 鼠标环顾 · Esc 暂停';}
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
      if(m.type==='inspect'){
        if(!preview)throw Error('定位查看仅适用于独立预览');
        engine.pauseInput();await engine.behaviors?.flush();engine.inspectObject(m.objectId);send('inspected',{requestId:m.requestId,snapshot:snapshot()});
      }
      if(m.type==='resume'){frozen=false;engine.setActive(true);enter.hidden=false;}
      if(m.type==='pause'){engine.pauseInput();enter.hidden=false;}
      if(m.type==='respawn')engine.respawn();
    }catch(error){send('error',{message:error.message,requestId:m.requestId});}
  });
  enter.onclick=()=>{if(!engine||frozen||engine.play?.dead)return;enter.hidden=true;engine.enter();};
  document.getElementById('revive').onclick=()=>{if(engine&&!frozen)engine.revive();};
  document.getElementById('interact').onclick=()=>engine?.interact();
  addEventListener('pagehide',()=>engine?.dispose());
  send('ready');
})();
