import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Private, owned renderer only. Invoke the installed New Task React callback;
// never dispatch input events, create a session through IPC, or submit a prompt.
export function newConversationUiScript(expectedSessionId, submit=false) {
  return `(()=>{
    if(!globalThis.__craftmineHeadless)throw Error('NEW_CONVERSATION_OWNED_PAGE_REQUIRED');
    const sessionId=document.querySelector('[data-world-session]')?.dataset.worldSession??null;
    const composer=document.querySelector('.composer-input');
    const buttons=[...document.querySelectorAll('.conversation-topbar button')].filter(button=>['new task','新建任务','新建任務'].includes((button.getAttribute('aria-label')??'').toLowerCase()));
    const button=buttons[0],visible=buttons.length===1&&button.getClientRects().length>0&&getComputedStyle(button).visibility!=='hidden'&&!button.closest('[inert], [aria-hidden="true"]');
    const props=button&&button[Object.keys(button).find(key=>key.startsWith('__reactProps$'))];
    const state={sessionId,composerText:composer?.innerText??null,buttonCount:buttons.length,ready:!!visible&&!button.disabled&&typeof props?.onClick==='function'};
    ${submit?`if(sessionId!==${JSON.stringify(expectedSessionId)})throw Error('NEW_CONVERSATION_UI_SESSION_CHANGED');
    if(!state.ready)throw Error('NEW_CONVERSATION_BUTTON_UNAVAILABLE');
    if(state.composerText===null||state.composerText.trim())throw Error('NEW_CONVERSATION_EMPTY_COMPOSER_REQUIRED');
    props.onClick();state.dispatched=true;`:''}
    return state;
  })()`;
}

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function conversationMessages(session) {
  assert(Array.isArray(session?.messages),'NEW_CONVERSATION_MESSAGES_REQUIRED');
  const ids=session.messages.map(message=>message.id);
  assert(ids.every(id=>typeof id==='string'&&id.length>0)&&new Set(ids).size===ids.length,'NEW_CONVERSATION_MESSAGE_IDS_REQUIRED');
  return {ids,sha256:digest(session.messages)};
}
export function assertConversationPreservation(before,after) {
  for(const key of ['worldId','buildId','instanceId']) {
    assert(typeof before.runtime?.[key]==='string'&&before.runtime[key].length>0,'NEW_CONVERSATION_RUNTIME_IDENTITY_REQUIRED');
    assert.equal(after.runtime?.[key],before.runtime[key],'NEW_CONVERSATION_RUNTIME_CHANGED');
  }
  assert.equal(before.saved?.id,before.runtime.worldId,'NEW_CONVERSATION_SAVED_WORLD_REQUIRED');
  assert(/^[a-f0-9]{64}$/.test(before.saved?.contentHash),'NEW_CONVERSATION_SAVED_HASH_REQUIRED');
  for(const key of ['id','title','contentHash'])assert.deepEqual(after.saved?.[key],before.saved[key],'NEW_CONVERSATION_SAVED_STATE_CHANGED');
  assert.deepEqual(after.oldMessages,before.oldMessages,'NEW_CONVERSATION_OLD_HISTORY_CHANGED');
}

/** Only navigation. Preserve partial evidence if selection/config validation fails. */
export async function prepareOperatorNewConversation(input,{report,readUi,submit,until,readSession,readState,assertIdle,assertModel,persist}) {
  assert(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===0,'NEW_CONVERSATION_TAKES_NO_OVERRIDES');
  const oldSessionId=report.sessionId,worldId=report.worldId;
  assert(typeof oldSessionId==='string'&&typeof worldId==='string','NEW_CONVERSATION_CONTEXT_REQUIRED');
  assert(!report.pendingConversation,'NEW_CONVERSATION_PREVIOUS_HANDOFF_PENDING');
  await assertIdle(oldSessionId);await assertModel(oldSessionId);
  const ui=await readUi();assert.equal(ui.sessionId,oldSessionId,'NEW_CONVERSATION_UI_SESSION_CHANGED');
  assert(ui.ready&&ui.composerText!==null&&!ui.composerText.trim(),'NEW_CONVERSATION_EMPTY_READY_UI_REQUIRED');
  const old=await readSession(oldSessionId),before={...await readState(),oldMessages:conversationMessages(old)};
  assert.equal(before.runtime.worldId,worldId,'NEW_CONVERSATION_WORLD_CHANGED');
  const evidence={format:'craftmine.operator-new-conversation/1',worldId,oldSessionId,oldProjectPath:old.projectPath??null,startedAt:new Date().toISOString(),submission:'ordinary-PI-New-Task-React-handler',before,sent:false,bindingStatus:'not-established',status:'preparing'};
  report.conversationTransitions??=[];report.conversationTransitions.push(evidence);report.pendingConversation=evidence;await persist();
  try {
    await assertIdle(oldSessionId);
    evidence.dispatchAttempted=true;await persist();
    evidence.dispatch=await submit(oldSessionId);
    const selected=await until(readUi,state=>!!state.sessionId&&state.sessionId!==oldSessionId);
    evidence.newSessionId=selected.sessionId;
    // Attribute every prior turn before changing the report's current session.
    for(const turn of report.turns){turn.worldId??=worldId;turn.sessionId??=oldSessionId;}
    report.sessionId=selected.sessionId;await persist();
    const session=await readSession(selected.sessionId);
    assert.equal(session.id,selected.sessionId,'NEW_CONVERSATION_SESSION_CHANGED');
    assert.equal(session.projectPath??null,evidence.oldProjectPath,'NEW_CONVERSATION_PROJECT_CHANGED');
    assert.equal(conversationMessages(session).ids.length,0,'NEW_CONVERSATION_EMPTY_SESSION_REQUIRED');
    assert(selected.composerText!==null&&!selected.composerText.trim(),'NEW_CONVERSATION_NEW_DRAFT_NOT_EMPTY');
    await assertIdle(oldSessionId);await assertIdle(selected.sessionId);
    evidence.after={...await readState(),oldMessages:conversationMessages(await readSession(oldSessionId))};
    assertConversationPreservation(before,evidence.after);
    evidence.configuration=await assertModel(selected.sessionId);
    assert.equal((await readUi()).sessionId,selected.sessionId,'NEW_CONVERSATION_UI_SESSION_CHANGED');
    evidence.status='ready-unsent';evidence.finishedAt=new Date().toISOString();await persist();return evidence;
  } catch(error) {
    // A delayed renderer selection can succeed even if its acknowledgement
    // failed. Report that actual selection without claiming readiness.
    try {
      const selected=await readUi();
      if(selected.sessionId&&selected.sessionId!==oldSessionId){
        evidence.newSessionId=selected.sessionId;
        for(const turn of report.turns){turn.worldId??=worldId;turn.sessionId??=oldSessionId;}
        report.sessionId=selected.sessionId;
      }
    }catch(readError){evidence.selectionReadError=String(readError);}
    evidence.status='failed-unsent';evidence.error=String(error.stack??error);await persist();throw error;
  }
}

// Revalidation after a player changes ordinary model settings is read-only.
// Keep the original failure; never create a second chat or repair settings.
export async function recheckOperatorNewConversation({report,readUi,readSession,readState,assertIdle,assertModel,persist}) {
  const evidence=report.pendingConversation;if(!evidence)return;
  assert(['ready-unsent','failed-unsent'].includes(evidence.status),'NEW_CONVERSATION_HANDOFF_UNCONFIRMED');
  const ui=await readUi();
  assert(evidence.newSessionId&&ui.sessionId===evidence.newSessionId&&report.sessionId===evidence.newSessionId,'NEW_CONVERSATION_UI_SESSION_CHANGED');
  assert.equal(report.worldId,evidence.worldId,'NEW_CONVERSATION_WORLD_CHANGED');
  await assertIdle(evidence.oldSessionId);await assertIdle(evidence.newSessionId);
  const session=await readSession(evidence.newSessionId);
  assert.equal(session.projectPath??null,evidence.oldProjectPath,'NEW_CONVERSATION_PROJECT_CHANGED');
  assert.equal(conversationMessages(session).ids.length,0,'NEW_CONVERSATION_EMPTY_SESSION_REQUIRED');
  const after={...await readState(),oldMessages:conversationMessages(await readSession(evidence.oldSessionId))};
  assertConversationPreservation(evidence.before,after);
  const configuration=await assertModel(evidence.newSessionId);
  evidence.rechecks??=[];evidence.rechecks.push({at:new Date().toISOString(),after,configuration});
  evidence.status='ready-unsent';await persist();
}

/** Run only after the first ordinary prompt has actually been accepted. */
export function confirmNewConversationBinding(evidence,{session,turnId,conversation,task}) {
  assert(['ready-unsent','accepted-binding-unconfirmed'].includes(evidence?.status),'NEW_CONVERSATION_NOT_READY');
  assert(evidence.sent===true&&evidence.firstTurnId===turnId&&typeof evidence.firstMessageId==='string','NEW_CONVERSATION_ACCEPTED_PROMPT_REQUIRED');
  assert.equal(session?.id,evidence.newSessionId,'NEW_CONVERSATION_SESSION_CHANGED');
  assert.equal(session.projectPath??null,evidence.oldProjectPath,'NEW_CONVERSATION_PROJECT_CHANGED');
  const projectId='pi-'+digest(session.projectPath?['project',session.projectPath]:['session',session.id]);
  const context=task?.context??(task?.binding?task:null),binding=context?.binding;
  assert.equal(conversation?.worldId,evidence.worldId,'NEW_CONVERSATION_BOUND_WORLD_CHANGED');
  assert.equal(conversation?.sessionId,session.id,'NEW_CONVERSATION_BOUND_SESSION_CHANGED');
  assert(typeof conversation.taskId==='string'&&conversation.taskId.length>0,'NEW_CONVERSATION_DURABLE_TASK_REQUIRED');
  assert.equal(context?.world?.id,evidence.worldId,'NEW_CONVERSATION_TASK_WORLD_CHANGED');
  assert.equal(binding?.sessionId,session.id,'NEW_CONVERSATION_TASK_SESSION_CHANGED');
  assert.equal(binding?.projectId,projectId,'NEW_CONVERSATION_TASK_PROJECT_CHANGED');
  assert.equal(binding?.taskId,conversation.taskId,'NEW_CONVERSATION_TASK_CHANGED');
  assert.equal(binding?.turnId,turnId,'NEW_CONVERSATION_TASK_TURN_CHANGED');
  return {worldId:evidence.worldId,sessionId:session.id,projectId,taskId:binding.taskId,turnId,bindingStatus:'confirmed-after-first-prompt'};
}
