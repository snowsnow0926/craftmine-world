import {createManagedPackageInstaller} from './reuse-service.mjs';

const sameContext=(a,b)=>a&&b&&['projectId','sessionId','turnId'].every(key=>a[key]===b[key]);
const fail=code=>{throw Object.assign(Error(code),{code});};
const mutations=new Set(['content.migrate.apply','package.planInstall','godotProject.applyFiles','godotBuild.start']);

/** A model installation stays in its existing author lease. The private host
 * capture, not an argument or a proposal, supplies full-auto authorization. */
export function createAuthorSourceInstaller({call,authorize,selected,enqueue,stagingRoot}){
  const running=new Set();
  const install=async(args,context,assertActive,group=false)=>{
    const guard=async()=>{
      assertActive();
      const capture=await authorize(context);
      if(!capture||capture.worldId!==args.worldId||capture.autoApply!==true||capture.authorization!=='full-auto'||capture.supersededBy)fail('SOURCE_LIBRARY_AUTOMATIC_INSTALL_NOT_AUTHORIZED');
      if(await selected()!==args.worldId)fail('GODOT_WORLD_CHANGED');
      assertActive();
    };
    await guard();
    const boundCall=async(method,input)=>{
      assertActive();
      if(input.context&&!sameContext(input.context,context))fail('SOURCE_LIBRARY_INSTALL_OWNER_CHANGED');
      if(mutations.has(method))await guard();
      const result=await call(method,input);assertActive();return result;
    };
    const installer=createManagedPackageInstaller({call:boundCall,stagingRoot,
      bind:async(worldId,operationId)=>{
        await guard();
        const binding=await boundCall('task.context',{context});
        if(binding?.world?.id!==worldId)fail('SOURCE_LIBRARY_INSTALL_OWNER_CHANGED');
        const worldRecord=await boundCall('world.read',{id:worldId});
        if(worldRecord?.id!==worldId||worldRecord.runtimeKind!=='godot')fail('GODOT_WORLD_REQUIRED');
        let status=await boundCall('content.status',{worldId});
        if(status.backend!=='git'){await boundCall('content.migrate.apply',{worldId});status=await boundCall('content.status',{worldId});}
        const source=await boundCall('godotProject.index',{context,worldId,offset:0,limit:1});
        const branch=status.branches?.find(item=>item.name==='refs/heads/'+source.branchId);
        if(!branch||typeof branch.oid!=='string'||source.worldId!==worldId)fail('PACKAGE_SOURCE_BRANCH_REQUIRED');
        return {context,ownsTurn:false,worldRecord,operation:{operationId,worldId,repoId:status.repoId,branchId:source.branchId,
          expectedHeadOid:branch.oid,expectedAppliedOid:status.appliedOid,expectedProgressRevision:worldRecord.revision}};
      },
      enqueue:async(job,owner)=>{await guard();if(!sameContext(owner,context))fail('SOURCE_LIBRARY_INSTALL_OWNER_CHANGED');return enqueue(job,context);},
    });
    return group?installer.group(args):installer(args);
  };
  const api=(args,context,assertActive,group=false)=>{
    const pending=install(args,context,assertActive,group);running.add(pending);
    pending.finally(()=>running.delete(pending)).catch(()=>{});return pending;
  };
  api.drain=()=>Promise.allSettled([...running]);
  return api;
}
