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
export function confirmOperatorCreatedWorld({until,readList,readUiError=async()=>null,existingIds,onReadTimeout=()=>{}}){
  if(typeof until!=='function'||typeof readList!=='function'||!(existingIds instanceof Set))throw Error('WORLD_CONFIRMATION_CONFIGURATION');
  return until(async()=>{
    const uiError=await readUiError();if(uiError)throw Error(uiError);
    const state=await readInitializationList(readList,onReadTimeout);if(!state)return null;
    const created=state.worlds.filter(row=>row&&typeof row.id==='string'&&!existingIds.has(row.id));
    if(created.length>1)throw Error('WORLD_CONFIRMATION_MULTIPLE_NEW_WORLDS');
    const failed=created.find(row=>terminalState(row));
    if(failed)throw terminalError(failed);
    return state;
  },state=>!!state?.activeWorldId&&!existingIds.has(state.activeWorldId)&&state.worlds.some(row=>row.id===state.activeWorldId&&row.state==='ready'));
}
