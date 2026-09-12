// Test controller scheduling for an ordinary world-list open. No source writes,
// operation replay after an uncertain reply, or product lifecycle overrides.
export async function openWorldAfterNavigationReady({worldId,readReady,open,wait,assertActive=()=>{},record=()=>{},now=Date.now,timeoutMs=90000}){
 const deadline=now()+timeoutMs;
 while(now()<deadline){
  assertActive();const ready=await readReady();assertActive();
  if(ready?.ready!==true){await wait();continue;}
  try{return await open(worldId);}catch(error){
   // The coordinator/selection-sync guard refuses before opening a new world.
   // A transport timeout or any other error has an uncertain outcome: surface it.
   if(!/^(?:Error: )*WORLD_BUSY$/.test(String(error?.message??error)))throw error;
   record({kind:'world-open-preflight-busy',worldId,observedReady:ready});
   await wait();
  }
 }
 throw Error('WORLD_NAVIGATION_OPEN_TIMEOUT');
}
