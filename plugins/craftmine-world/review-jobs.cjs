const {createHash,randomUUID}=require('node:crypto');
const {reviewPrompt,parseReview}=require('./domain.cjs');

function createReviewJobs(core,service) {
  const jobs=new Map();let stopped=false;
  async function start(verificationId,{retry=false}={}) {
    if(stopped)throw Error('REVIEW_SERVICE_STOPPED');
    const job=await core.call('verification.read',{id:verificationId});
    const existing=await core.call('review.list',{verificationId});
    if(!retry&&existing.length)return existing[0];
    const prompt=reviewPrompt(job);
    const id='review-'+createHash('sha256').update(randomUUID()).digest('hex'),token=randomUUID();
    const record=await core.call('review.start',{id,token,verificationId});
    const entry={binding:job.input.binding,cancelled:false,promise:null};jobs.set(id,entry);
    entry.promise=new Promise(resolve=>setImmediate(resolve)).then(async()=>{
      if(entry.cancelled||stopped)return;
      let output,response;
      try{
        response=await service.complete(id,prompt);
        if(entry.cancelled||stopped)return;
        const plan=parseReview(response);
        const sealed=await core.call('review.plan',{id,token,plan});
        if(entry.cancelled||stopped)return;
        const baseline=await service.verify({id,mode:'observe',world:job.input.world});
        if(entry.cancelled||stopped)return;
        const requestPlan=Object.fromEntries(['summary','verdict','suggestions','limitations','assertions','steps'].map(key=>[key,plan[key]]));
        const checked=await service.verify({id,mode:'acceptance',world:job.output.artifact,
          baseline:{version:baseline.render.version,observation:baseline.observation},plan:requestPlan});
        output={format:'craftmine.desktop-review/1',inputHash:record.inputHash,planHash:sealed.hash,advisory:true,
          modelKey:response.modelKey,text:response.text,usage:response.usage||null,verdict:plan.verdict,summary:plan.summary,
          suggestions:plan.suggestions,limitations:plan.limitations,request:job.input.origin.request,
          acceptance:{...checked.acceptance,verificationOutputHash:job.outputHash},render:checked.render,isolation:checked.isolation,
          baseline:{render:baseline.render,isolation:baseline.isolation}};
      }catch(error){output={inputHash:record.inputHash,error:String(error.message||error).slice(0,4000),
        ...(response?{modelKey:response.modelKey,usage:response.usage||null,text:String(response.text||'').slice(0,180000)}:{})};}
      if(entry.cancelled||stopped)return;
      try{await core.call('review.finish',{id,token,output});}
      catch(error){console.warn('Review receipt was not committed:',id,error.message);}
    }).catch(error=>console.warn('Review job failed:',id,error.message)).finally(()=>jobs.delete(id));
    return record;
  }
  async function cancel(id) {
    const entry=jobs.get(id);if(entry)entry.cancelled=true;
    try{await core.call('review.cancel',{id});}catch(error){console.warn('Review cancellation receipt failed:',id,error.message);}
    for(const run of [()=>service.cancelComplete(id),()=>service.cancelVerification(id)]){
      try{await run();}catch(error){console.warn('Review cancellation transport failed:',id,error.message);}
    }
  }
  const matches=(binding,context)=>binding.sessionId===context.sessionId&&binding.turnId===context.turnId;
  async function cancelTurn(context){await Promise.all([...jobs].filter(([,e])=>matches(e.binding,context)).map(([id])=>cancel(id)));}
  async function cancelOtherTurns(context){await Promise.all([...jobs].filter(([,e])=>e.binding.sessionId===context.sessionId&&!matches(e.binding,context)).map(([id])=>cancel(id)));}
  async function stop(){stopped=true;await Promise.all([...jobs.keys()].map(cancel));await Promise.all([...jobs.values()].map(e=>e.promise));}
  return {start,cancel,cancelTurn,cancelOtherTurns,stop};
}
module.exports={createReviewJobs};
