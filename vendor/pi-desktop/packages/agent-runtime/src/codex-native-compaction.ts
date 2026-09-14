/** One native maintenance turn; never completes the enclosing player request. */
export function nativeCompaction(signal: AbortSignal) {
  let resolve!:()=>void,reject!:(error:Error)=>void,settled=false;
  const state:{turnId?:string;sawCompletion:boolean;done:Promise<void>;receive(method:string,params:any):void;dispose():void}={
    sawCompletion:false,done:new Promise<void>((yes,no)=>{resolve=yes;reject=no;}),
    receive(method,params){
      if(settled)return;
      if(method==='turn/started'){
        const id=params.turn?.id;
        if(typeof id!=='string'||!id||(state.turnId&&state.turnId!==id))return finish(Error('CODEX_HISTORY_COMPACT_IDENTITY_MISMATCH'));
        state.turnId=id;return;
      }
      if(!state.turnId||(params.turnId&&params.turnId!==state.turnId))return;
      if(method==='item/completed'&&params.turnId===state.turnId&&params.item?.type==='contextCompaction')state.sawCompletion=true;
      if(method==='turn/completed'&&params.turn?.id===state.turnId){
        if(params.turn.status==='completed'&&state.sawCompletion)finish();
        else finish(Error(params.turn.status==='interrupted'?'TURN_ABORTED':'CODEX_HISTORY_COMPACT_FAILED'));
      }
    },
    dispose(){signal.removeEventListener('abort',abort);},
  };
  function finish(error?:Error){if(settled)return;settled=true;state.dispose();error?reject(error):resolve();}
  function abort(){finish(Error('TURN_ABORTED'));}
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  void state.done.catch(()=>{});
  return state;
}
