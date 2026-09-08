// User-authored direction and applied requests are distinct from reusable code modules.
export const CONTEXT_LIMITS={brief:4000,notes:24,note:1000,accepted:64,retrieved:8};
const clone=value=>structuredClone(value),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const keys=(value,expected)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==expected.length||expected.some(k=>!Object.hasOwn(value,k)))throw Error('创作方向字段无效');};
const text=(value,max,empty=false)=>{if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))throw Error('创作方向文字为空或超过长度限制');return value.trim();};
export function emptyProjectContext(){return {format:'craftmine.context/1',revision:0,brief:'',notes:[],accepted:[]};}
export function editProjectContext(current,input,scene){
  keys(input,['revision','brief','notes']);if(input.revision!==current.revision)throw Error('创作方向已更新，请先载入已保存内容，再合并你的修改');
  if(!Array.isArray(input.notes)||input.notes.length>CONTEXT_LIMITS.notes)throw Error('长期约定最多保存 24 条');
  const ids=new Set(),notes=input.notes.map(note=>{
    keys(note,['id','text','objectId']);if(typeof note.id!=='string'||!uuid.test(note.id)||ids.has(note.id))throw Error('约定身份无效');ids.add(note.id);
    if(note.objectId!==null&&(typeof note.objectId!=='string'||!scene.objects.some(o=>o.id===note.objectId)&&!current.notes.some(n=>n.id===note.id&&n.objectId===note.objectId)))throw Error('约定所指对象已不存在，请选择当前世界');
    return {id:note.id,text:text(note.text,CONTEXT_LIMITS.note),objectId:note.objectId};
  });
  return {...clone(current),revision:current.revision+1,brief:text(input.brief,CONTEXT_LIMITS.brief,true),notes};
}
export function rememberAppliedRequest(memory,task,candidate,time=Date.now()){
  if(!task||task.intent!=='execute')return;
  const record={id:task.id,request:task.prompt,summary:candidate.summary,selected:task.context?.selected||null,base:candidate.base,build:candidate.id,time,objects:(candidate.diff.details?.items||[]).filter(i=>i.kind==='object').map(i=>i.id)};
  memory.accepted=[...memory.accepted.filter(r=>r.id!==record.id),record].slice(-CONTEXT_LIMITS.accepted);
}
function terms(value){
  const words=String(value).toLowerCase().match(/[a-z0-9_-]+|[\p{Script=Han}]+/gu)||[],result=new Set();
  for(const word of words){if(/\p{Script=Han}/u.test(word)){for(let i=0;i<word.length-1;i++)result.add(word.slice(i,i+2));if(word.length===1)result.add(word);}else result.add(word);}return result;
}
function score(query,value){const found=terms(value);return [...query].reduce((n,key)=>n+(found.has(key)?1:0),0);}
export function runtimeProblems(build,snapshot){
  return (build?.behaviors||[]).flatMap(artifact=>{
    const definition=artifact.definition,record=snapshot?.behaviors?.modules?.[definition.id];
    if(!record?.error||record.revision!==artifact.id)return [];
    return [{id:definition.id,name:definition.name,revision:record.revision,objects:definition.targets,message:record.error,savedTime:snapshot.behaviors.time,state:clone(record.state)}];
  });
}
export function retrieveProjectContext(memory,{text:selectedText,selected,build,snapshot}){
  const query=terms(selectedText),recent=new Set(memory.accepted.slice(-2).map(r=>r.id));
  const ranked=memory.accepted.map((r,index)=>({r,index,score:score(query,r.request+' '+r.summary)+(selected&&(r.selected===selected||r.objects.includes(selected))?100:0)+(recent.has(r.id)?4:0)}));
  const acceptedChanges=ranked.filter(r=>r.score>0).sort((a,b)=>b.score-a.score||b.index-a.index).slice(0,CONTEXT_LIMITS.retrieved).sort((a,b)=>a.index-b.index).map(({r})=>clone(r));
  // All explicit global agreements fit a fixed 24 x 1000 character budget. Object
  // agreements are included only while that object exists, and retain their scope.
  const notes=memory.notes.filter(n=>!n.objectId||build.scene.objects.some(o=>o.id===n.objectId));
  return {format:'craftmine.context-read/1',revision:memory.revision,brief:memory.brief,notes:clone(notes),acceptedChanges,runtimeProblems:runtimeProblems(build,snapshot),coverage:{retainedRequests:memory.accepted.length,providedRequests:acceptedChanges.length,requestLimit:CONTEXT_LIMITS.accepted}};
}
