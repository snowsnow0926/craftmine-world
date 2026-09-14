import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import type {UiMessage} from '@pi-desktop/shared';

export type InterruptedRecovery={hostTurnId:string|null;sessionId:string;projectId:string;worldId:string;
  userMessageId:string;tailEndMessageId:string;deferredMessageIds:string[]};
export const RECOVERY_NOTICE='Recovery notice: the complete canonical Rust transcript was hydrated in ordered historical-data segments, using Codex native context compaction where needed. Original player requests and historical images are anchored with their original message IDs. The full visible PI history remains unchanged. Older tool results and captures are historical observations, not current world state. Re-read current host facts and ordinary source/brief tools before acting. No historical tool was executed during restoration.';
function fail():never{throw Object.assign(Error('CODEX_INTERRUPTED_RECOVERY_UNVERIFIED'),{errorCode:'CODEX_INTERRUPTED_RECOVERY_UNVERIFIED'});}
function canonical(value:any):any{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])]));
  return value;
}
const equal=(a:any,b:any)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const cwdKey=(p:string)=>resolve(p.replace(/^\\\\\?\\/,'')).replaceAll('\\','/').toLowerCase();
function image(m:any){
  if(m?.kind!=='image'||!['image/png','image/jpeg'].includes(m.mimeType)||typeof m.data!=='string'||!m.data)fail();
  return {type:'image',url:`data:${m.mimeType};base64,${m.data}`};
}
function compactText(items:any[]){
  const output:any[]=[];
  for(const item of items){
    if(item.type==='assistant'&&output.at(-1)?.type==='assistant')output.at(-1).text+=item.text;
    else output.push(item);
  }
  return output;
}
/** Compare only public API items against Rust's canonical visible last turn.
 * Reasoning is native-owned; it cannot stand in for a missing visible result. */
export function verifyInterruptedTail(metadata:any,page:any,recovery:InterruptedRecovery,history:UiMessage[],threadId:string,cwd:string):string{
  if(!recovery.hostTurnId||metadata?.thread?.id!==threadId||!['idle','notLoaded'].includes(metadata.thread.status?.type)||
    typeof metadata.thread.cwd!=='string'||cwdKey(metadata.thread.cwd)!==cwdKey(cwd)||metadata.thread.modelProvider!=='openai'||
    metadata.thread.model!=='gpt-6-astra'||metadata.thread.reasoningEffort!=='xhigh')fail();
  const turn=page?.data?.[0];
  if(page?.data?.length!==1||!turn?.id||turn.status!=='interrupted'||turn.error||turn.itemsView!=='full'||!Array.isArray(turn.items))fail();
  const start=history.findIndex(m=>m.id===recovery.userMessageId),end=history.findIndex(m=>m.id===recovery.tailEndMessageId);
  if(start<0||end<=start)fail();
  const tail=history.slice(start,end+1),last=tail.at(-1)!;
  if(last.role!=='assistant'||last.status!=='aborted'||last.content!==''||last.error?.code!=='TURN_ABORTED')fail();
  const host:any[]=[];
  for(const m of tail.slice(0,-1)){
    if(m.role==='user'){
      if(host.length||m.status!=='complete')fail();
      host.push({type:'user',input:[{type:'text',text:m.content},...(m.attachments??[]).map(image)]});
    }else if(m.role==='assistant'){
      if(m.status!=='complete'||m.error)fail();host.push({type:'assistant',text:m.content});
    }else if(m.role==='tool'){
      if(!m.toolCallId||!m.toolName||!['complete','error'].includes(m.status??''))fail();
      host.push({type:'tool',id:m.toolCallId,name:m.toolName,args:m.toolArgs,result:m.toolResult,success:m.toolStatus==='success'});
    }else fail();
  }
  const native:any[]=[];
  for(const item of turn.items){
    if(item.type==='reasoning'||item.type==='contextCompaction')continue;
    if(item.type==='userMessage'){
      if(native.length||!Array.isArray(item.content))fail();
      const input=[...item.content];
      // A previously restored turn may carry the fixed restoration notice.
      if(input[0]?.type==='text'&&input[0].text===RECOVERY_NOTICE)input.shift();
      const first=input.shift();
      if(first?.type!=='text'||!first.text.startsWith('Current authoritative host facts: '))fail();
      let facts:any;try{facts=JSON.parse(first.text.slice('Current authoritative host facts: '.length));}catch{fail();}
      if(facts.world?.id!==recovery.worldId||facts.binding?.sessionId!==recovery.sessionId||
        facts.binding?.projectId!==recovery.projectId||facts.binding?.turnId!==recovery.hostTurnId)fail();
      native.push({type:'user',input:input.map((i:any)=>i.type==='text'?{type:'text',text:i.text}:i.type==='image'?{type:'image',url:i.url}:fail())});
    }else if(item.type==='agentMessage')native.push({type:'assistant',text:item.text});
    else if(item.type==='dynamicToolCall'){
      if(item.namespace!=='craftmine'||!['completed','failed'].includes(item.status)||typeof item.success!=='boolean'||!Array.isArray(item.contentItems))fail();
      const [text,...images]=item.contentItems;
      if(text?.type!=='inputText'||images.some((i:any)=>i.type!=='inputImage'))fail();
      let result:any;try{result=JSON.parse(text.text);}catch{fail();}
      if(images.length){
        if(!result||typeof result!=='object'||Array.isArray(result))fail();
        result.images=images.map((i:any)=>{
          const match=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(i.imageUrl??'');
          if(!match)fail();return {mimeType:match[1],data:match[2]};
        });
      }
      native.push({type:'tool',id:'codex-'+hash([recovery.hostTurnId,item.id]),name:'plugin_craftmine_world_'+item.tool,
        args:item.arguments,result,success:item.success});
    }else fail();
  }
  if(!equal(compactText(host),compactText(native)))fail();
  // The second read after resume must retain this exact terminal/tail identity.
  return hash(canonical({id:turn.id,status:turn.status,items:compactText(native)}));
}
