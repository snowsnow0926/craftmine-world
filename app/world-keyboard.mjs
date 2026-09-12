import {BEHAVIOR_KEYS} from './behavior-contracts.mjs';

const KEYS=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight','KeyE','KeyF','KeyR','KeyT','Digit1','Digit2','Enter',...BEHAVIOR_KEYS]);
export function worldKeyboardInput(value){
  if(!value||!['keydown','keyup'].includes(value.type)||!KEYS.has(value.code))return null;
  if(value.type==='keydown'&&(value.altKey||value.ctrlKey||value.metaKey||value.isComposing))return null;
  return{type:value.type,code:value.code,repeat:value.repeat===true};
}

/** Trusted parent-document keys only; the iframe's own DOM events never bubble here. */
export function createWorldKeyboardRelay({state,send}){
  const held=new Set();let owner=null;
  const same=current=>owner&&current.worldId===owner.worldId&&current.nonce===owner.nonce;
  const reset=()=>{
    const current=state();
    if(owner&&same(current))send('keyboard-reset',{worldId:owner.worldId});
    held.clear();owner=null;
  };
  const handle=event=>{
    if(event.isTrusted!==true)return false;
    const input=worldKeyboardInput(event);if(!input)return false;
    const current=state();
    if(owner&&!same(current)){held.clear();owner=null;}
    if(input.type==='keyup'){
      if(!held.delete(input.code))return false;
      if(same(current))send('keyboard',{worldId:current.worldId,input});
      return true;
    }
    if(!current.enabled||current.editing||!current.worldId||!current.nonce||event.defaultPrevented)return false;
    owner={worldId:current.worldId,nonce:current.nonce};held.add(input.code);
    send('keyboard',{worldId:current.worldId,input});event.preventDefault();return true;
  };
  return{handle,reset,sync:()=>{if(!state().enabled)reset();}};
}
