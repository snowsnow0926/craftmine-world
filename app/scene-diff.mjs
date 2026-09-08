import { canonicalJSON } from './canonical.mjs';
const clone=value=>structuredClone(value);

export function upgradeScene(input) {
  if(['craftmine.scene/2','craftmine.scene/3','craftmine.scene/4'].includes(input.format))return clone(input);
  return {format:'craftmine.scene/2',title:input.title,night:input.night,objects:input.objects.map(o=>({...clone(o),source:null,components:{health:0,contactDamage:0},parts:o.parts.map(p=>({...clone(p),shape:'box',color:p.material==='leaves'?'#9cdc5e':'#ffffff',solid:true}))})),systems:[]};
}
export function withAppearanceFormat(input){const scene=clone(input);if(scene.format==='craftmine.scene/4'||scene.objects.some(o=>o.appearance)){scene.format='craftmine.scene/4';scene.behaviors??=[];scene.objects=scene.objects.map(o=>({...o,appearance:o.appearance||null}));}return scene;}
export function sceneDiff(before, after) {
  before=upgradeScene(before);after=upgradeScene(after);
  for(const scene of [before,after])scene.objects=scene.objects.map(o=>({...o,appearance:o.appearance||null}));
  const old = new Map(before.objects.map(o => [o.id, o])), next = new Map(after.objects.map(o => [o.id, o]));
  return {
    added: after.objects.filter(o => !old.has(o.id)).map(o => o.name),
    changed: after.objects.filter(o => old.has(o.id) && canonicalJSON(old.get(o.id)) !== canonicalJSON(o)).map(o => o.name),
    removed: before.objects.filter(o => !next.has(o.id)).map(o => o.name),
    environment: before.night !== after.night,
    systems: { added:after.systems.filter(s=>!before.systems.some(p=>p.id===s.id)).map(s=>s.name), changed:after.systems.filter(s=>before.systems.some(p=>p.id===s.id&&canonicalJSON(p)!==canonicalJSON(s))).map(s=>s.name), removed:before.systems.filter(s=>!after.systems.some(p=>p.id===s.id)).map(s=>s.name) },
    behaviors: {added:(after.behaviors||[]).filter(s=>!(before.behaviors||[]).some(p=>p.id===s.id)).map(s=>s.name),changed:(after.behaviors||[]).filter(s=>(before.behaviors||[]).some(p=>p.id===s.id&&canonicalJSON(p)!==canonicalJSON(s))).map(s=>s.name),removed:(before.behaviors||[]).filter(s=>!(after.behaviors||[]).some(p=>p.id===s.id)).map(s=>s.name)},
    details:changeDetails(before,after),
  };
}

export const FIELD_LABELS={name:'名称',title:'世界名称',night:'昼夜',position:'位置',appearance:'素材外观与固定版本',parts:'外观与碰撞',components:'生命值与接触伤害',source:'来源版本',type:'玩法类型',config:'玩法参数',description:'规则说明',code:'玩法源码',params:'代码参数',stateVersion:'状态格式',initialState:'新实例初始进度',targets:'关联对象',permissions:'作用范围',requires:'依赖',binding:'实例关系',format:'定义格式'};
export function changeDetails(before,after){
  const items=[];
  for(const [kind,key]of [['object','objects'],['system','systems'],['behavior','behaviors']]){
    const a=new Map((before[key]||[]).map(o=>[o.id,o])),b=new Map((after[key]||[]).map(o=>[o.id,o]));
    for(const id of new Set([...b.keys(),...a.keys()])){
      const old=a.get(id),next=b.get(id),fields=[...new Set([...Object.keys(old||{}),...Object.keys(next||{})])].filter(k=>k!=='id'&&canonicalJSON(old?.[k])!==canonicalJSON(next?.[k]));
      if(fields.length)items.push({kind,id,name:next?.name||old.name,beforeName:old?.name||null,change:!old?'added':!next?'removed':'changed',fields});
    }
  }
  const fields=['title','night'].filter(k=>before[k]!==after[k]);if(fields.length)items.push({kind:'world',id:'world',name:'世界设置',change:'changed',fields});
  return {format:'craftmine.diff/1',items};
}
export function reviewEntities(data,item){
  const entity=build=>{const scene=upgradeScene(build.scene);return item.kind==='world'?scene:scene[{object:'objects',system:'systems',behavior:'behaviors'}[item.kind]]?.find(o=>o.id===item.id);};
  return {before:entity(data.before),after:entity(data.after)};
}
// Compact unchanged context while keeping every changed line, including long one-line modules.
export function diffLines(before='',after=''){
  const a=before.split('\n'),b=after.split('\n');let first=0,last=0;
  while(first<a.length&&first<b.length&&a[first]===b[first])first++;
  while(last<a.length-first&&last<b.length-first&&a[a.length-1-last]===b[b.length-1-last])last++;
  const rows=[];if(first>2)rows.push({type:'context',text:`… ${first-2} 行未变 …`});
  for(const text of a.slice(Math.max(0,first-2),first))rows.push({type:'context',text});
  for(const text of a.slice(first,a.length-last))rows.push({type:'removed',text});
  for(const text of b.slice(first,b.length-last))rows.push({type:'added',text});
  for(const text of b.slice(b.length-last,b.length-last+Math.min(last,2)))rows.push({type:'context',text});
  if(last>2)rows.push({type:'context',text:`… ${last-2} 行未变 …`});return rows;
}
