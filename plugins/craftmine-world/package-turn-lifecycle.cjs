// Host-owned installation turns. A queued job retains its lease until the core
// reports a terminal result; neither a renderer nor an enqueue acknowledgement
// can declare the task finished.
function createPackageTurnLifecycle({call,logger=console,pollMs=500,timeoutMs=900000}) {
  const pending=new Map(),unsettled=new Map();let stopped=false;
  const key=context=>JSON.stringify([context.sessionId,context.turnId]);
  const terminal=job=>['passed','failed','cancelled','interrupted'].includes(job.status);
  const finish=async(context,status)=>{
    const id=key(context);unsettled.set(id,{context,status});
    await call('workspace.endTurn',{sessionId:context.sessionId,turnId:context.turnId,status});unsettled.delete(id);
  };
  async function close(entry,cancel=false) {
    let job=await call('godotBuild.read',{worldId:entry.worldId,jobId:entry.jobId});
    if(!terminal(job)&&cancel){await call('godotBuild.cancel',{worldId:entry.worldId,jobId:entry.jobId});job=await call('godotBuild.read',{worldId:entry.worldId,jobId:entry.jobId});}
    if(!terminal(job))return false;
    await finish(entry.context,job.status==='passed'?'completed':'error');pending.delete(key(entry.context));return true;
  }
  return {
    finish,
    watch(job,context) {
      const id=key(context);if(pending.has(id))return;
      const entry={context,worldId:job.worldId,jobId:job.jobId};pending.set(id,entry);
      entry.promise=(async()=>{
        const deadline=Date.now()+timeoutMs;
        while(!stopped){if(await close(entry,Date.now()>=deadline))return;await new Promise(resolve=>{entry.wake=resolve;entry.timer=setTimeout(resolve,pollMs);});}
      })().catch(error=>{entry.error=error;logger.warn?.('Package task finalization pending:',String(error));});
    },
    async drain(){await Promise.all([...pending.values()].map(entry=>entry.promise));},
    async stop(){
      stopped=true;
      for(const entry of pending.values()){clearTimeout(entry.timer);entry.wake?.();}
      await Promise.all([...pending.values()].map(entry=>entry.promise));
      // A transport failure is retained and rejects stop; do not silently
      // forget the lease or shut down its core before it can be reconciled.
      await Promise.all([...pending.values()].map(entry=>close(entry,true)));
      await Promise.all([...unsettled.values()].map(entry=>finish(entry.context,entry.status)));
      if(pending.size)throw Error('PACKAGE_TASK_FINALIZATION_PENDING');
    },
    start(){stopped=false;},
  };
}
function createPackageInstallBinding({call,begin,selected,finish}) {
  return async(worldId,operationId)=>{
    if(await selected()!==worldId)throw Error('GODOT_WORLD_CHANGED');
    const worldRecord=await call('world.read',{id:worldId});
    if(worldRecord.runtimeKind!=='godot')throw Error('GODOT_WORLD_REQUIRED');
    const scope=require('node:crypto').createHash('sha256').update(JSON.stringify([worldId,operationId])).digest('hex').slice(0,40);
    const context={projectId:'craftmine-package-install',sessionId:'package-'+scope,turnId:operationId};
    try {
      // turn.begin is the host router's workspace.open + task.recordContext
      // transaction sequence, not a Rust CoreClient method.
      await begin({context,selectedWorld:worldId,request:{id:operationId,text:'Install this selected package into the world draft, then check it.'}});
      let status=await call('content.status',{worldId});
      if(status.backend!=='git'){await call('content.migrate.apply',{worldId});status=await call('content.status',{worldId});}
      const project=await call('godotProject.index',{context,worldId,offset:0,limit:1});
      const branchId=project.branchId;
      if(typeof branchId!=='string')throw Error('PACKAGE_SOURCE_BRANCH_REQUIRED');
      const branch=status.branches?.find(entry=>entry.name==='refs/heads/'+branchId);
      if(!branch||typeof branch.oid!=='string')throw Error('PACKAGE_SOURCE_BRANCH_REQUIRED');
      return {context,ownsTurn:true,worldRecord,operation:{operationId,worldId,repoId:status.repoId,branchId,
        expectedHeadOid:branch.oid,expectedAppliedOid:status.appliedOid,expectedProgressRevision:worldRecord.revision}};
    }catch(error){try{await finish(context,'error');}catch(finalization){throw new AggregateError([error,finalization],'PACKAGE_BINDING_FINALIZATION_PENDING');}throw error;}
  };
}
module.exports={createPackageTurnLifecycle,createPackageInstallBinding};
