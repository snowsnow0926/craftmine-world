const {randomUUID}=require('node:crypto');
const {compileVerification}=require('./domain.cjs');

// Scheduling only: Rust owns jobs and evidence, PI owns all Agent turns.
function createVerificationJobs(core,service,onPassed=async()=>{}) {
  const jobs=new Map();
  let stopped=false;
  function enqueue(job,context) {
    if(stopped||job.status!=='queued'||jobs.has(job.id))return;
    const entry={context,cancelled:false,promise:null};jobs.set(job.id,entry);
    entry.promise=new Promise(resolve=>setImmediate(resolve)).then(async()=>{
      if(entry.cancelled||stopped)return;
      const token=randomUUID();
      let record;
      try {record=await core.call('verification.claim',{id:job.id,token});}catch(error){console.warn('Verification claim was not committed:',job.id,error.message);return;}
      if(entry.cancelled||stopped)return;
      let output;
      try {
        const artifact=compileVerification(record.input);
        const checked=await service.verify({id:job.id,world:{build:artifact.build,extensions:artifact.extensions,snapshot:artifact.snapshot}});
        output={inputHash:record.inputHash,artifact,evidence:{format:'craftmine.desktop-check/1',
          passed:checked.behaviors?.passed===true&&checked.render?.passed===true,
          compiler:{passed:true},...checked,scope:'接口、事件与实际绘制检查；玩家需求验收与评审尚未完成'}};
      }catch(error){
        output={inputHash:record.inputHash,evidence:{format:'craftmine.desktop-check/1',passed:false,error:String(error.message||error).slice(0,4000)}};
      }
      if(entry.cancelled||stopped)return;
      // Stale/cancelled work is intentionally rejected. Transport failures are
      // logged and retain the immutable input for recovery, never a false pass.
      try {
        const result=await core.call('verification.finish',{id:job.id,token,output},10000);
        if(result.status==='passed'&&record.input.origin?.request?.text&&record.input.origin?.modelKey){
          try{await onPassed(job.id);}catch(error){console.warn('Verification passed but review did not start:',job.id,error.message);}
        }
      }
      catch(error){console.warn('Verification completion was not committed:',job.id,error.message);}
    }).catch(error=>console.warn('Verification worker failed:',job.id,error.message)).finally(()=>jobs.delete(job.id));
  }
  async function cancel(id) {
    const entry=jobs.get(id);if(entry)entry.cancelled=true;
    try {await service.cancelVerification(id);}
    catch(error){console.warn('Verifier cancellation was not acknowledged:',id,error.message);}
  }
  async function cancelTurn(context) {
    await Promise.all([...jobs].filter(([,entry])=>entry.context.sessionId===context.sessionId&&entry.context.turnId===context.turnId).map(([id])=>cancel(id)));
  }
  async function cancelOtherTurns(context) {
    await Promise.all([...jobs].filter(([,entry])=>entry.context.sessionId===context.sessionId&&entry.context.turnId!==context.turnId).map(([id])=>cancel(id)));
  }
  async function stop() {
    stopped=true;
    await Promise.all([...jobs.keys()].map(cancel));
    await Promise.all([...jobs.values()].map(entry=>entry.promise));
  }
  return {enqueue,cancel,cancelTurn,cancelOtherTurns,stop};
}
module.exports={createVerificationJobs};
