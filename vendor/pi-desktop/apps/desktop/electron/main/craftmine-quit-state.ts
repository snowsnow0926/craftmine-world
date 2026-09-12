export type QuitState = {attemptId:number; phase:"confirming"|"saving"|"failed"|"cancelled"; error?:string};

/** A quit acknowledgement is not a completed checkpoint. Publish its lifecycle. */
export function createCraftmineQuitState(publish:(state:QuitState)=>void) {
  let state:QuitState|null=null;
  const active=()=>state?.phase==="confirming"||state?.phase==="saving";
  return {
    begin(phase:"confirming"|"saving") {
      if(active())return state!.attemptId;
      state={attemptId:(state?.attemptId??0)+1,phase};publish({...state});return state.attemptId;
    },
    saving() {
      if(!active())return this.begin("saving");
      if(state!.phase!=="saving"){state={attemptId:state!.attemptId,phase:"saving"};publish({...state});}
      return state!.attemptId;
    },
    finish(attemptId:number,phase:"failed"|"cancelled",error?:string) {
      if(!active()||state!.attemptId!==attemptId)return;
      state={attemptId,phase,...(error?{error}:{})};publish({...state});
    },
  };
}
