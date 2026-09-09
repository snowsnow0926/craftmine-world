const node=(tag,text='')=>{const value=document.createElement(tag);value.textContent=text;return value;};
export function createGodotWindowsExportUI({element,request,getWorldId}){
 let operationId=null,busy=false,generation=0,timer=null;const attempts=new Map();
 const notice=node('p'),exporter=node('button','导出 Windows 游戏'),cancel=node('button','取消导出');notice.setAttribute('role','status');cancel.disabled=true;
 const labels={starting:'准备导出',saving:'保存当前进度',reading:'读取正式版本','reading-source':'读取正式版本',exporting:'正在生成 Windows 游戏',publishing:'整理游戏文件',cancelling:'正在取消',cancelled:'已取消导出',failed:'导出失败',interrupted:'上次导出已中断，请重新导出'};
 const call=(channel,worldId)=>request(channel,{worldId,operationId});
 function show(value){notice.textContent=value.status==='completed'?`已导出到所选目录中的 ${value.directoryName??'游戏文件夹'}。双击 game.exe 游玩，F5 保存。源码已随包附带；模块发行许可仍待确认。`:(labels[value.status]??'正在导出')+(value.error?.code?'：'+value.error.code:'');}
 exporter.onclick=async()=>{if(busy)return;const worldId=getWorldId(),epoch=generation;if(!worldId)return;operationId=attempts.get(worldId)??crypto.randomUUID();attempts.set(worldId,operationId);const activeOperation=operationId;const activeCall=channel=>request(channel,{worldId,operationId:activeOperation});busy=true;exporter.disabled=true;cancel.disabled=false;notice.textContent='请选择游戏导出目录。';
  timer=setInterval(()=>{void activeCall('godot.exportWindows.status').then(value=>{if(epoch===generation)show(value);}).catch(()=>{});},1500);
  try{const result=await activeCall('godot.exportWindows');if(['completed','cancelled','failed','interrupted'].includes(result.status)&&attempts.get(worldId)===activeOperation)attempts.delete(worldId);if(epoch===generation){show(result);if(!attempts.has(worldId))operationId=null;}}
  catch(error){if(epoch===generation)notice.textContent='导出结果未确认：'+String(error?.message??error)+'。可以重试查询同一次操作。';}
  finally{if(epoch===generation){clearInterval(timer);timer=null;busy=false;exporter.disabled=false;cancel.disabled=true;}}
 };
 cancel.onclick=async()=>{if(!operationId)return;try{show(await call('godot.exportWindows.cancel',getWorldId()));}catch(error){notice.textContent=String(error?.message??error);}};
 return {show(){element.replaceChildren(node('h3','独立游戏'),exporter,cancel,notice);notice.textContent='导出已应用版本及当前保存进度，不包含未应用草稿。';},clear(){generation++;clearInterval(timer);timer=null;busy=false;operationId=null;exporter.disabled=false;cancel.disabled=true;}};
}
