import assert from 'node:assert/strict';
import {isTransientReadTimeout} from '../player-feedback/P8/initialization-poll.mjs';

export const worldSessionReadScript=`(()=>({sessionId:document.querySelector('[data-world-session]')?.dataset.worldSession??null,
  restoring:!!document.querySelector('[data-world-conversation-restoring]'),
  startReady:!!document.querySelector('[data-world-start-creation] button:not(:disabled)'),
  error:document.querySelector('[data-world-conversation-error]')?.textContent||document.querySelector('[data-world-entry-error]')?.textContent||null}))()`;

// World runtime readiness can precede React's conversation selection. A DOM
// session alone is never evidence that this conversation owns the new world.
export async function confirmOperatorWorldSession({worldId,expectedSessionId,excludedSessionId,until,readUi,readBinding,startCreation,onReadTimeout=()=>{}}){
  assert(typeof worldId==='string'&&worldId,'WORLD_SESSION_TARGET_REQUIRED');
  let started=false;
  return until(async()=>{
    const ui=await readUi();if(ui.error)throw Error(ui.error);
    let binding;
    try{binding=await readBinding(worldId,expectedSessionId);}
    catch(error){if(!isTransientReadTimeout(error))throw error;onReadTimeout(error);return null;}
    assert.equal(binding?.worldId,worldId,'WORLD_SESSION_BOUND_WORLD_CHANGED');
    if(binding.sessionId){
      assert.notEqual(binding.sessionId,excludedSessionId,'TEMPLATE_COPY_REQUIRES_INDEPENDENT_SESSION');
      if(expectedSessionId)assert.equal(binding.sessionId,expectedSessionId,'COLD_REOPEN_SESSION_CHANGED');
      if(ui.sessionId!==binding.sessionId||ui.restoring)return null;
      // Recheck after the asynchronous host read; do not accept a selection
      // that disappeared while its binding was being resolved.
      const current=await readUi();if(current.error)throw Error(current.error);
      if(current.restoring||current.sessionId!==binding.sessionId)return null;
      return {worldId,sessionId:binding.sessionId,binding,confirmation:'host-world-conversation-and-current-ui'};
    }
    if(!started&&!ui.sessionId&&!ui.restoring&&ui.startReady){started=true;await startCreation();}
    return null;
  },Boolean);
}

// An interrupted template-copy acknowledgement can retain the old session in
// its report even though the product later created the correct empty one.
// Recover only that exact already-created world; never submit another copy.
export function operatorWorldSessionExpectation(report){
  const copy=report.lastTemplateCopy;
  const pending=copy?.newWorldId===report.worldId&&copy.oldWorldId!==report.worldId&&!copy.newSessionId;
  return {expectedSessionId:pending&&report.sessionId===copy.oldSessionId?undefined:report.sessionId,
    excludedSessionId:copy?.newWorldId===report.worldId?copy.oldSessionId:undefined,pendingCopy:pending};
}
