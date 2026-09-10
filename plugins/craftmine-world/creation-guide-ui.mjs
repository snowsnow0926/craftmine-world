// Optional reading and navigation only; this module has no world or model authority.
export function createCreationGuideUI({element, navigate}) {
  const doc=element.ownerDocument;
  let mounted=false, disposed=false, generation=0;
  const listeners=[];
  const node=(tag,value)=>{const result=doc.createElement(tag);if(value)result.textContent=value;return result;};
  function clear() {
    generation++;
    for(const [form,handler] of listeners.splice(0))form.removeEventListener('submit',handler);
    element.replaceChildren();mounted=false;
  }
  function show() {
    if(disposed||mounted)return;
    mounted=true;
    const epoch=++generation,details=node('details'),summary=node('summary','创作流程说明（可跳过）');
    details.className='craftmine-creation-guide';
    const style=node('style',`.craftmine-creation-guide{border:1px solid var(--border,#444);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:13px;line-height:1.6}.craftmine-creation-guide summary{cursor:pointer}.craftmine-creation-guide ol{padding-left:22px;margin:10px 0}.craftmine-creation-guide li+li{margin-top:6px}.craftmine-creation-guide p{margin:8px 0}.craftmine-creation-guide .creation-guide-actions{display:flex;gap:8px;flex-wrap:wrap}.craftmine-creation-guide form{margin:0}`);
    details.append(summary,node('p','不必一次完成。收起即可跳过，需要时再展开查看。'));
    const steps=node('ol');
    for(const [title,description] of [
      ['创建世界','在“新建”中选择底座和起点，也可以打开已有世界。'],
      ['创作草稿','在创作对话或当前世界可用的创作工具中提出修改。草稿还不是正式世界。'],
      ['检查','修改草稿后进行检查，在“检查记录”查看结果。检查通过不等于已经采用修改。'],
      ['预览','从通过检查的结果打开“预览副本”，试一试修改。预览中的游玩不会写入正式世界。'],
      ['采用修改','满意后选择“应用到世界”，等待确认成功；也可以返回世界，继续修改草稿。'],
      ['保存并重开','回到正式世界游玩后点“保存”，确认“已保存”，下次从世界列表打开这个世界继续。'],
    ]) {const item=node('li');item.append(node('strong',title+'：'),doc.createTextNode(description));steps.append(item);}
    details.append(steps,node('p','这里是流程说明，不代表任何步骤已经完成；具体结果以检查记录和世界提示为准。'));
    if(typeof navigate==='function') {
      const actions=node('div'),notice=node('p'),buttons=[];
      actions.className='creation-guide-actions';notice.setAttribute('role','status');notice.hidden=true;
      let pending=false;
      for(const [tab,label] of [['checks','查看检查记录'],['library','查看作品库']]) {
        const form=node('form'),button=node('button',label);button.type='submit';buttons.push(button);form.append(button);
        const handler=async event=>{
          event.preventDefault();
          if(pending||!mounted||epoch!==generation||disposed)return;
          pending=true;notice.hidden=true;buttons.forEach(item=>item.disabled=true);
          try {await navigate(tab);}
          catch {if(mounted&&epoch===generation&&!disposed){notice.textContent='暂时无法打开，请稍后重试，也可以使用原有导航。';notice.hidden=false;}}
          finally {if(mounted&&epoch===generation&&!disposed){pending=false;buttons.forEach(item=>item.disabled=false);}}
        };
        form.addEventListener('submit',handler);listeners.push([form,handler]);actions.append(form);
      }
      details.append(actions,notice);
    }
    element.replaceChildren(style,details);
  }
  return {show,clear,dispose(){clear();disposed=true;}};
}
