import type {CreationEntity} from './creation-check-requirements';

export type RecentCreationResult = {entityId:string;entityName:string;entityKind:string;operationId:string;available:boolean;reason?:string};
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9._-]{1,128}$/.test(value);
const names:Record<string,string>={tree:'树',rock:'石头',chest:'宝箱',door:'门',marker:'标记'};
const vector=(value:unknown)=>Array.isArray(value)&&value.length===3&&value.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=100000);

/** The caller supplies the immutable formal journal, never a draft or model reply. */
export function recentCreationResults(worldId:string,journal:any,entities:CreationEntity[]|undefined):RecentCreationResult[]{
  if(journal===null||journal===undefined)return [];
  if(journal.format!=='craftmine.creation-operations/1'||!Array.isArray(journal.operations)||journal.operations.length>4096)throw Error('CREATION_FORMAL_JOURNAL_INVALID');
  const results:RecentCreationResult[]=[],seen=new Set<string>();
  for(const entry of [...journal.operations].reverse()){
    const receipt=entry?.receipt;
    if(!receipt||receipt.worldId!==worldId)continue;
    if(!identifier(entry.operationId)||receipt.operationId!==entry.operationId||!Array.isArray(receipt.createdIds)||!Array.isArray(receipt.affectedIds)||[...receipt.createdIds,...receipt.affectedIds].some(value=>!identifier(value)))throw Error('CREATION_FORMAL_JOURNAL_INVALID');
    for(const entityId of [...receipt.createdIds,...receipt.affectedIds]){
      if(seen.has(entityId))continue;seen.add(entityId);
      const matches=entities?.filter(entity=>entity.id===entityId)??[],entity=matches.length===1?matches[0]:undefined;
      const before=entry.inverse?.before,after=entry.inverse?.after;
      const historical=[...(Array.isArray(after)?after:[]),...(Array.isArray(before)?before:[])].find(item=>item?.id===entityId);
      const kind=entity?.kind??historical?.kind;
      const label=kind==='marker'?(entity as any)?.parameters?.label:undefined;
      const entityName=typeof label==='string'&&label.length>0&&label.length<=80&&!/[\x00-\x1f]/.test(label)?label:names[kind]??'对象';
      const reason=!entity?'CREATION_RECENT_REMOVED':entity.visible!==true?'CREATION_RECENT_HIDDEN':!Object.hasOwn(names,kind)||!vector(entity.position)||!vector(entity.scale)?'CREATION_RECENT_UNAVAILABLE':undefined;
      results.push({entityId,entityName,entityKind:kind??'unknown',operationId:entry.operationId,available:reason===undefined,...(reason?{reason}:{})});
      if(results.length===32)return results;
    }
  }
  return results;
}
