// Exact bytes are also hashed into the game CSP. Only the dedicated headless
// preload injects these bytes; renderer-owned flags never enable injection.
export const NATIVE_ACCEPTANCE_MARKER='<!--CRAFTMINE_NATIVE_ACCEPTANCE-->';
export const NATIVE_ACCEPTANCE_SOURCE=`(()=>{
  let run=null;
  Object.defineProperty(globalThis,'__craftmineNativeAcceptance',{configurable:false,writable:false,value:Object.freeze({
    register(callback){if(run||typeof callback!=='function')throw Error('Native game acceptance already registered');run=callback;},
    invoke(name){if(!run||typeof name!=='string')throw Error('Native game acceptance unavailable');return run(name);},
    clear(){run=null;}
  })});
})();`;
