const candidateBusy = error => /^(?:Error invoking remote method 'pi-plugin-panel-invoke': Error: )?GODOT_CANDIDATE_ACTIVE$/.test(String(error?.message || error));

/** Presentation only. The existing host gate still decides every attempt.
 * One latest intent per channel, one physical invocation, one retry timer. */
export function createGodotPresentationQueue({invoke,scope,onError,onSuccess,setTimer=setTimeout,clearTimer=clearTimeout}) {
  const desired=new Map();
  let sequence=0,running=null,timer=null,disposed=false;
  const current=request=>{
    const owner=scope();
    return !disposed&&owner?.worldId===request.worldId&&owner.key===request.key&&desired.get(request.channel)===request;
  };
  const prune=()=>{for(const [channel,request] of desired)if(!current(request))desired.delete(channel);};
  function schedule(delay=0) {
    if(timer!==null)clearTimer(timer);
    timer=null;prune();
    if(disposed||running||!desired.size)return;
    timer=setTimer(()=>{timer=null;void pump();},delay);
  }
  async function pump() {
    prune();
    if(disposed||running||!desired.size)return;
    const request=[...desired.values()].sort((a,b)=>a.sequence-b.sequence)[0];
    running=request;let delay=0;
    try {
      const result=await invoke(request.channel,request.payload);
      if(!current(request))return;
      if(result?.ok!==true)throw Error('GODOT_PRESENTATION_UNCONFIRMED');
      onSuccess(request);
      desired.delete(request.channel);
    } catch(error) {
      if(!current(request))return;
      const retrying=candidateBusy(error);
      // Repeated background retries must not replace a newer real error.
      if(!retrying||!request.reported)onError(error,{...request,retrying});
      request.reported=true;
      if(retrying){request.attempt++;delay=Math.min(2000,250*2**Math.min(3,request.attempt-1));}
      else desired.delete(request.channel);
    } finally {
      running=null;schedule(delay);
    }
  }
  return {
    request(channel,payload) {
      if(disposed)return;
      if(!['godot.runtimeSurface','godot.runtimeResume'].includes(channel)
        ||(channel==='godot.runtimeSurface'&&typeof payload.visible!=='boolean'))throw Error('INVALID_GODOT_PRESENTATION_REQUEST');
      const owner=scope();
      if(!owner||payload.worldId!==owner.worldId)return;
      prune();
      // Surface visibility already includes the matching pause/resume. An old
      // standalone resume must not overtake the player's newer hidden surface.
      if(channel==='godot.runtimeSurface')desired.delete('godot.runtimeResume');
      else if(desired.has('godot.runtimeSurface'))return;
      desired.set(channel,{channel,payload:{...payload},worldId:owner.worldId,key:owner.key,sequence:++sequence,attempt:0,reported:false});
      schedule();
    },
    changed(){schedule();},
    dispose(){disposed=true;desired.clear();if(timer!==null)clearTimer(timer);timer=null;},
  };
}
