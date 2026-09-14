import assert from 'node:assert/strict';

export const blankGodotUiState=`(()=>{
  const base=document.querySelector('[data-world-base-option="creation-sandbox"] input'),starter=document.querySelector('[data-world-starter-option="blank"] input'),button=document.querySelector('[data-world-create="submit"]');
  return {formPresent:!!document.querySelector('[data-world-create="form"]'),basePresent:!!base,baseDisabled:!!base?.disabled,baseSelected:!!base?.checked,blankPresent:!!starter,blankSelected:!!starter?.checked,title:document.querySelector('[data-world-create="name"]')?.value??'',submitReady:!!button&&!button.disabled,error:document.querySelector('[data-world-create="validation"]')?.textContent||document.querySelector('[data-world-entry-error]')?.textContent||null};
})()`;

// Only ordinary current chooser/form operations; no direct world creation RPC.
export async function createOperatorBlankGodot({read,field,submit,until},title){
  assert(typeof title==='string'&&title.trim(),'BLANK_WORLD_TITLE_REQUIRED');
  const initial=await read();if(initial.error)throw Error(initial.error);
  assert(initial.formPresent&&initial.basePresent&&initial.blankPresent&&!initial.baseDisabled,'BLANK_GODOT_FORM_UNAVAILABLE');
  await field('[data-world-base-option="creation-sandbox"] input',true);
  await field('[data-world-starter-option="blank"] input',true);
  await field('[data-world-create="name"]',title);
  const selected=await until(async()=>{const state=await read();if(state.error)throw Error(state.error);return state;},state=>state.baseSelected&&state.blankSelected&&state.title===title&&state.submitReady);
  await submit('[data-world-create="form"]');
  return {mode:'ordinary-new-world-form',baseId:'creation-sandbox',starter:'blank',title,selected,sentModelPrompt:false};
}
