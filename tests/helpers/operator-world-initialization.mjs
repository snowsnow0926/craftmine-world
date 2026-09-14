import {isTransientReadTimeout,terminalState} from '../player-feedback/P8/initialization-poll.mjs';

const terminalError=row=>Object.assign(Error('WORLD_INITIALIZATION_TERMINAL:'+JSON.stringify({worldId:row.id,state:row.state,creation:row.creation??null})),{code:'WORLD_INITIALIZATION_TERMINAL'});
async function readInitializationList(readList,onReadTimeout){
  let state;
  try{state=await readList();}
  catch(error){if(!isTransientReadTimeout(error))throw error;onReadTimeout(error);return null;}
  if(!state||!Array.isArray(state.worlds))throw Error('WORLD_CONFIRMATION_INVALID_LIST');
  return state;
}

// A retained cancelled/failed world may have no runtime at all. Inspect its
// durable row before polling runtime readiness; retry initialization is an
// explicit ordinary UI action for the operator, never a side effect here.
export async function readOperatorInitializingRuntime({readList,observe,worldId,onReadTimeout=()=>{}}){
  const state=await readInitializationList(readList,onReadTimeout);if(!state)return null;
  const row=state.worlds.find(row=>row?.id===worldId);
  if(!row)throw Error('WORLD_CONFIRMATION_TARGET_MISSING');
  if(terminalState(row))throw terminalError(row);
  if(state.activeWorldId!==worldId)throw Error('WORLD_CONFIRMATION_SELECTION_CHANGED');
  return observe();
}

// Confirmation only: creation was already submitted through the ordinary UI.
// Reuse P8's exact read-error classification, but keep the operator's existing
// cancellation/desktop-exit lifecycle instead of importing P8's test deadline.
export function confirmOperatorCreatedWorld({until,readList,readUiError=async()=>null,existingIds,baseId,onReadTimeout=()=>{},onAdditionalWorlds=()=>{}}){
  if(typeof until!=='function'||typeof readList!=='function'||!(existingIds instanceof Set)||typeof baseId!=='string'||!baseId)throw Error('WORLD_CONFIRMATION_CONFIGURATION');
  return until(async()=>{
    const uiError=await readUiError();if(uiError)throw Error(uiError);
    const state=await readInitializationList(readList,onReadTimeout);if(!state)return null;
    const added=state.worlds.filter(row=>row&&typeof row.id==='string'&&!existingIds.has(row.id));
    // First attachment may lazily create the product's default legacy world.
    // Preserve that observation, but only Godot rows can satisfy this request.
    const legacy=added.filter(row=>row.runtimeKind==='legacy');
    if(legacy.length)onAdditionalWorlds(legacy.map(row=>({id:row.id,title:row.title,runtimeKind:row.runtimeKind,baseId:row.baseId??null})));
    if(added.some(row=>!['legacy','godot'].includes(row.runtimeKind)))throw Error('WORLD_CONFIRMATION_RUNTIME_UNKNOWN');
    const created=added.filter(row=>row.runtimeKind==='godot');
    if(created.length>1)throw Error('WORLD_CONFIRMATION_MULTIPLE_NEW_WORLDS');
    if(created.some(row=>row.baseId!==baseId))throw Error('WORLD_CONFIRMATION_BASE_MISMATCH');
    const failed=created.find(row=>terminalState(row));
    if(failed)throw terminalError(failed);
    return state;
  },state=>!!state?.activeWorldId&&!existingIds.has(state.activeWorldId)&&state.worlds.some(row=>row.id===state.activeWorldId&&row.runtimeKind==='godot'&&row.baseId===baseId&&row.state==='ready'));
}
