import assert from 'node:assert/strict';
import {projectHeadlessAsk} from '../../vendor/pi-desktop/apps/desktop/shared/headless-ask-contract.ts';
export const MAX_PLAYER_CLARIFICATIONS=8;
export function playerClarificationMode(value){
 const mode=value??'off';assert.ok(['off','recommended-or-first','file-response'].includes(mode),'PROMO_CLARIFICATION_MODE_INVALID');return mode;
}
export function choosePlayerClarification(raw,sessionId,mode){
 assert.equal(playerClarificationMode(mode),'recommended-or-first','PROMO_CLARIFICATION_NOT_ENABLED');
 const ask=projectHeadlessAsk(raw,sessionId);assert.ok(ask,'PROMO_CLARIFICATION_MISSING');
 const choices=[],answers=[],selectionReasons=[];
 for(const q of ask.questions){
  assert.ok(q.options.length,'PROMO_CLARIFICATION_REQUIRES_PLAYER');
  const recommended=q.options.findIndex(option=>/(?:（|\()\s*(?:推荐|recommended)|\brecommended\b/i.test(option)&&!/(?:不推荐|not recommended)/i.test(option));
  const index=recommended>=0?recommended:0;
  choices.push([index]);answers.push([q.options[index]]);selectionReasons.push(recommended>=0?'explicit-recommendation':'first-listed-option');
 }
 return {ask,choices,answers,selectionReasons};
}
