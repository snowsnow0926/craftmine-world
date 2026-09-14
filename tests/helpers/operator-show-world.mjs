import assert from 'node:assert/strict';
export function showWorldTabScript(worldId,activate=false){
  assert(typeof worldId==='string'&&worldId.length>0,'SHOW_WORLD_ID_REQUIRED');
  return `(()=>{
    if(!globalThis.__craftmineHeadless||document.body.dataset.worldId!==${JSON.stringify(worldId)})throw Error('SHOW_WORLD_IDENTITY_CHANGED');
    const button=document.getElementById('world-mode'),workbench=document.getElementById('workbench-panel'),checks=document.getElementById('checks-panel'),error=document.getElementById('error');
    const visible=!!button&&button.getClientRects().length>0&&getComputedStyle(button).visibility!=='hidden';
    ${activate?`if(!button||button.disabled||!visible||typeof button.onclick!=='function')throw Error('SHOW_WORLD_TAB_UNAVAILABLE');button.onclick();`:''}
    return {worldId:document.body.dataset.worldId,worldTabSelected:button?.getAttribute('aria-selected')==='true',tabVisible:visible,tabDisabled:button?.disabled??true,workbenchHidden:workbench?.hidden??false,checksHidden:checks?.hidden??false,error:error&&!error.hidden?error.textContent:null};
  })()`;
}
export function assertShowWorldIdentity(before,after,sessionBefore,sessionAfter){
  for(const key of ['worldId','buildId','instanceId'])assert.equal(after?.[key],before?.[key],'SHOW_WORLD_RUNTIME_IDENTITY_CHANGED');
  assert(typeof sessionBefore==='string'&&sessionBefore.length>0,'SHOW_WORLD_SESSION_REQUIRED');assert.equal(sessionAfter,sessionBefore,'SHOW_WORLD_SESSION_CHANGED');
}
