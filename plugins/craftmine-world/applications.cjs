const {randomUUID,createHash}=require('node:crypto');
const {fields,prepareApplication}=require('./domain.cjs');

function createApplications(core,service) {
  const running=new Map();
  const applicationId=operationId=>'apply-'+createHash('sha256').update(operationId).digest('hex');
  async function state(operationId,worldId) {
    const receipt=await core.call('application.read',{id:applicationId(operationId)});
    if(receipt.input.worldId!==worldId)throw Error('APPLICATION_WORLD_MISMATCH');
    return {id:receipt.id,status:receipt.status,verificationId:receipt.input.verificationId,reviewId:receipt.input.reviewId,revision:receipt.input.revision,acknowledgeReviewWarnings:receipt.input.acknowledgeReviewWarnings===true,
      record:await core.call('world.read',{id:worldId})};
  }
  async function apply(args) {
    fields(args,['operationId','verificationId','reviewId','worldId','revision'],['acknowledgeReviewWarnings']);
    if(args.acknowledgeReviewWarnings!==undefined&&typeof args.acknowledgeReviewWarnings!=='boolean')throw Error('INVALID_REVIEW_ACKNOWLEDGEMENT');
    const acknowledged=args.acknowledgeReviewWarnings===true;
    if(typeof args.operationId!=='string'||!/^[a-f0-9-]{36}$/.test(args.operationId))throw Error('INVALID_APPLICATION_ID');
    const id=applicationId(args.operationId);
    const request=JSON.stringify([args.worldId,args.revision,args.verificationId,args.reviewId,acknowledged]);
    if(running.has(id)){
      const active=running.get(id);if(active.request!==request)throw Error('REPLAY_MISMATCH');
      return active.operation;
    }
    const operation=(async()=>{
      // Recover an uncertain receipt before trying to prepare from a newer world.
      try{
        const previous=await state(args.operationId,args.worldId);
        if(previous.verificationId!==args.verificationId||previous.reviewId!==args.reviewId||previous.revision!==args.revision||previous.acknowledgeReviewWarnings!==acknowledged)throw Error('REPLAY_MISMATCH');
        if(previous.status==='applied')return previous;
        throw Error('APPLICATION_INACTIVE: 请重新打开候选后重试');
      }catch(error){if(!String(error.message).includes('APPLICATION_NOT_FOUND'))throw error;}
      const job=await core.call('verification.read',{id:args.verificationId});
      const before=await core.call('world.read',{id:args.worldId});
      if(before.revision!==args.revision)throw Error('WORLD_REVISION_CONFLICT');
      const world=prepareApplication(job,before),token=randomUUID();
      const prepared=await core.call('application.prepare',{id,token,verificationId:args.verificationId,reviewId:args.reviewId,
        worldId:args.worldId,revision:args.revision,snapshot:world.snapshot,acknowledgeReviewWarnings:acknowledged});
      try{
        const checked=await service.verify({id,mode:'application',world});
        const evidence={format:'craftmine.desktop-application/1',inputHash:prepared.inputHash,...checked};
        try{await core.call('application.commit',{id,token,evidence});}
        catch(error){
          const recovered=await state(args.operationId,args.worldId);
          if(recovered.status!=='applied')throw error;
        }
        return await state(args.operationId,args.worldId);
      }catch(error){
        try{
          const recovered=await state(args.operationId,args.worldId);
          if(recovered.status==='applied')return recovered;
          await core.call('application.abort',{id});
        }catch(recoveryError){console.warn('Application state requires recovery:',id,recoveryError.message);}
        throw error;
      }
    })();
    running.set(id,{request,operation});
    try{return await operation;}finally{running.delete(id);}
  }
  return {apply,state};
}
module.exports={createApplications};
