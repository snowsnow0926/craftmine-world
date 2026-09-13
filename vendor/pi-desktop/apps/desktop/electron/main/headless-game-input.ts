import type {PlayIdentity} from './headless-play-action';
import {createHash} from 'node:crypto';

export const HEADLESS_GAME_INPUT_FORMAT='craftmine.headless-game-input/1';
const NAMED:Record<string,string>={Enter:'Enter',Space:' ',Tab:'Tab',Escape:'Escape',Backspace:'Backspace',
  ArrowUp:'ArrowUp',ArrowDown:'ArrowDown',ArrowLeft:'ArrowLeft',ArrowRight:'ArrowRight',
  ShiftLeft:'Shift',ShiftRight:'Shift',ControlLeft:'Control',ControlRight:'Control',
  Minus:'-',Equal:'=',Comma:',',Period:'.',Slash:'/',Semicolon:';',Quote:"'",BracketLeft:'[',BracketRight:']',Backslash:'\\'};
export function browserKey(code:unknown):string {
  if(typeof code!=='string')throw Error('GAME_INPUT_KEY_INVALID');
  if(/^Key[A-Z]$/.test(code))return code.slice(3).toLowerCase();
  if(/^Digit[0-9]$/.test(code))return code.slice(5);
  if(Object.hasOwn(NAMED,code))return NAMED[code];
  throw Error('GAME_INPUT_KEY_INVALID');
}
export type GameInputEvent={kind:'key';code:string;key:string;down:boolean}|{kind:'button';button:0|1|2;down:boolean}|{kind:'motion';x:number;y:number};
export function validateGameInputEvents(events:unknown):asserts events is GameInputEvent[] {
  if(!Array.isArray(events)||events.length>32)throw Error('GAME_INPUT_EVENTS_INVALID');
  for(const event of events){
    if(!event||typeof event!=='object'||Array.isArray(event))throw Error('GAME_INPUT_EVENT_INVALID');
    const fields=Object.keys(event).sort().join(',');
    if(event.kind==='key'&&fields==='code,down,key,kind'&&typeof event.down==='boolean'&&browserKey(event.code)===event.key)continue;
    if(event.kind==='button'&&fields==='button,down,kind'&&[0,1,2].includes(event.button)&&typeof event.down==='boolean')continue;
    if(event.kind==='motion'&&fields==='kind,x,y'&&[event.x,event.y].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=4096))continue;
    throw Error('GAME_INPUT_EVENT_INVALID');
  }
}

/** Serialized fixed program, not caller JavaScript. Dispatch only into the owned
 * headless canvas. Godot's normal Web input handlers convert these DOM events to
 * InputEventKey/MouseButton/MouseMotion. No actor or engine state is assigned. */
function dispatchInPage(input:{identity:PlayIdentity;events:GameInputEvent[]}) {
  const page=globalThis as any,scope=page.craftmineRuntime?.scope;
  if(!scope||['worldId','buildId','instanceId'].some(k=>scope[k]!==input.identity[k as keyof PlayIdentity]))throw Error('GAME_INPUT_PAGE_IDENTITY');
  if(!page.__craftmineHeadless||document.pointerLockElement)throw Error('GAME_INPUT_GUARD_REQUIRED');
  const canvas=document.getElementById('canvas') as HTMLCanvasElement;
  if(!canvas||canvas.tagName!=='CANVAS')throw Error('GAME_INPUT_CANVAS_REQUIRED');
  const rect=canvas.getBoundingClientRect();if(rect.width<1||rect.height<1)throw Error('GAME_INPUT_CANVAS_SIZE');
  const active=document.activeElement;
  // The pinned Web mouse-button callback normally calls canvas.focus(). Suppress
  // that DOM-only focus step; virtual events require neither focus nor capture.
  const ownFocus=Object.getOwnPropertyDescriptor(canvas,'focus');let suppressedFocus=0;
  Object.defineProperty(canvas,'focus',{configurable:true,value:()=>{suppressedFocus++;}});
  const state=page.__craftmineVirtualInput??={keys:[],buttons:[]};
  const receipts:any[]=[];
  try {
    for(const inputEvent of input.events){
      const modifiers={shiftKey:state.keys.some((k:string)=>k.startsWith('Shift')),ctrlKey:state.keys.some((k:string)=>k.startsWith('Control')),altKey:false,metaKey:false};
      let event:Event,target:EventTarget=canvas;
      if(inputEvent.kind==='key') {
        state.keys=state.keys.filter((k:string)=>k!==inputEvent.code);if(inputEvent.down)state.keys.push(inputEvent.code);
        event=new KeyboardEvent(inputEvent.down?'keydown':'keyup',{code:inputEvent.code,key:inputEvent.key,repeat:false,bubbles:true,cancelable:true,...modifiers,
          shiftKey:state.keys.some((k:string)=>k.startsWith('Shift')),ctrlKey:state.keys.some((k:string)=>k.startsWith('Control'))});
      } else {
        if(inputEvent.kind==='button'){state.buttons=state.buttons.filter((b:number)=>b!==inputEvent.button);if(inputEvent.down)state.buttons.push(inputEvent.button);}
        const buttons=state.buttons.reduce((mask:number,b:number)=>mask|[1,4,2][b],0);
        const mouse={bubbles:true,cancelable:true,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2,buttons,...modifiers};
        if(inputEvent.kind==='button'){event=new MouseEvent(inputEvent.down?'mousedown':'mouseup',{...mouse,button:inputEvent.button});if(!inputEvent.down)target=window;}
        else {event=new PointerEvent('pointermove',{...mouse,pointerId:1,pointerType:'mouse',movementX:inputEvent.x,movementY:inputEvent.y});target=window;}
      }
      target.dispatchEvent(event);
      receipts.push({kind:inputEvent.kind,event:event.type,defaultPrevented:event.defaultPrevented,trusted:event.isTrusted});
    }
  } finally {
    if(ownFocus)Object.defineProperty(canvas,'focus',ownFocus);else delete (canvas as any).focus;
  }
  if(document.activeElement!==active||document.pointerLockElement)throw Error('GAME_INPUT_FOCUS_CHANGED');
  return {format:'craftmine.headless-game-input/1',identity:input.identity,transport:'fixed-page-dispatch',events:receipts,
    held:{keys:[...state.keys],buttons:[...state.buttons]},suppressedFocus,guard:{...page.__craftmineHeadless}};
}
export function gameInputScript(identity:PlayIdentity,events:GameInputEvent[]):string {
  validateGameInputEvents(events);
  return `(${dispatchInPage.toString()})(${JSON.stringify({identity,events})})`;
}
export const GAME_INPUT_PROGRAM_SHA256=createHash('sha256').update(dispatchInPage.toString()).digest('hex');
