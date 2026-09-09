import {memoryRecord} from '../../app/harness/memory-records.mjs';

export function createMemoryService({call}) {
  if(typeof call!=='function')throw Error('DOMAIN_CALL_REQUIRED');
  return {
    search:args=>call('memory.search',args),
    async propose({context,operationId,record}) {
      const {format,...input}=record;
      if(format!==undefined&&format!=='craftmine.memory/1')throw Error('INVALID_MEMORY_FORMAT');
      if(record.status&&record.status!=='proposed')throw Error('MODEL_CANNOT_VALIDATE_MEMORY');
      const checked=memoryRecord({...input,status:'proposed'});
      return call('memory.propose',{context,operationId,record:{...checked,scope:{...checked.scope,...(record.scope.worldId?{worldId:record.scope.worldId}:{})}}});
    },
    retire:args=>call('memory.retire',args),
  };
}
