import { decodeAsset,fromBase64 } from './asset-decode.mjs';
import { AssetPreview } from './asset-renderer.mjs';
const nonce=location.hash.slice(1),origin=new URL(location.href).origin,status=document.getElementById('asset-view-status');let preview,loaded=false;
const send=(type,payload={})=>parent.postMessage({channel:'craftmine-asset/1',nonce,type,...payload},origin);
addEventListener('message',async event=>{
  const m=event.data;if(event.source!==parent||event.origin!==origin||m?.channel!=='craftmine-asset-host/1'||m.nonce!==nonce)return;
  if(m.type==='dispose'){preview?.dispose();return;}if(m.type!=='load'||loaded)return;loaded=true;
  try{const decoded=decodeAsset(fromBase64(m.asset.data),m.asset.mime);preview=new AssetPreview(document.getElementById('asset-canvas'));const metrics=await preview.load(decoded),pixels=preview.pixels();if(pixels.error)throw Error('图形设备报告素材绘制失败');status.textContent=decoded.kind==='model'?`${metrics.triangles.toLocaleString()} 个三角面 · ${metrics.images} 张内嵌贴图`:`图片 · ${decoded.width} × ${decoded.height}`;send('loaded',{metrics,pixels,warnings:decoded.warnings});}
  catch(error){preview?.dispose();status.textContent=error.message;status.dataset.error='true';send('error',{message:error.message});}
});
for(const [id,action]of [['asset-left',()=>preview?.rotate(-.35)],['asset-right',()=>preview?.rotate(.35)],['asset-near',()=>preview?.scale(1.2)],['asset-far',()=>preview?.scale(1/1.2)],['asset-reset',()=>{if(preview){preview.angle=preview.renderer.model?.kind==='image'?0:.55;preview.zoom=1;preview.render();}}]])document.getElementById(id).onclick=action;
addEventListener('pagehide',()=>preview?.dispose());send('ready');
