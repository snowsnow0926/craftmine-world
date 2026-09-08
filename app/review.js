import { FIELD_LABELS,reviewEntities,diffLines } from './scene-diff.mjs';
const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const names={object:'对象',system:'基础玩法',behavior:'代码玩法',world:'环境'},changes={added:'新增',removed:'移除',changed:'修改'};
const value=v=>v===undefined?'—':typeof v==='boolean'?(v?'是':'否'):typeof v==='object'?JSON.stringify(v):String(v);
function fieldRows(a,b,prefix='',out=[]){
  if(JSON.stringify(a)===JSON.stringify(b))return out;
  if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
    for(const key of new Set([...Object.keys(a),...Object.keys(b)]))fieldRows(a[key],b[key],prefix?prefix+'.'+key:key,out);
  }else out.push({path:prefix||'值',before:a,after:b});return out;
}
export class CandidateReview {
  constructor(host){
    this.host=host;this.session=null;
    $('review-open').onclick=()=>this.open();$('review-close').onclick=()=>this.close();
    $('candidate-review').oncancel=e=>{e.preventDefault();this.close();};$('candidate-review').onclose=()=>{if(!$('candidate-review').open)this.close();};
    for(const side of ['before','after'])$('review-'+side).onclick=()=>this.show(side);
    $('review-reset').onclick=()=>{if(this.session?.snapshot&&!$('review-reset').disabled){this.session.camera=structuredClone(this.session.snapshot.player);this.show(this.session.side,{reset:true});}};
    $('review-focus').onclick=()=>this.focus();
    $('review-select').onclick=()=>{const item=this.session?.item,target=this.target(item);if(target&&this.session.data.before.scene.objects.some(o=>o.id===target)){this.close();host.select(target);}};
    $('review-apply').onclick=()=>host.apply();$('review-discard').onclick=()=>host.discard();
  }
  valid(session){return this.session===session;}
  invalidate(project){const s=this.session,c=project.candidate;if(s&&(!c||c.id!==s.id||c.base!==s.base||c.time!==s.time||project.current!==s.base))this.close();}
  error(error,session){if(this.valid(session)){$('review-status').textContent=error.message;$('review-status').dataset.error='true';}}
  frameError(frame,message){const s=this.session;if(s?.frames.has(frame)){if(s.side==='after'){s.readyAfter=false;$('review-apply').disabled=true;}this.error(Error(message),s);}}
  async open(){
    const c=this.host.project()?.candidate,active=this.host.active();if(!c||!active||this.session)return;
    const s={id:c.id,base:c.base,time:c.time,active,frames:new Set(),generation:0,side:'after',readyAfter:false};this.session=s;
    $('review-title').textContent='查看这次改变';$('review-summary').textContent=c.summary;$('review-items').replaceChildren();$('review-fields').replaceChildren();$('review-status').dataset.error='false';$('review-status').textContent='正在准备独立副本…';
    $('review-apply').disabled=true;$('review-reset').disabled=true;$('review-focus').disabled=true;$('review-select').hidden=true;$('candidate-review').showModal();
    try{
      // Freeze the original frame before any asynchronous loading. Only this frame is autosaved.
      s.snapshot=await this.host.snapshot(active,true);if(!this.valid(s))return;
      s.camera=structuredClone(s.snapshot.player);
      s.data=await this.host.api('/api/candidate/review?id='+s.id+'&base='+s.base);if(!this.valid(s))return;
      if(s.data.time!==s.time)throw Error('候选已改变，请重新打开预览');
      $('review-note').textContent=s.data.importSnapshot?'此候选来自完整存档，应用时恢复文件中的进度。预览中的试玩不会保存。':'这是独立副本。试玩进度不会保存；应用时延续原世界的最新进度。';
      const items=s.data.diff.details.items;
      $('review-count').textContent=items.length?`${items.length} 项定义变化`:'场景定义未变 · 恢复存档进度';
      for(const item of items){const button=node('button',undefined,'change-item '+item.change);button.type='button';button.dataset.kind=item.kind;button.dataset.id=item.id;
        button.append(node('span',changes[item.change],'change-badge'),node('strong',item.name),node('small',names[item.kind]+' · '+item.fields.map(f=>FIELD_LABELS[f]||f).join('、')));button.onclick=()=>this.select(item);$('review-items').append(button);}
      if(items.length)this.select(items[0]);else $('review-fields').append(node('p','本次恢复文件中的位置和玩法进度。'));
      await this.show('after');
    }catch(error){this.error(error,s);}
  }
  target(item){if(!item||!this.session?.data)return null;const {before,after}=reviewEntities(this.session.data,item);return item.kind==='object'?item.id:item.kind==='behavior'?(after||before)?.targets[0]:null;}
  select(item){
    const s=this.session;if(!s?.data)return;s.item=item;
    for(const row of $('review-items').children)row.setAttribute('aria-pressed',String(row.dataset.kind===item.kind&&row.dataset.id===item.id));
    const {before,after}=reviewEntities(s.data,item),out=$('review-fields');out.replaceChildren(node('h3',item.name));
    for(const field of item.fields){
      const a=before?.[field],b=after?.[field],section=node('details',undefined,'field-change');section.open=!['parts','code','binding','initialState'].includes(field);
      section.append(node('summary',FIELD_LABELS[field]||field));
      if(field==='code'){
        const diff=node('pre',undefined,'source-preview code-diff');for(const row of diffLines(a||'',b||''))diff.append(node('span',(row.type==='added'?'+ ':row.type==='removed'?'− ':'  ')+row.text,row.type));section.append(diff);
      }else{
        const table=node('table',undefined,'field-table'),header=node('tr');for(const label of ['字段','当前','候选'])header.append(node('th',label));table.append(header);
        const rows=fieldRows(a,b);for(const row of rows.slice(0,80)){const tr=node('tr');for(const v of [row.path,value(row.before),value(row.after)])tr.append(node('td',v));table.append(tr);}section.append(table);
        if(rows.length>80)section.append(node('p',`共 ${rows.length} 处字段变化，以上显示前 80 处；完整内容见下方。`));
      }
      const full=node('details',undefined,'full-field');full.append(node('summary','查看完整内容'),node('p','当前'),node('pre',field==='code'?(a||'—'):JSON.stringify(a??null,null,2),'source-preview'),node('p','候选'),node('pre',field==='code'?(b||'—'):JSON.stringify(b??null,null,2),'source-preview'));section.append(full);out.append(section);
    }
    const target=this.target(item);$('review-focus').disabled=!target||!s.frame;$('review-select').hidden=!target||!s.data.before.scene.objects.some(o=>o.id===target);
  }
  async show(side,{reset=false}={}){
    const s=this.session;if(!s?.data)return;const generation=++s.generation;
    if(side==='after'){s.readyAfter=false;$('review-apply').disabled=true;}
    $('review-status').dataset.error='false';$('review-status').textContent='正在载入'+(side==='after'?'候选':'当前')+'世界副本…';$('review-focus').disabled=true;$('review-reset').disabled=true;
    for(const name of ['before','after']){$('review-'+name).disabled=true;$('review-'+name).setAttribute('aria-pressed',String(name===side));}
    try{
      if(s.frame){if(!reset)s.camera=(await this.host.snapshot(s.frame)).player;if(!this.valid(s)||generation!==s.generation)return;this.host.remove(s.frame);s.frames.delete(s.frame);s.frame=null;}
      s.side=side;
      const snapshot=structuredClone(side==='after'&&s.data.importSnapshot?s.data.importSnapshot:s.snapshot);
      // Import previews start at the file's saved viewpoint; ordinary comparisons share a camera.
      if(!(side==='after'&&s.data.importSnapshot))snapshot.player=structuredClone(s.camera);
      const frame=await this.host.mount(s.data[side],snapshot,{container:$('review-canvas'),preview:true,onCreated:f=>s.frames.add(f)});
      if(!this.valid(s)||generation!==s.generation){this.host.remove(frame);return;}
      s.frame=frame;frame.element.classList.remove('staging');s.camera=structuredClone(frame.snapshot.player);
      if(side==='after')s.readyAfter=true;$('review-apply').disabled=!s.readyAfter;
      $('review-status').textContent=(side==='after'?'候选世界':'当前世界')+' · 独立预览，可在画面中试玩';
      $('review-focus').disabled=!this.target(s.item);
    }catch(error){if(this.valid(s)&&generation===s.generation){if(side==='after')s.readyAfter=false;$('review-apply').disabled=!s.readyAfter;this.error(error,s);}}
    finally{if(this.valid(s)&&generation===s.generation){for(const name of ['before','after'])$('review-'+name).disabled=false;$('review-reset').disabled=false;}}
  }
  async focus(){
    const s=this.session,id=this.target(s?.item);if(!s?.data||!id)return;
    try{
      const side=s.data.after.scene.objects.some(o=>o.id===id)?'after':'before';if(s.side!==side||!s.frame)await this.show(side);
      if(!this.valid(s)||!s.frame)return;const snapshot=await this.host.inspect(s.frame,id);s.camera=structuredClone(snapshot.player);
    }catch(error){this.error(error,s);}
  }
  close({resume=true}={}){
    const s=this.session;if(!s)return;this.session=null;s.generation++;
    for(const frame of s.frames)this.host.remove(frame);$('review-canvas').replaceChildren();
    if(resume&&this.host.active()===s.active)this.host.post(s.active,'resume');
    if($('candidate-review').open)$('candidate-review').close();
  }
}
