// Declared instance configuration only. The host creates a checked source draft.
const text=(tag,value)=>{const node=document.createElement(tag);node.textContent=value??'';return node;};
const errors={
  TARGET_FEEDBACK_UNAPPLIED_DRAFT:'当前还有未采用的源码草稿，请先在“检查记录”中处理。',
  TARGET_FEEDBACK_FORMAL_SOURCE_REQUIRED:'此世界的正式源码暂不支持参数调整。',
  TARGET_FEEDBACK_STALE_BINDING:'对象或源码版本已改变，请重新读取参数。',
  TARGET_FEEDBACK_SOURCE_CHANGED:'读取期间源码发生改变，请重新读取参数。',
  TARGET_FEEDBACK_WORLD_BUSY:'请先结束候选试玩，并等待当前世界操作完成。',
  TARGET_FEEDBACK_INVALID_VALUE:'请填写 1–1000 之间的整数毫秒。',
  ACTIVE_TASK_EXISTS:'创作任务正在运行，请等待完成后再调整。',
  TARGET_FEEDBACK_OPERATION_NOT_FOUND:'尚未找到这次调整，请在待确认操作中查询并继续原操作。',
};
export function createTargetFeedbackUI({element,request,getWorldId,durableCall,action=fn=>fn()}){
 let epoch=0,readSequence=0,world=null,visible=false,timer=null,attempt=null,pending=null,notice,fields,select,input,submit,retry,defaultsButton,defaultsSource,reading=false;
 const formButton=(label,fn)=>{const form=document.createElement('form'),button=text('button',label);form.className='workbench-form';button.type='submit';form.append(button);form.onsubmit=e=>{e.preventDefault();void action(fn);};return{form,button};};
 const stop=()=>{if(timer!==null)clearTimeout(timer);timer=null;};
 const current=(generation,id)=>visible&&generation===epoch&&world===id&&getWorldId()===id;
 async function call(channel,payload){const generation=epoch,id=world;const result=await request(channel,{worldId:id,...payload});if(!current(generation,id))throw Error('WORLD_CHANGED');return result;}
 function controls(){if(!select)return;const locked=reading||!!attempt||!!pending;select.disabled=locked;input.disabled=locked;submit.disabled=locked||!fields?.length;if(defaultsButton)defaultsButton.disabled=locked||!selectedDefault();}
 function describeResult(result){
  if(result.status==='unchanged')return '参数与已保存的设置一致，没有创建新草稿或运行检查。';
  if(result.status==='rejected')return errors[result.reason]||'这次调整未写入源码，请重新读取参数。';
  if(result.status==='passed')return '调整草稿已检查通过。请到“检查记录”预览并采用；正式世界尚未改变。';
  if(['failed','cancelled','interrupted'].includes(result.status))return '这次调整的检查未完成或未通过，源码草稿已保留，请查看“检查记录”。';
  if(result.status==='source-saved-check-blocked'||result.job?.status==='blocked')return '调整草稿已保存，检查暂不可用。可查询原检查，无需再次修改参数。';
  return '调整草稿已保存，正在检查。通过后还需预览并采用。';
 }
 function accept(result){
  if(result.worldId!==world||!visible)return;
  notice.textContent=describeResult(result);attempt=null;
  pending=result.operationId&&result.job&&!['passed','failed','cancelled','interrupted','unchanged','rejected'].includes(result.status)?{operationId:result.operationId}:null;
  controls();stop();retry.form.hidden=!pending;
  if(pending&&result.job.status!=='blocked')timer=setTimeout(()=>void poll(),1000);
 }
 async function poll(){
  stop();if(!visible||!pending)return;const generation=epoch,id=world,operation=pending;
  try{const result=await call('targetFeedback.status',{operationId:operation.operationId});if(current(generation,id)&&operation===pending)accept(result);}
  catch{if(current(generation,id)){notice.textContent='暂时无法查询检查结果，请重试查询；不会重新修改源码。';retry.form.hidden=false;}}
 }
 function selectedDefault(){
  const value=fields?.find(x=>x.targetId===select?.value)?.defaults;
  return value?.format==='craftmine.target-feedback-default/1'&&Number.isSafeInteger(value.values?.hitFlashMilliseconds)&&value.values.hitFlashMilliseconds>=1&&value.values.hitFlashMilliseconds<=1000&&['packed-scene','balance-profile','balance-profile-script','target-script'].includes(value.source?.kind)?value:null;
 }
 function choose(){const target=fields.find(x=>x.targetId===select.value);input.value=target?String(target.values.hitFlashMilliseconds):'';
  const value=selectedDefault(),labels={'packed-scene':'靶场景显式值','balance-profile':'当前平衡配置','balance-profile-script':'平衡配置脚本默认','target-script':'训练靶脚本默认'};
  defaultsSource.textContent=value?`底座默认：${value.values.hitFlashMilliseconds} 毫秒 · ${labels[value.source.kind]}（${value.source.path}）`:'尚无已验证的底座默认值。';controls();
 }
 async function load(){
  if(attempt||pending)return;
  const generation=epoch,id=world,sequence=++readSequence;reading=true;controls();
  try{const result=await call('targetFeedback.describe',{});if(sequence!==readSequence)return;fields=result.targets;select.replaceChildren();
   for(const target of fields){const option=text('option',`${target.label} · ${target.targetId}`);option.value=target.targetId;select.append(option);}
   if(fields.length)select.value=fields[0].targetId;choose();notice.textContent=fields.length?'只修改所选训练靶的受击闪光时长。':result.unsupportedCount?'当前训练靶版本暂不支持参数面板，可继续通过创作对话修改。':'此世界没有可调整的训练靶。';
  }catch(error){if(current(generation,id)&&sequence===readSequence){fields=[];notice.textContent=errors[error?.code]||errors[error?.message]||'暂时无法读取可调整参数。请先打开正式的第一人称训练场。';}}
  finally{if(current(generation,id)&&sequence===readSequence){reading=false;controls();}}
 }
 async function show(){
  stop();epoch++;visible=true;const next=getWorldId();if(world!==next){attempt=null;pending=null;}world=next;fields=[];reading=false;
  element.replaceChildren(text('h2','调整训练靶'),text('p','生成草稿后检查，通过后再预览并采用。关闭试玩会保留草稿；不改变已有伤害与游玩进度。'));
  notice=text('p','正在读取参数…');notice.setAttribute('role','status');
  const targetLabel=text('label','训练靶'),valueLabel=text('label','受击闪光时长（毫秒）');select=document.createElement('select');input=document.createElement('input');input.type='number';input.min='1';input.max='1000';input.step='1';input.required=true;input.dataset.targetFeedbackValue='true';select.onchange=choose;targetLabel.append(select);valueLabel.append(input);
  const defaultGeneration=epoch,defaultWorld=world;
  defaultsSource=text('p','');defaultsSource.dataset.targetFeedbackDefaultSource='true';
  const useDefault=formButton('使用底座默认值',async()=>{
   if(!current(defaultGeneration,defaultWorld)||reading||attempt||pending)return;const value=selectedDefault();if(!value)return;
   input.value=String(value.values.hitFlashMilliseconds);notice.textContent='默认值已填入，尚未提交。值有变化时会为此实例写入明确数值；不会恢复动态继承。';
  });defaultsButton=useDefault.button;defaultsButton.dataset.targetFeedbackDefault='true';
  const create=formButton('生成调整草稿并检查',async()=>{
   const generation=epoch,id=world;
   try{
    if(pending||reading)return;
    if(!attempt){const target=fields.find(x=>x.targetId===select.value),value=Number(input.value);if(!target||!Number.isSafeInteger(value)||value<1||value>1000)throw Error('TARGET_FEEDBACK_INVALID_VALUE');attempt={targetId:target.targetId,sourceBinding:target.sourceBinding,values:{hitFlashMilliseconds:value}};}
    controls();notice.textContent='正在提交这次调整…';const result=await durableCall('targetFeedback.submit',attempt);
    if(current(generation,id))accept(result);
   }catch(error){if(current(generation,id)){notice.textContent=errors[error?.code]||errors[error?.message]||'结果尚未确认，请使用上方“待确认操作”继续原调整。';controls();}}
  });submit=create.button;create.form.prepend(targetLabel,valueLabel);
  retry=formButton('查询原检查',poll);retry.form.hidden=!pending;
  const refresh=formButton('重新读取参数',load);
  element.append(notice,create.form,defaultsSource,useDefault.form,retry.form,refresh.form);controls();if(pending)void poll();else if(attempt)notice.textContent='有一次调整的结果尚未确认，请使用上方“待确认操作”继续。';else await load();
 }
 function clear(){epoch++;readSequence++;visible=false;stop();element.replaceChildren();}
 return{show,clear,accept};
}
