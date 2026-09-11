/** Finite window actions. No game command, focus request, or input injection. */
export type FullscreenKeyDecision = {action: "toggle" | null; preventDefault: boolean};
export type NativeFullscreenInput = {
  type: string; key: string; code?: string; isAutoRepeat?: boolean;
  isComposing?: boolean; keyCode?: number;
  alt?: boolean; control?: boolean; meta?: boolean; shift?: boolean;
};
export function nativeFullscreenKeyDecision(input: NativeFullscreenInput): FullscreenKeyDecision {
  if(input.type!=="keyDown"||input.key!=="F11"||input.isComposing||input.keyCode===229||input.alt||input.control||input.meta||input.shift)
    return {action:null,preventDefault:false};
  return {action:input.isAutoRepeat?null:"toggle",preventDefault:true};
}

type EscapeEvent = Pick<KeyboardEvent,"key"|"isTrusted"|"isComposing"|"keyCode"|"repeat"|"altKey"|"ctrlKey"|"metaKey"|"shiftKey"|"defaultPrevented">;
export type FullscreenEscapeContext = {pointerLocked:boolean; overlayOpen:boolean; editing:boolean; composing:boolean};
export function mayExitFullscreen(event:EscapeEvent,context:FullscreenEscapeContext):boolean {
  return event.isTrusted&&event.key==="Escape"&&!event.defaultPrevented&&!event.isComposing&&event.keyCode!==229&&!event.repeat
    &&!event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!context.pointerLocked&&!context.overlayOpen&&!context.editing&&!context.composing;
}

/** Read actual renderer layers before their Escape handlers can dismiss them. */
export function fullscreenEscapeContext(document:Document,composing=false,ignoredOverlay:Element|null=null):FullscreenEscapeContext {
  const view=document.defaultView;
  const visible=(element:Element)=>{
    if(element.closest('[hidden],[inert],[aria-hidden="true"]'))return false;
    const style=view?.getComputedStyle(element);
    return style?.display!=="none"&&style?.visibility!=="hidden"&&element.getClientRects().length>0;
  };
  const active=document.activeElement;
  // Plain chat text does not itself consume Escape. IME and autocomplete are
  // handled independently above/below; native pickers/search clear operations
  // can consume Escape without a DOM preventDefault, so retain their layer.
  const editing=!!active&&active.matches('select,input[list],input[type="search"],input[type="color"],input[type="date"],input[type="datetime-local"],input[type="month"],input[type="time"],input[type="week"]');
  const overlayOpen=Array.from(document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"],[aria-modal="true"],dialog[open],[popover]')).some(element=>element!==ignoredOverlay&&visible(element));
  return {pointerLocked:!!document.pointerLockElement,overlayOpen,editing,composing};
}

/**
 * Capture reserves the current layer; bubbling/deferred checking lets menu/IME
 * handlers consume Escape first. A pointer release and fullscreen exit can
 * never share one event. Preload callers send only their fixed private scope.
 */
export function attachFullscreenEscape(target:Window,options:{onExit:()=>void|Promise<unknown>;onError?:(error:unknown)=>void}):()=>void {
  let disposed=false,composing=false,pending=false,generation=0;
  const captured=new WeakMap<KeyboardEvent,FullscreenEscapeContext>();
  const capture=(event:KeyboardEvent)=>{
    if(event.key==="Escape")captured.set(event,fullscreenEscapeContext(target.document,composing));
  };
  const bubble=(event:KeyboardEvent)=>{
    const before=captured.get(event);if(!before||disposed||pending||!mayExitFullscreen(event,before))return;
    const version=generation;
    target.queueMicrotask(()=>{
      if(disposed||generation!==version||pending||!mayExitFullscreen(event,before)||!mayExitFullscreen(event,fullscreenEscapeContext(target.document,composing)))return;
      pending=true;
      Promise.resolve().then(()=>{if(!disposed&&generation===version)return options.onExit();}).catch(error=>options.onError?.(error)).finally(()=>{pending=false;});
    });
  };
  const begin=()=>{composing=true;};const end=()=>{composing=false;};
  const blur=()=>{composing=false;generation++;};
  target.addEventListener("keydown",capture,true);target.addEventListener("keydown",bubble);
  target.addEventListener("compositionstart",begin,true);target.addEventListener("compositionend",end,true);target.addEventListener("blur",blur);
  return ()=>{
    disposed=true;generation++;
    target.removeEventListener("keydown",capture,true);target.removeEventListener("keydown",bubble);
    target.removeEventListener("compositionstart",begin,true);target.removeEventListener("compositionend",end,true);target.removeEventListener("blur",blur);
  };
}
