import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';

export function validateFeedbackRepairInput(value) {
  assert(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>['description','expected','capture'].includes(key)),'FEEDBACK_REPAIR_INPUT_INVALID');
  assert(typeof value.description==='string'&&value.description.trim()&&value.description.length<=4000&&Buffer.byteLength(value.description)<=16000&&!value.description.includes('\0'),'FEEDBACK_DESCRIPTION_REQUIRED');
  assert(typeof value.expected==='string'&&value.expected.length<=2000&&Buffer.byteLength(value.expected)<=8000&&!value.expected.includes('\0'),'FEEDBACK_EXPECTED_REQUIRED');
  assert(value.capture===undefined||typeof value.capture==='boolean','FEEDBACK_CAPTURE_BOOLEAN_REQUIRED');
  return {description:value.description,expected:value.expected,capture:value.capture??false};
}

/** Driver-only: real existing UI actions. No prompt submission or domain writes. */
export async function prepareProductFeedbackRepair(value,{report,out,evaluate,invoke,nav,assets,submit,field,until}) {
  const input=validateFeedbackRepairInput(value),worldId=report.worldId,sessionId=report.sessionId;
  assert(typeof worldId==='string'&&typeof sessionId==='string','FEEDBACK_CURRENT_WORLD_SESSION_REQUIRED');
  const session=async()=>{const value=await invoke('sessionGet',sessionId);assert(Array.isArray(value.session?.messages),'FEEDBACK_SESSION_REQUIRED');return value.session;};
  const current=async()=>{
    assert.equal((await invoke('agentGetStatus',sessionId)).status.isRunning,false,'FINISH_ACTIVE_TURN_BEFORE_FEEDBACK');
    assert.equal((await nav('world.list')).activeWorldId,worldId,'FEEDBACK_WORLD_CHANGED');
    assert.equal((await nav('world.conversation',{worldId})).sessionId,sessionId,'FEEDBACK_CONVERSATION_CHANGED');
  };
  await current();const beforeMessages=(await session()).messages.map(message=>message.id);
  const previousDraft=await evaluate(`document.querySelector('.composer-input')?.innerText??''`);
  const state=()=>evaluate(`(()=>{const panel=document.querySelector('[data-playtest-panel]'),record=panel?.querySelector('[data-playtest-record]');return {exists:!!panel,error:panel?.querySelector('[role="alert"]')?.textContent??null,busy:panel?.querySelector('[data-playtest-description]')?.disabled??true,confirm:!!panel?.querySelector('[data-playtest-confirm]'),id:record?.dataset.playtestRecord??null,image:record?.querySelector('img')?.getAttribute('src')??null,description:panel?.querySelector('[data-playtest-description]')?.value,expected:panel?.querySelector('[data-playtest-expected]')?.value,capture:panel?.querySelector('[data-playtest-screenshot]')?.checked};})()`);
  const waitForm=async predicate=>{
    // Return terminal UI errors as data, so the operator's generic transient
    // native-error retry loop cannot swallow a completed form failure.
    const result=await until(state,snapshot=>snapshot.error||predicate(snapshot));
    if(result.error)throw Error('FEEDBACK_REPAIR_UI_FAILED: '+result.error);
    return result;
  };
  const open=async()=>{await assets('browse');await until(()=>evaluate(`!!document.querySelector('[data-playtest-panel]')`),Boolean);await evaluate(`document.querySelector('[data-playtest-panel]').open=true;true`);await until(state,snapshot=>snapshot.exists&&!snapshot.busy);};
  await open();await current();
  await evaluate(`(()=>{const button=[...document.querySelectorAll('[data-playtest-panel] button')].find(node=>['取消回复','Cancel reply'].includes(node.textContent));if(button){const props=button[Object.keys(button).find(key=>key.startsWith('__reactProps$'))];if(button.disabled||typeof props?.onClick!=='function')throw Error('FEEDBACK_REPLY_CANCEL_UNAVAILABLE');props.onClick();}return true;})()`);
  await field('[data-playtest-description]',input.description);await field('[data-playtest-expected]',input.expected);await field('[data-playtest-screenshot]',input.capture);
  const preparationRecoveries=[];let preview;
  for(let attempt=0;;attempt++){
    await current();await submit('[data-playtest-create]');
    try{preview=await waitForm(snapshot=>snapshot.confirm&&!snapshot.busy);break;}
    catch(error){
      if(attempt!==0||!input.capture||!String(error).includes('LIBRARY_PREVIEW_PREPARE_REQUIRED'))throw error;
      preparationRecoveries.push({error:String(error),action:'ordinary-close-and-reopen-library'});
      await submit('[data-asset-close-form]');await until(()=>evaluate(`!document.querySelector('[data-asset-sheet]')`),Boolean);await open();
      const retained=await state();assert.deepEqual({description:retained.description,expected:retained.expected,capture:retained.capture},input,'FEEDBACK_REOPEN_LOST_TEXT');
    }
  }
  assert(/^feedback-[a-f0-9]{64}$/.test(preview.id),'FEEDBACK_REVIEW_ID_REQUIRED');
  if(input.capture)assert(preview.image?.startsWith('data:image/png;base64,'),'FEEDBACK_NATIVE_IMAGE_REQUIRED');else assert.equal(preview.image,null);
  await current();await submit('[data-playtest-confirm]');await waitForm(snapshot=>!snapshot.confirm&&!snapshot.busy&&snapshot.id===preview.id);
  const pickerFile=path.join(out,'player-feedback.json'),stat=fs.lstatSync(pickerFile);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=800000,'FEEDBACK_EXPORTED_FILE_REQUIRED');
  const bytes=fs.readFileSync(pickerFile),record=JSON.parse(bytes.toString('utf8'));
  assert.equal(record.id,preview.id);assert.equal(record.context.worldId,worldId);assert.equal(record.description,input.description.trim());assert.equal(record.expected,input.expected.trim());assert.equal(record.replyTo,null);
  if(input.capture)assert.equal('data:image/png;base64,'+record.screenshot.pngBase64,preview.image,'FEEDBACK_EXPORT_CHANGED_REVIEWED_IMAGE');else assert.equal(record.screenshot,null);
  const persisted=await nav('playtest.read',{worldId,id:record.id});assert.deepEqual(persisted,record,'FEEDBACK_EXPORT_RECORD_MISMATCH');
  const archived=path.join(out,'captures','feedback-'+Date.now()+'-'+randomUUID()+'.json');fs.writeFileSync(archived,bytes,{flag:'wx'});
  await current();
  await evaluate(`(()=>{const button=document.querySelector('[data-playtest-repair]');const props=button&&button[Object.keys(button).find(key=>key.startsWith('__reactProps$'))];if(!button||button.disabled||typeof props?.onClick!=='function')throw Error('FEEDBACK_REPAIR_BUTTON_UNAVAILABLE');props.onClick();return true;})()`);
  const handoff=await until(async()=>({ui:await state(),draft:await evaluate(`document.querySelector('.composer-input')?.innerText??''`)}),result=>result.ui.error||result.draft.includes(record.id));
  if(handoff.ui.error)throw Error('FEEDBACK_REPAIR_UI_FAILED: '+handoff.ui.error);
  assert(handoff.draft.includes(record.context.buildId)&&handoff.draft.includes(record.context.worldId),'FEEDBACK_DRAFT_VERSION_IDENTITY_REQUIRED');
  assert(/不可信玩家数据|untrusted player data/.test(handoff.draft),'FEEDBACK_UNTRUSTED_DATA_FRAMING_REQUIRED');
  if(previousDraft.trim())assert(handoff.draft.includes(previousDraft.trim()),'FEEDBACK_REPAIR_OVERWROTE_EXISTING_DRAFT');
  await current();assert.deepEqual((await session()).messages.map(message=>message.id),beforeMessages,'FEEDBACK_REPAIR_MUST_NOT_SEND');
  return {feedbackId:record.id,worldId,sessionId,context:record.context,client:record.client,composerText:handoff.draft,previousDraftPreserved:true,sent:false,
    file:archived,pickerFile,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),screenshotIncluded:input.capture,preparationRecoveries};
}
