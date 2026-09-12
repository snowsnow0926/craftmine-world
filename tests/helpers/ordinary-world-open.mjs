// Test controller scheduling for an ordinary world-list open. No source writes,
// operation replay after an uncertain reply, or product lifecycle overrides.
export async function openWorldAfterNavigationReady({worldId,readReady,open,wait,assertActive=()=>{},record=()=>{},now=Date.now,timeoutMs=90000}){
 const deadline=now()+timeoutMs;
 while(now()<deadline){
  assertActive();let ready;
  try{ready=await readReady();}catch(error){
   // The read-only view may not exist yet while create mode is mounting. No
   // open was dispatched, so retrying this observation cannot replay a change.
   record({kind:'world-navigation-observation-pending',worldId,error:String(error)});
   assertActive();await wait();continue;
  }
  assertActive();
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
