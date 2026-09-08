import { runtimeProblems } from './project-context.mjs';
const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
export class ProjectContextPanel {
  constructor(host){
    this.host=host;this.revision=-1;this.dirty=false;this.writing=false;this.recordsKey='';this.problemsKey='';
    $('context-editor').oninput=()=>{this.dirty=true;this.status('尚未保存；保存后用于下一次创作。');};
    $('context-add-note').onclick=()=>{if($('context-notes').children.length>=24){this.status('长期约定最多 24 条，可先整理已有内容。');return;}this.addNote({id:crypto.randomUUID(),text:'',objectId:null});this.dirty=true;};
    $('context-editor').onsubmit=e=>{e.preventDefault();this.save();};
    $('context-reload').onclick=async()=>{try{const data=await host.api('/api/state');this.hydrate(data.projectContext);this.status('已载入保存的方向。');}catch(e){this.status(e.message);}};
    $('context-search').oninput=()=>this.records();
  }
  status(text){$('context-status').textContent=text;}
  value(){return {revision:this.revision,brief:$('context-brief').value,notes:[...$('context-notes').children].map(e=>({id:e.dataset.id,text:e.querySelector('textarea').value,objectId:e.querySelector('select').value||null}))};}
  addNote(note){
    const row=node('div',undefined,'context-note');row.dataset.id=note.id;
    const input=node('textarea');input.value=note.text;input.maxLength=1000;input.rows=2;input.setAttribute('aria-label','长期约定');
    const scope=node('select');scope.setAttribute('aria-label','约定适用对象');const option=(id,name)=>{const e=node('option',name);e.value=id;scope.append(e);};option('','整个世界');
    for(const object of this.build?.scene.objects||[])option(object.id,object.name+' · '+object.id);
    if(note.objectId&&!this.build?.scene.objects.some(o=>o.id===note.objectId))option(note.objectId,'已不在世界中的对象 · '+note.objectId);scope.value=note.objectId||'';
    const remove=node('button','移除约定','subtle');remove.type='button';remove.onclick=()=>{row.remove();this.dirty=true;this.status('约定已从草稿移除，保存后生效。');};
    const actions=node('div',undefined,'context-note-actions');actions.append(scope,remove);row.append(input,actions);$('context-notes').append(row);
  }
  hydrate(memory){this.revision=memory.revision;this.dirty=false;$('context-brief').value=memory.brief;$('context-notes').replaceChildren();for(const note of memory.notes)this.addNote(note);}
  async save(){
    if(this.writing)return;this.writing=true;$('context-fields').disabled=true;
    try{const result=await this.host.api('/api/project-context',this.value());this.hydrate(result.projectContext);this.status('已保存。下一次生成会读取这些方向与约定。');await this.host.refresh();}
    catch(e){this.status(e.message);}finally{this.writing=false;$('context-fields').disabled=false;}
  }
  records(){
    const query=$('context-search').value.trim().toLowerCase(),out=$('context-history');out.replaceChildren();
    const records=(this.project?.projectContext.accepted||[]).filter(r=>(r.request+' '+r.summary).toLowerCase().includes(query)).slice().reverse();
    $('context-history-count').textContent=`保留最近 ${this.project?.projectContext.accepted.length||0} 条已应用需求（最多 64 条）。重要约定可写在上方长期保存。`;
    if(!records.length)out.append(node('p',query?'没有匹配的已应用需求。':'应用候选后，需求原文与版本会记在这里。','empty'));
    for(const record of records){
      const row=node('details',undefined,'context-history-record');row.dataset.id=record.id;row.append(node('summary',record.request),node('p',record.summary),node('small',new Date(record.time).toLocaleString()+' · 已应用至 '+record.build));
      const pin=node('button','整理为长期约定','subtle');pin.type='button';pin.onclick=()=>{if($('context-notes').children.length>=24){this.status('长期约定已满，请先整理。');return;}this.addNote({id:crypto.randomUUID(),text:record.request.slice(0,1000),objectId:this.build?.scene.objects.some(o=>o.id===record.selected)?record.selected:null});this.dirty=true;this.status('已放入约定草稿，请整理成持续适用的要求后保存。');};row.append(pin);out.append(row);
    }
  }
  render(project,build){
    this.project=project;this.build=build;const memory=project.projectContext;if(!memory)return;
    if(this.revision<0||(memory.revision>this.revision||build?.id!==this.buildId&&memory.revision===this.revision)&&!this.dirty&&!this.writing)this.hydrate(memory);
    else if(memory.revision>this.revision&&this.dirty&&!this.writing)this.status('保存的方向已更新；你的草稿仍保留。可复制修改后载入保存版本并合并。');
    this.buildId=build?.id;const recordsKey=JSON.stringify(memory.accepted);if(recordsKey!==this.recordsKey){this.recordsKey=recordsKey;this.records();}
    const problems=build?.id===project.current?runtimeProblems(build,project.snapshot):[],key=JSON.stringify(problems);
    if(key!==this.problemsKey){this.problemsKey=key;const out=$('runtime-problems');out.replaceChildren();$('runtime-problem-section').hidden=!problems.length;
      for(const problem of problems){const row=node('article',undefined,'runtime-problem');row.dataset.id=problem.id;row.append(node('strong',problem.name+' · 已停止'),node('p',problem.message));const repair=node('button','描述这个问题给助手','subtle');repair.type='button';repair.onclick=()=>this.host.repair(problem);row.append(repair);out.append(row);}
    }
  }
}
