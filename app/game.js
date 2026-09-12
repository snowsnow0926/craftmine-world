'use strict';
import { makeWorldRuntime } from './world-runtime.mjs';
import { createExtensionTable, disposeExtensionTable } from './extension-runtime.mjs';
import { observePreview, stepPreview } from './preview-probe.mjs';
import { installNativeGameAcceptance } from './craftmine-acceptance-game.mjs';
(() => {
  const nonce = location.hash.slice(1) || document.querySelector('meta[name="craftmine-nonce"]')?.content || '', parentOrigin = new URL(location.href).origin;
  const replyOrigin = parentOrigin === 'null' ? '*' : parentOrigin;
  const send = (type,payload={}) => {if(preview&&type==='agent'){inform('关闭预览后，可以继续描述对原世界的修改。');return;}parent.postMessage({channel:'craftmine-game/1',nonce,type,...payload},replyOrigin);};
  let engine, build, worldId=null, selectionRevision=0, frozen=false, immersionPaused=false, immersionActive=false, lastTarget=null, preview=false, extensions=null, presentationObserver=null;
  const enter = document.getElementById('enter'), notice = document.getElementById('notice'); let noticeTimer;
  function inform(text,{tone='info',duration=4500}={}) { notice.textContent=text;notice.dataset.tone=tone;notice.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.hidden=true,Math.max(1000,Math.min(10000,Number.isFinite(duration)?duration:4500))); }
  const BlankRuntime=makeWorldRuntime({send,inform,enter,isFrozen:()=>frozen||immersionPaused});
  const syncHostInput=()=>{
    if(!engine)return;
    engine.setActive(!frozen&&!immersionPaused);
    if(immersionActive&&!preview&&!frozen&&!immersionPaused)engine.activateKeyboardInput();
    else {engine.pauseInput();enter.hidden=immersionActive&&!preview;}
  };
  installNativeGameAcceptance({getEngine:()=>engine,freeze:()=>{frozen=true;}});
  const snapshot=()=>['craftmine.scene/3','craftmine.scene/4'].includes(build?.scene.format)||engine.behaviors?.data.value.format==='craftmine.behavior-state/3'||engine.behaviors?.data.value.archive.length||Object.keys(engine.behaviors?.data.value.inventory||{}).length?{format:'craftmine.progress/3',player:{...engine.p},gameplay:engine.play.snapshot(),behaviors:engine.behaviors.snapshot()}:engine.play?.definitions.length||Object.keys(engine.play?.state.targets||{}).length||Object.keys(engine.play?.state.archivedTargets||{}).length?{format:'craftmine.progress/2',player:{...engine.p},gameplay:engine.play.snapshot()}:{format:'craftmine.progress/1',player:{...engine.p}};
  window.addEventListener('message',async event=>{
    const m=event.data;if(event.source!==parent||event.origin!==parentOrigin||m?.nonce!==nonce||m.channel!=='craftmine-host/1')return;
    try {
      if(m.type==='load'){
        if(engine)return;
        build=m.build;
        immersionPaused=m.immersionPaused===true;
        immersionActive=m.immersionActive===true;
        worldId=typeof m.worldId==='string'&&m.worldId.length>0&&m.worldId.length<=128?m.worldId:null;
        preview=m.preview===true;if(preview){document.body.dataset.preview='true';enter.firstChild.textContent='试玩这个副本 ';enter.querySelector('small').textContent='WASD 移动 · 鼠标环顾 · Esc 暂停';}
        engine=new BlankRuntime(document.getElementById('world'),{
          onTarget:t=>{
            const selected=engine?.objects?.has(t?.treeId)?t.treeId:null;
            if(selected!==lastTarget){lastTarget=selected;selectionRevision++;
              if(worldId&&!preview)send('selection',{worldId,build:{id:build.id,hash:build.hash},objectId:selected,selectionRevision});
            }
            document.getElementById('target').textContent=lastTarget?engine.objects.get(lastTarget)?.name||'':'';
          },
          onStats:s=>{if(!frozen)send('state',{snapshot:snapshot(),selected:lastTarget,fps:s.fps,renderer:engine.software?'兼容 3D':'WebGL'});},
          onNotice:inform,onControl:()=>{},onError:message=>send('error',{message}),
        });
        extensions=await createExtensionTable(m.extensions);
        await engine.generateBuild(m.build,m.snapshot,{extensions});engine.pauseInput();
        // Resizing clears the canvas after the first synchronous draw. Hidden
        // offscreen views skip the normal frame loop, so redraw after layout.
        presentationObserver=new ResizeObserver(()=>{if(engine)engine.render(performance.now()/1000);});
        presentationObserver.observe(document.getElementById('world').parentElement);
        // A hidden candidate iframe may not receive animation frames until activated.
        // Draw explicitly so readiness checks never depend on visibility scheduling.
        engine.render(performance.now()/1000);
        if(!engine.software&&engine.gl.getError()!==engine.gl.NO_ERROR)throw Error('WebGL 绘制检查失败');
        if(m.paused){frozen=true;engine.setActive(false);}
        if(immersionPaused){engine.pauseInput();engine.setActive(false);}
        if(immersionActive)syncHostInput();
        send('loaded',{snapshot:snapshot(),version:build.id,renderer:engine.software?'兼容 3D':'WebGL'});
      }
      if(!engine)return;
      if(m.type==='request-observe'||m.type==='request-step'){
        if(!preview)throw Error('需求检查仅适用于独立预览');
        frozen=true;engine.pauseInput();engine.setActive(false);await engine.behaviors.flush();
        const observation=m.type==='request-step'?await stepPreview(engine,m.step):observePreview(engine);
        send('request-result',{requestId:m.requestId,observation});
      }
      if(m.type==='snapshot'){if(m.freeze){frozen=true;engine.pauseInput();engine.setActive(false);}await engine.behaviors?.flush();send('snapshot',{requestId:m.requestId,snapshot:snapshot()});}
      if(m.type==='inspect'){
        if(!preview)throw Error('定位查看仅适用于独立预览');
        engine.pauseInput();await engine.behaviors?.flush();engine.inspectObject(m.objectId);send('inspected',{requestId:m.requestId,snapshot:snapshot()});
      }
      if(m.type==='resume'){frozen=false;syncHostInput();}
      if(m.type==='pause'){engine.pauseInput();enter.hidden=false;}
      if(m.type==='immersion'){immersionPaused=m.paused===true;immersionActive=m.active===true;syncHostInput();}
      if(m.type==='respawn')engine.respawn();
    }catch(error){if(m.type==='load')disposeExtensionTable(extensions);send('error',{message:error.message,requestId:m.requestId});}
  });
  enter.onclick=()=>{if(!engine||frozen||immersionPaused||engine.play?.dead)return;enter.hidden=true;engine.enter();};
  document.getElementById('revive').onclick=()=>{if(engine&&!frozen&&!immersionPaused)engine.revive();};
  document.getElementById('interact').onclick=()=>{if(!frozen&&!immersionPaused)engine?.interact();};
  addEventListener('pagehide',()=>{presentationObserver?.disconnect();engine?.dispose();disposeExtensionTable(extensions);});
  send('ready');
})();
