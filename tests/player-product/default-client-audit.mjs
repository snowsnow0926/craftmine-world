// Independent constants for the fixed official training-range acceptance fixture.
// Deliberately not derived from targetFeedback.describe or its source parser.
import assert from 'node:assert/strict';
export const OFFICIAL_TARGET_DEFAULT = Object.freeze({milliseconds:120,kind:'balance-profile',path:'data/balance/training_range.tres',sha256:'52cd8c5e39ac73b43659ef64b43d29ab68003d56ab693ecb89baeec7d6bf9159'});
export function assertOfficialTargetDefault(target){
 assert.equal(target?.targetId,'target_a');
 assert.deepEqual(target.defaults,{format:'craftmine.target-feedback-default/1',values:{hitFlashMilliseconds:OFFICIAL_TARGET_DEFAULT.milliseconds},source:{kind:OFFICIAL_TARGET_DEFAULT.kind,path:OFFICIAL_TARGET_DEFAULT.path,sha256:OFFICIAL_TARGET_DEFAULT.sha256}});
 return OFFICIAL_TARGET_DEFAULT.milliseconds;
}
async function bounded(promise,ms){
 let timer;try{return await Promise.race([promise.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),ms);})]);}finally{clearTimeout(timer);}
}
export async function stopDefaultClient(access,{quitMs=10000,graceMs=20000,killMs=5000}={}){
 if(access.ended())return;
 // Both the graceful request and owned process exit have independent deadlines.
 await bounded(Promise.resolve().then(access.quit).catch(()=>{}),quitMs);
 await bounded(access.exit,graceMs);
 if(!access.ended()){
  access.launch.forcedStop=true;access.kill();
  if(!await bounded(access.exit,killMs))throw Error('CLIENT_STOP_TIMEOUT');
 }
}
export async function finalizeDefaultClient(report,close,persist){
 try{await close();}catch(error){report.shutdownError=String(error);report.passed=false;}
 report.finishedAt=new Date().toISOString();persist();return report.passed;
}
