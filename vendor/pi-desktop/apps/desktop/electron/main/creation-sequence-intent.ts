import {CREATION_WISH_COLORS} from './creation-wish-intent.ts';
type Entity={id:string;kind:string;color?:string;parameters?:{label?:unknown}};
type Capture={target:{entityId:string|null};entities?:Entity[]};
/** Finite, whole-sentence sequence requests. Labels are data, never code or
 * instructions. Ambiguity is retained instead of choosing the first object. */
export function resolveCreationSequenceIntent(input:string,capture:Capture):{doorId:string;steps:string[]}|null{
 if(typeof input!=='string'||input.length>512||!Array.isArray(capture.entities)||capture.entities.length>256)return null;
 if(capture.entities.some(e=>!e||typeof e.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(e.id)||typeof e.kind!=='string'||e.color!==undefined&&typeof e.color!=='string')||new Set(capture.entities.map(e=>e.id)).size!==capture.entities.length)return null;
 const text=input.trim().replace(/[。！!]$/,'').replace(/^请/,'').replace(/，(?:其他东西保持原样|保留已有内容和进度)$/,'');
 let list:string|undefined,door:string|undefined;
 const direct=/^依次(?:触碰|触发|按下)(.+?)后(?:才能)?打开(.+)$/.exec(text);
 const ordered=/^(?:按照|按)(.+?)的顺序(?:触碰|触发|按下)(?:这些|这几个)?(?:机关|标记)[，,]?(?:然后|之后|再|后)(?:才能)?打开(.+)$/.exec(text);
 const attached=/^把(这扇门|这道门|这个门)设为依次(?:触碰|触发|按下)(.+?)后才能打开$/.exec(text);
 if(direct||ordered){const m=(direct??ordered)!;list=m[1];door=m[2];}
 else if(attached){door=attached[1];list=attached[2];}else return null;
 const tokens=list.split('、').map(s=>s.trim());
 if(tokens.length<2||tokens.length>8||tokens.some(s=>!s||s.length>80))return null;
 const resolve=(ref:string,kind:string):string|null=>{
  ref=ref.trim();if(!ref||ref.length>128)return null;
  const aliases=new Set<string>();
  const noun=kind==='door'?'(?:门|门扇)':'(?:机关|标记|按钮)';
  const paint=new RegExp('^([红橙黄绿蓝紫黑白灰])色?(?:的)?'+noun+'?$').exec(ref);
  const wantedColor=paint?CREATION_WISH_COLORS[paint[1]]:null;
  for(const entity of capture.entities!){
   if(entity.kind!==kind)continue;
   const selected=kind==='door'&&['这扇门','这道门','这个门'].includes(ref)&&entity.id===capture.target.entityId;
   const label=entity.parameters?.label;
   if(entity.id===ref||selected||(kind==='marker'&&typeof label==='string'&&label.trim()===ref)||(wantedColor&&entity.color?.toLowerCase()===wantedColor))aliases.add(entity.id);
  }
  return aliases.size===1?[...aliases][0]:null;
 };
 const doorId=resolve(door,'door'),steps=tokens.map(token=>resolve(token,'marker'));
 if(!doorId||steps.some(s=>s===null)||new Set(steps).size!==steps.length)return null;
 return {doorId,steps:steps as string[]};
}
