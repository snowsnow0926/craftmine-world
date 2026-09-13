import test from 'node:test';
import assert from 'node:assert/strict';
import {publishOperatorTemplate} from './helpers/product-agent-publication.mjs';
import {PRODUCT_AGENT_COMMANDS} from './helpers/product-agent-mailbox.mjs';

function fixture({oldId,stale=false,wrongWorld=false}={}){
  let state={worldId:wrongWorld?'other':'world-one',id:oldId,hasForm:!oldId,formReady:!oldId,checkpoint:false};
  const log=[];
  return {log,assets:async tab=>log.push(['assets',tab]),read:async()=>({...state}),
    continuePublication:async()=>{log.push(['continue']);state={...state,id:undefined,hasForm:true,formReady:true};},
    field:async(selector,value)=>{log.push(['field',selector,value]);if(selector==='[data-publication-checkpoint]')state.checkpoint=value;},
    submit:async selector=>{log.push(['submit',selector]);assert(!state.id&&state.hasForm);state=state.checkpoint?{...state,id:stale?oldId:'player.world.new',hasForm:false,formReady:false}:{...state,error:'Choose the saved progress as the starting state first.'};},
    // Bounded unit-test polling; this is not a live model/turn limit.
    until:async(read,accept)=>{for(let i=0;i<10;i++){const value=await read();if(accept(value))return value;}throw Error('TEST_UI_DID_NOT_ADVANCE');},
  };
}
test('publication keeps saved progress enabled by default through the actual checkbox adapter',async()=>{
  const ui=fixture(),result=await publishOperatorTemplate(ui,{name:'已完成飞行'},'world-one');
  assert.equal(result.includeSavedProgress,true);assert.equal(result.assetId,'player.world.new');
  assert(ui.log.some(row=>row[0]==='field'&&row[1]==='[data-publication-checkpoint]'&&row[2]===true));
});
test('second publication clears old result through continue action before a new form submission',async()=>{
  const ui=fixture({oldId:'player.world.old'});
  const result=await publishOperatorTemplate(ui,{},'world-one');assert.equal(result.assetId,'player.world.new');
  assert(ui.log.findIndex(row=>row[0]==='continue')<ui.log.findIndex(row=>row[0]==='submit'));
});
test('old result replay and wrong world never produce a successful publication receipt',async()=>{
  await assert.rejects(publishOperatorTemplate(fixture({oldId:'player.world.old',stale:true}),{},'world-one'),/PUBLICATION_STALE_RESULT/);
  await assert.rejects(publishOperatorTemplate(fixture({wrongWorld:true}),{},'world-one'),/PUBLICATION_WORLD_MISMATCH/);
});
test('false is sent to the checkbox and current product rejection remains an error',async()=>{
  const ui=fixture();await assert.rejects(publishOperatorTemplate(ui,{includeSavedProgress:false},'world-one'),/Choose the saved progress/);
  assert(ui.log.some(row=>row[1]==='[data-publication-checkpoint]'&&row[2]===false));
});
test('nonboolean checkbox intent fails before any UI change, and open-world is a named mailbox command',async()=>{
  const ui=fixture();await assert.rejects(publishOperatorTemplate(ui,{includeSavedProgress:'false'},'world-one'),/BOOLEAN_REQUIRED/);assert.deepEqual(ui.log,[]);
  assert(PRODUCT_AGENT_COMMANDS.has('open-world'));assert(!PRODUCT_AGENT_COMMANDS.has('evaluate'));
});
