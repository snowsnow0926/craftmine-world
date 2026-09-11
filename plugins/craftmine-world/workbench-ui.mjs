// Presentation only. All durable facts and authority come from the host bridge.
import {createGodotPackageUI} from './godot-package-ui.mjs';
import {createIssueUI} from './issue-ui.mjs';
import {createTargetFeedbackUI} from './target-feedback-ui.mjs';
import {backupErrorMessage} from './backup-errors.mjs';
const labels={proposed:'待核实',validated:'已验证',needs_revalidation:'需要复验',retired:'已停用',running:'进行中',interrupted:'已中断',cancelled:'已停止',completed:'已完成',finished:'已完成'};
const kinds={object:'物体',gameplay:'基础玩法',creation:'组合作品','project-rule':'创作规则','verified-experience':'验证经验','task-history':'任务历史',workflow:'创作流程'};
const text=(tag,value,className)=>{const element=document.createElement(tag);element.textContent=value??'';if(className)element.className=className;return element;};
const button=(label,run)=>{const form=document.createElement('form'),control=text('button',label);control.type='submit';form.append(control);form.addEventListener('submit',event=>{event.preventDefault();void run();});return {form,control};};
const field=(label,tag='input')=>{const wrapper=document.createElement('label'),control=document.createElement(tag);wrapper.append(text('span',label),control);return {wrapper,control};};
const safeError=error=>backupErrorMessage(error)??String(error?.message||error||'操作未完成').slice(0,600);
const count=value=>Number.isFinite(value)?new Intl.NumberFormat('zh-CN').format(value):'未知';
const dependency=ref=>({'geometry@2':'基础造型','health@1':'生命值','ranged@1':'射击','melee@1':'近战','resource@1':'自定义资源','assets@1':'素材'})[ref]||(ref.startsWith('ext:')?'扩展 '+ref.slice(4):ref);

export function createWorkbench({element,selectionElement,request,getWorld,run=fn=>fn(),pause=()=>{},saveBeforeBackup=async()=>{},reloadWorld=async()=>{},replaceWorld=()=>{},onChange=()=>{},isLocked=()=>false}){
  let epoch=0,currentTab=null,capabilities=new Set(),pending=0,context=null,active=false,selected=null,selectionRevision=0,selectionRequest=0,inspection=null,libraryOffset=0,memoryOffset=0;
  let capabilitiesReady=false,pendingSelection=null,refreshWhenIdle=false;
  async function durableCall(channel,payload,identity=payload){
    void identity;
    if(!has('workbench.prepare'))throw Error('操作恢复服务尚未连接，请更新桌面服务后再写入。');
    const prepared=await call('workbench.prepare',{channel,payload});
    await refreshPending();
    const result=await call('workbench.execute',{operationId:prepared.operationId});
    if(channel==='library.install'&&!result?.receipt)throw Error('安装回执尚未确认，请查询任务后重试。');
    await refreshPending();return result;
  }
  const pages={},notice=text('p','','workbench-notice');notice.setAttribute('role','status');element.append(notice);
  const pendingArea=document.createElement('section');pendingArea.className='workbench-pending';pendingArea.hidden=true;element.append(pendingArea);
  async function refreshPending(){
    if(!has('workbench.operations')){pendingArea.hidden=true;return;}
    const response=await call('workbench.operations');pendingArea.replaceChildren();pendingArea.hidden=!response.items?.length;
    if(pendingArea.hidden)return;
    pendingArea.append(text('h2','待确认操作'),text('p','这些操作保留了原来的编号和参数。继续前会核对原任务与世界。','workbench-meta'));
    for(const item of response.items){
      const row=document.createElement('article');row.className='workbench-card';row.dataset.pendingOperation=item.operationId;
      if(item.channel==='targetFeedback.submit'){
        row.append(text('h3','训练靶反馈调整'),text('p',`${item.payload.targetId} · ${item.payload.values.hitFlashMilliseconds} 毫秒`));
        row.append(text('p','操作编号和参数已保留。检查通过后仍需预览并采用。','workbench-meta'));
        const resume=button(item.state==='completed'?'查询并确认这次检查':'查询并继续原调整',()=>action(async()=>{
          let result=await call('workbench.execute',{operationId:item.operationId});
          if(item.state==='completed'&&result.job)result=await call('targetFeedback.status',{operationId:item.operationId});
          parameters.accept(result);
          const terminal=['passed','failed','cancelled','interrupted','unchanged','rejected'].includes(result.status);
          if(item.state==='completed'&&terminal)await call('workbench.acknowledge',{operationId:item.operationId});
          await refreshPending();
          status(result.status==='passed'?'调整草稿已检查通过，请到“检查记录”预览并采用。':result.status==='rejected'?'这次调整未写入源码，请重新读取参数。':terminal?'这次检查已结束，源码草稿是否保留可查看检查记录。':'调整草稿仍在检查，结果尚未确认。');
        }));resume.control.disabled=item.state!=='completed'&&active;row.append(resume.form);pendingArea.append(row);continue;
      }
      row.append(text('h3',({'library.install':'加入作品草稿','library.capture':'保存作品','memory.propose':'保存创作记忆','backup.export':'导出全部世界和作品','backup.restore':'恢复全部世界和作品','draft.recheck':'重新检查草稿','task.budget':'设置任务累计额度'})[item.channel]||'待确认操作'));
      if(item.channel==='memory.propose')row.append(text('p',item.payload.claim));
      if(item.payload.ref)row.append(text('p',`${item.payload.ref.id} · v${item.payload.ref.version}`));
      row.append(text('p',item.state==='completed'?'服务已返回完成结果，等待你确认。':'结果尚未确认；重启不会自动再次写入。','workbench-meta'));
      if(item.channel==='backup.restore'&&item.state!=='completed')row.append(text('p','继续恢复将替换此客户端的全部世界资料。授权过期时须重新选择备份。','workbench-meta'));
      const control=button(item.state==='completed'?'确认已完成':'查询并继续原操作',()=>action(async()=>{
        const result=await call('workbench.execute',{operationId:item.operationId});
        if(item.state==='completed')await call('workbench.acknowledge',{operationId:item.operationId});
        if(item.channel==='backup.restore'&&result.status==='completed')await reloadWorld();
        await refreshPending();await refreshTask();
        status(item.channel==='library.install'?'作品已加入原草稿，仍需检查、评审并应用。':item.channel==='draft.recheck'?'草稿检查已提交，请查看检查记录。':result.status==='cancelled'?'这项操作已取消。':'原操作结果已确认。');
      }));control.control.disabled=item.state!=='completed'&&active;row.append(control.form);pendingArea.append(row);
    }
  }
  for(const [key,name]of Object.entries({library:'作品库',memory:'创作记忆',task:'任务与预算',backup:'备份与诊断'})){
    const section=document.createElement('section');section.dataset.workbenchPage=key;section.setAttribute('aria-label',name);section.hidden=true;pages[key]=section;element.append(section);
  }
  const godotPackages=createGodotPackageUI({element:pages.library,request,getWorldId:()=>getWorld()?.id,action});
  const issueArea=document.createElement('section');issueArea.dataset.issueNotebook='true';
  const issues=createIssueUI({element:issueArea,request,getWorldId:()=>getWorld()?.id,action});
  const parameterArea=document.createElement('section');parameterArea.dataset.targetFeedback='true';
  const parameters=createTargetFeedbackUI({element:parameterArea,request,getWorldId:()=>getWorld()?.id,durableCall,action});
  function status(message,error=false){notice.textContent=message;notice.dataset.error=String(error);}
  function has(channel){return capabilities.has(channel);}
  async function call(channel,payload={}){
    if(!has(channel))throw Error('这个功能尚未连接，请完成桌面服务更新后重试。');
    const generation=epoch,worldId=getWorld()?.id;if(!worldId)throw Error('请先打开世界');
    const result=await request(channel,{worldId,...payload});
    const restored=channel==='workbench.execute'&&result?.scope==='profile'&&result?.status==='completed'&&result?.activated===true;
    if(!restored&&(generation!==epoch||getWorld()?.id!==worldId))throw Error('WORLD_CHANGED');return result;
  }
  async function action(fn){
    if(pending||isLocked())return;const generation=epoch;pending++;onChange();status('处理中…');
    try{await run(fn);}catch(error){if(generation===epoch&&safeError(error)!=='WORLD_CHANGED')status(safeError(error),true);}
    finally{if(generation===epoch&&notice.textContent==='处理中…')status('已更新');pending--;onChange();if(!pending&&refreshWhenIdle){refreshWhenIdle=false;void show(currentTab);}}
  }
  function empty(section,message){section.replaceChildren(text('p',message,'workbench-empty'));}
  function renderSelection(){
    selectionElement.replaceChildren();selectionElement.hidden=!selected;
    if(!selected)return;
    const name=getWorld()?.world.build.scene.objects.find(o=>o.id===selected.objectId)?.name||selected.objectId;
    selectionElement.append(text('span','本次需求对象：'+name));
    const remove=button('移除',()=>action(async()=>{selectionRequest++;await call('selection.clear');selected=null;renderSelection();status('已移除需求对象');}));selectionElement.append(remove.form);
  }
  async function setSelection(value){
    const record=getWorld();
    if(!record||value.worldId!==record.id||value.build?.id!==record.world.build.id||value.build?.hash!==record.world.build.hash||!Number.isSafeInteger(value.selectionRevision)||value.selectionRevision<=selectionRevision)return false;
    if(value.objectId!==null&&!record.world.build.scene.objects.some(o=>o.id===value.objectId))return false;
    if(!capabilitiesReady){pendingSelection=value;return false;}
    selectionRevision=value.selectionRevision;
    const generation=epoch,sequence=++selectionRequest;
    try{await call(value.objectId===null?'selection.clear':'selection.set',value.objectId===null?{}:{build:value.build,objectId:value.objectId,selectionRevision:value.selectionRevision});if(generation!==epoch||sequence!==selectionRequest)return false;selected=value.objectId===null?null:value;renderSelection();return true;}
    catch(error){if(generation===epoch)status('选中对象尚未加入需求：'+safeError(error),true);return false;}
  }
  async function refreshTask(){
    if(!has('task.current')){context=null;active=false;return;}
    const response=await call('task.current');context=response?.context??(response?.binding?response:null);active=response?.active===true;
  }
  const librarySearch=field('搜索作品');librarySearch.control.placeholder='树、花草、射击…';librarySearch.control.maxLength=120;
  const libraryKind=field('作品类型','select');for(const [value,label]of [['','全部'],['object','物体'],['gameplay','基础玩法'],['creation','组合作品']]){const option=text('option',label);option.value=value;libraryKind.control.append(option);}
  const libraryForm=document.createElement('form');libraryForm.className='workbench-search';const searchButton=text('button','搜索');searchButton.type='submit';libraryForm.append(librarySearch.wrapper,libraryKind.wrapper,searchButton);
  const libraryList=document.createElement('div'),libraryDetail=document.createElement('section');libraryDetail.className='workbench-detail';libraryDetail.hidden=true;
  const libraryMore=button('更多作品',()=>action(()=>searchLibrary(false)));
  libraryForm.onsubmit=event=>{event.preventDefault();void action(()=>searchLibrary(true));};
  async function searchLibrary(reset=true){
    const world=getWorld()?.world;
    if(world?.build?.engine?.kind==='godot-web'||world?.build?.scene?.format==='craftmine.godot-scene/1'){
      const generation=epoch;await godotPackages.show();if(generation!==epoch)return;
      if(has('targetFeedback.describe')){pages.library.append(parameterArea);await parameters.show();}return;
    }
    if(!has('library.search')){empty(pages.library,'作品库服务尚未连接。已保存的世界仍可使用。');return;}
    if(reset)libraryOffset=0;
    await refreshTask();
    const result=await call('library.search',{query:librarySearch.control.value,offset:libraryOffset,limit:12,...(libraryKind.control.value?{kind:libraryKind.control.value}:{})});
    if(reset)libraryList.replaceChildren();
    for(const item of result.items||[]){
      const row=document.createElement('article');row.className='workbench-card';row.dataset.libraryRef=item.ref.id+'@'+item.ref.version;
      row.append(text('h3',item.name),text('p',`${kinds[item.kind]||item.kind} · v${item.ref.version} · ${item.evidence?.applied?'已应用来源':item.evidence?.verified?'已检查来源':'待验证来源'}`,'workbench-meta'),text('p',item.description));
      const details=button('查看固定版本',()=>action(()=>readLibrary(item.ref)));row.append(details.form);libraryList.append(row);
    }
    if(!libraryList.children.length)libraryList.append(text('p','没有找到作品。可以换个关键词，或先保存已经应用的内容。','workbench-empty'));
    libraryOffset=result.next;libraryMore.form.hidden=result.next===null||result.next===undefined;
    pages.library.replaceChildren(libraryForm,libraryList,libraryMore.form,libraryDetail,buildCapture());status(active?'助手正在创作，作品安装将在当前任务结束后可用。':'已读取作品库');
  }
  async function readLibrary(ref,start=0){
    const result=await call('library.read',{ref,start,limit:12000});libraryDetail.hidden=false;
    if(!start){
      libraryDetail.replaceChildren(text('h3',`${result.name||ref.id} · 固定版本 ${ref.version}`));
      libraryDetail.append(text('p','依赖：'+(result.dependencies||[]).map(dependency).join('、'),'workbench-meta'));
      libraryDetail.append(text('p',`来源：${result.scope?.worldId===getWorld().id?'当前世界':result.scope?.worldId?'其他世界':'共享作品'} · ${result.evidence?.applied?'已应用':result.evidence?.verified?'已验证':'尚待验证'}`,'workbench-meta'));
      const source=document.createElement('details'),summary=text('summary','查看源码与来源标识'),code=text('pre','','workbench-code');code.dataset.librarySource='true';source.append(summary,text('p',ref.hash,'workbench-hash'),code);libraryDetail.append(source);
      source.append(text('p',(result.dependencies||[]).join('、'),'workbench-hash'));
      const install=button('加入当前草稿',()=>action(async()=>{
        await refreshTask();if(active)throw Error('请等当前创作任务结束后再安装作品。');
        const result=await durableCall('library.install',{ref,...(context?.draft?{revision:context.draft.revision}:{})},{ref});
        if(!result.receipt)throw Error('安装回执尚未确认，请查询任务后再继续。');
        status(result.verificationStatus==='retry-required'?'作品已加入草稿，但检查提交尚未确认。请在任务页重新检查已保存草稿。':'已加入草稿，仍需检查、评审并应用到世界。');await refreshTask();
      }));install.control.disabled=active||!has('library.install');libraryDetail.append(install.form);
    }
    const code=libraryDetail.querySelector('[data-library-source]');code.textContent=start?code.textContent+result.source.text:result.source.text;
    libraryDetail.querySelector('[data-source-more]')?.remove();
    if(result.source.next!==null){const more=button('继续读取源码',()=>action(()=>readLibrary(ref,result.source.next)));more.form.dataset.sourceMore='true';libraryDetail.append(more.form);}
  }
  function buildCapture(){
    const detail=document.createElement('details');detail.append(text('summary','把已应用内容存入作品库'));
    if(!has('library.capture')){detail.append(text('p','作品保存服务尚未连接。'));return detail;}
    const form=document.createElement('form');form.className='workbench-form';const resource=field('选择内容','select'),tags=field('标签（逗号分隔）');tags.control.maxLength=160;
    const scene=getWorld().world.build.scene;
    for(const [kind,group]of [['object','objects'],['gameplay','systems'],['creation','behaviors']])for(const item of scene[group]||[]){const option=text('option',`${kinds[kind]} · ${item.name}`);option.value=kind+':'+item.id;resource.control.append(option);}
    const submit=text('button','保存作品');submit.type='submit';submit.disabled=!resource.control.options.length||active;form.append(resource.wrapper,tags.wrapper,submit);
    form.onsubmit=event=>{event.preventDefault();void action(async()=>{
      const [kind,resourceId]=resource.control.value.split(':');const application=context?.receipts?.find(r=>r.status==='applied'||r.type==='application');
      await durableCall('library.capture',{kind,resourceId,tags:tags.control.value.split(/[,，]/).map(v=>v.trim()).filter(Boolean).slice(0,8),...(application?.id?{applicationId:application.id}:{})});status('已保存作品，可按固定版本复用。');
    });};detail.append(form);return detail;
  }
  const memorySearch=field('搜索规则与经验');memorySearch.control.maxLength=120;const inactive=field('包含已停用记录');inactive.control.type='checkbox';
  const memoryForm=document.createElement('form');memoryForm.className='workbench-search';const memorySubmit=text('button','搜索');memorySubmit.type='submit';memoryForm.append(memorySearch.wrapper,inactive.wrapper,memorySubmit);
  const memoryList=document.createElement('div'),memoryMore=button('更多记忆',()=>action(()=>searchMemory(false)));
  memoryForm.onsubmit=event=>{event.preventDefault();void action(()=>searchMemory(true));};
  async function searchMemory(reset=true){
    if(!has('memory.search')){empty(pages.memory,'记忆服务尚未连接。对话记录不会被冒充为已验证作品。');return;}
    if(reset)memoryOffset=0;const result=await call('memory.search',{query:memorySearch.control.value,includeInactive:inactive.control.checked,offset:memoryOffset,limit:12});
    if(reset)memoryList.replaceChildren();
    for(const item of result.items||[]){const row=document.createElement('article');row.className='workbench-card';row.dataset.memoryId=item.id;
      row.append(text('h3',kinds[item.kind]||item.kind),text('p',item.claim),text('p',`${labels[item.status]||item.status} · ${item.scope?.worldId?'仅此世界':'项目作用域'}`,'workbench-meta'));
      const source=document.createElement('details');source.append(text('summary','来源与适用范围'),text('pre',JSON.stringify({scope:item.scope,sourceRefs:item.sourceRefs},null,2),'workbench-code'));row.append(source);
      if(item.status!=='retired'&&has('memory.retire'))row.append(button('停用',()=>action(async()=>{await call('memory.retire',{id:item.id,reason:'玩家在创作记忆面板停用'});await searchMemory(true);status('已停用这条记忆。');})).form);
      if(item.status!=='retired'&&has('memory.propose'))row.append(button('替代这条规则',async()=>{memoryClaim.control.value=item.claim;memoryClaim.control.dataset.replaceId=item.id;memoryKind.control.value=item.kind==='project-rule'?'project-rule':'workflow';memoryEditor.open=true;}).form);
      memoryList.append(row);
    }
    if(!memoryList.children.length)memoryList.append(text('p','这个世界还没有匹配的记忆。','workbench-empty'));
    memoryOffset=result.next;memoryMore.form.hidden=result.next===null||result.next===undefined;pages.memory.replaceChildren(memoryForm,memoryList,memoryMore.form,memoryEditor);status('已读取当前作用域的记忆。');
  }
  const memoryEditor=document.createElement('details');memoryEditor.append(text('summary','添加规则或用户纠正'));
  const memoryClaim=field('规则内容','textarea');memoryClaim.control.maxLength=400;memoryClaim.control.required=true;
  const memoryKind=field('记忆类型','select');for(const [value,label]of [['project-rule','创作规则 / 用户纠正'],['workflow','创作流程']]){const option=text('option',label);option.value=value;memoryKind.control.append(option);}
  const memoryAdd=document.createElement('form');memoryAdd.className='workbench-form';const memorySave=text('button','保存记忆');memorySave.type='submit';memoryAdd.append(memoryKind.wrapper,memoryClaim.wrapper,text('p','仅用于当前世界；验证状态由实际来源决定。替代规则通过来源核验后才会取代旧规则。','workbench-meta'),memorySave);memoryEditor.append(memoryAdd);
  memoryAdd.onsubmit=event=>{event.preventDefault();void action(async()=>{
    await durableCall('memory.propose',{kind:memoryKind.control.value,claim:memoryClaim.control.value.trim(),tags:[],...(memoryClaim.control.dataset.replaceId?{replaceId:memoryClaim.control.dataset.replaceId}:{})});
    memoryClaim.control.value='';delete memoryClaim.control.dataset.replaceId;await searchMemory(true);status('记忆已保存，是否验证通过以来源核验结果为准。');
  });};
  async function showTask(){
    if(!has('task.current')){empty(pages.task,'任务状态服务尚未连接。请在主聊天区查看创作进度和停止任务。');return;}
    await refreshTask();pages.task.replaceChildren();
    if(context){const card=document.createElement('article');card.className='workbench-card';card.append(text('h3',labels[context.status]||context.status||'当前任务'));
      for(const requirement of context.requirements||[])card.append(text('p',(requirement.kind==='correction'?'最新纠正：':'目标：')+requirement.text));
      card.append(text('p',`草稿 ${context.draft?.revision??'未知'} · 已修改 ${(context.modifiedResources||[]).length} 项`,'workbench-meta'));
      const budget=context.budget||{};card.append(text('p',`模型请求 ${count(budget.requestCount)} / ${count(budget.limits?.maxRequests)} · 压缩 ${count(budget.compactionCount)} / ${count(budget.limits?.maxCompactions)}`));
      card.append(text('p',`实际用量 ${count(budget.actualTokens)} · 预留 ${count(budget.reservedTokens)} · 结果待确认 ${count(budget.unknownRequestCount)} 次`));
      card.append(text('p',`任务累计 token 上限：${budget.limits?.maxTokens===null?'不限':count(budget.limits?.maxTokens)} · 剩余额度：${budget.remainingTokens===null?'不限':count(budget.remainingTokens)}`,'workbench-meta'));
      card.append(text('p','这是整个任务的累计用量，不是模型一次能读取的上下文容量。解除累计上限仍保留请求次数、压缩次数、截止时间和模型单次限制。','workbench-meta'));
      if(has('task.budget')){
        const configure=async maxTokens=>action(async()=>{
          const target={taskId:context.binding.taskId,generation:context.generation};
          await durableCall('task.budget',{...target,maxTokens});await showTask();status('累计额度已更新；已发生用量与待确认占额保留。中断任务请点恢复继续。');
        });
        const unlimited=button('解除本地累计 token 上限',()=>configure(null));unlimited.control.disabled=active||budget.limits?.maxTokens===null;card.append(unlimited.form);
        const maximum=field('自定义任务累计 token 额度');maximum.control.type='number';maximum.control.min='1';maximum.control.max=String(Number.MAX_SAFE_INTEGER);maximum.control.step='1';maximum.control.required=true;
        const custom=button('保存累计额度',()=>{const value=Number(maximum.control.value);if(!Number.isSafeInteger(value)||value<1){status('请输入正整数额度。',true);return;}return configure(value);});custom.control.disabled=active;custom.form.prepend(maximum.wrapper);card.append(custom.form);
      }
      if(active&&has('task.stop'))card.append(button('停止当前任务',()=>action(async()=>{await call('task.stop',{taskId:context.binding.taskId,generation:context.generation});status('停止请求已提交，等待任务状态确认。');await showTask();})).form);
      pages.task.append(card);
      if(context.status==='finished'&&has('draft.recheck')){
        const retry=button('重新检查已保存草稿',()=>action(async()=>{
          await refreshTask();if(!context||active||context.status!=='finished')throw Error('请等待当前任务结束后再检查草稿。');
          const result=await durableCall('draft.recheck',{taskId:context.binding.taskId,generation:context.generation,revision:context.draft.revision,draftHash:context.draft.hash});
          status(result.status==='queued'||result.status==='running'?'原草稿检查已提交，请查看检查记录。':'检查结果：'+(result.status||'待确认'));
        }));retry.control.disabled=active;pages.task.append(retry.form,text('p','只检查当前草稿，不会重复加入作品或重新创建任务。','workbench-meta'));
      }
    }else pages.task.append(text('p','没有正在创作的任务。世界和已保存草稿仍然保留。','workbench-empty'));
    if(has('task.recoverable')){
      const response=await call('task.recoverable');const entries=Array.isArray(response)?response:response.items||response.tasks||[];
      for(const item of entries){const row=document.createElement('article');row.className='workbench-card';row.append(text('h3','可恢复的创作'),text('p',item.summary||item.reason||'任务中断，已有草稿已保存。'),text('p','继续前将核对世界版本；不会自动重放旧模型请求。','workbench-meta'));
        for(const [operation,label]of [['resume','继续创作'],['discard','结束此草稿任务']])if(has('task.'+operation)){const control=button(label,()=>action(async()=>{const result=await call('task.'+operation,{taskId:item.taskId||item.id,generation:item.generation});await showTask();status(operation==='resume'?(result?.continuation==='running'?'草稿已恢复，正在继续创作。':'草稿已恢复，请在对话中继续创作。'):'已结束该任务，正式世界保持原状。');}));control.control.disabled=active;row.append(control.form);}pages.task.append(row);
      }
    }
  }
  async function showBackup(){
    const generation=epoch;
    await refreshTask();
    if(generation!==epoch)return;
    issues.clear();
    pages.backup.replaceChildren(text('h2','备份与恢复'));
    if(has('issue.list')){pages.backup.append(issueArea);await issues.show();}
    if(generation!==epoch)return;
    pages.backup.append(text('p','备份包含此客户端的全部世界、作品与进度。模型密钥和浏览器档案不会打包。','workbench-meta'));
    const exportButton=button('导出全部世界和作品',()=>action(async()=>{await saveBeforeBackup();const result=await durableCall('backup.export',{});status(result?.cancelled||result?.status==='cancelled'?'已取消导出':result?.status==='completed'||result?.exported?'备份已导出。':'已提交导出，请查看作业状态。');}));exportButton.control.disabled=!has('backup.export');pages.backup.append(exportButton.form);
  const inspectButton=button('选择备份并查看内容',()=>action(async()=>{
      await saveBeforeBackup();
      const result=await call('backup.inspect');if(result?.cancelled||result?.status==='cancelled'){status('已取消选择');return;}
      inspection=result;renderInspection();status('请核对备份内容后再恢复。');
    }));inspectButton.control.disabled=!has('backup.inspect');pages.backup.append(inspectButton.form);
    const area=document.createElement('section');area.dataset.backupInspection='true';pages.backup.append(area);renderInspection();
    pages.backup.append(text('h2','诊断与系统保护'));
    if(has('diagnostics.status')){const result=await call('diagnostics.status');const protection=result.credentials?.status||result.protection||'unavailable';
      pages.backup.append(text('p',protection==='protected'?'模型凭据：Windows 系统保护':protection==='fallback'?'模型凭据：旧存储，等待系统保护迁移':'模型凭据保护状态暂不可用'));
      if(result.summary)pages.backup.append(text('p',result.summary));
    }else pages.backup.append(text('p','诊断服务尚未连接。','workbench-meta'));
    const diagnostics=button('导出诊断信息',()=>action(async()=>{const result=await call('diagnostics.export',{operationId:crypto.randomUUID()});status(result?.cancelled||result?.status==='cancelled'?'已取消诊断导出':result?.status==='completed'||result?.exported?'诊断信息已导出。':'已提交诊断导出。');}));diagnostics.control.disabled=!has('diagnostics.export');pages.backup.append(diagnostics.form);
    if(has('diagnostics.help'))pages.backup.append(button('打开 Windows 使用指南',()=>action(()=>call('diagnostics.help'))).form);
  }
  function renderInspection(){
    const area=pages.backup.querySelector('[data-backup-inspection]');if(!area)return;area.replaceChildren();if(!inspection)return;
    area.append(text('h3','待恢复内容'),text('p',inspection.summary||'已读取备份，请核对来源与数据范围。'));
    for(const item of inspection.worlds||inspection.manifest?.worlds||[])area.append(text('p',item.title||item.id));
    if(inspection.counts)area.append(text('p',Object.entries(inspection.counts).map(([key,value])=>`${({worlds:'世界',library:'作品',memories:'记忆'})[key]||key} ${count(value)}`).join(' · ')));
    area.append(text('p','恢复将替换此客户端的全部世界资料和作品，不仅是当前世界。请先导出当前资料。校验失败时保留原资料。','workbench-meta'));
    const confirmation=field('我已核对备份内容');confirmation.control.type='checkbox';confirmation.control.required=true;
    const form=button('确认恢复这份备份',()=>action(async()=>{
      if(!confirmation.control.checked)throw Error('请先核对并确认备份内容。');
      renderInspection();
      const result=await durableCall('backup.restore',{grantId:inspection.grantId,expectedCurrentHash:inspection.expectedCurrentHash});
      if(result?.record)replaceWorld(result.record);
      status(result?.status==='completed'||result?.restored?'备份已恢复。':'恢复结果尚未确认，请刷新状态。');
      if(result?.status==='completed'||result?.restored){inspection=null;await reloadWorld();}
    }));form.control.disabled=!has('backup.restore')||!inspection.grantId||active;form.form.prepend(confirmation.wrapper);area.append(form.form);
    if(active)area.append(text('p','创作任务仍在运行，请先停止或等待完成，再恢复备份。','workbench-meta'));

  }
  async function show(tab){
    if(tab!=='library')parameters.clear();
    currentTab=tab;element.hidden=!tab;for(const [key,page]of Object.entries(pages))page.hidden=key!==tab;
    if(!tab){refreshWhenIdle=false;return;}if(pending){refreshWhenIdle=true;return;}refreshWhenIdle=false;pause();status('正在读取…');
    await action(async()=>{await refreshPending();return tab==='library'?searchLibrary(true):tab==='memory'?searchMemory(true):tab==='task'?showTask():showBackup();});
  }
  async function refreshCapabilities(){
    const generation=epoch;const worldId=getWorld()?.id;if(!worldId)return;
    try{const result=await request('workbench.capabilities',{worldId});if(generation!==epoch)return;capabilities=new Set(result?.channels||[]);capabilitiesReady=true;if(pendingSelection){const value=pendingSelection;pendingSelection=null;void setSelection(value);}await refreshTask();if(currentTab)await show(currentTab);}
    catch(error){if(generation===epoch){status('扩展工作台尚未连接：'+safeError(error),true);if(currentTab)empty(pages[currentTab],'这个功能尚未连接，现有世界的保存与检查仍可使用。');}}
  }
  async function setWorld(){
    godotPackages.clear();
    issues.clear();
    parameters.clear();
    epoch++;pendingArea.replaceChildren();pendingArea.hidden=true;capabilities.clear();capabilitiesReady=false;pendingSelection=null;context=null;active=false;selected=null;selectionRevision=0;inspection=null;libraryDetail.hidden=true;renderSelection();
    await refreshCapabilities();
  }
  return {show,setWorld,setSelection,refreshCapabilities,refreshPending:()=>!pending&&!isLocked()?refreshPending().catch(()=>{pendingArea.replaceChildren();pendingArea.hidden=true;}):Promise.resolve(),get busy(){return pending>0;},get tab(){return currentTab;},refresh:()=>currentTab?show(currentTab):refreshTask(),clearView(){epoch++;refreshWhenIdle=false;issues.clear();parameters.clear();selected=null;renderSelection();}};
}
