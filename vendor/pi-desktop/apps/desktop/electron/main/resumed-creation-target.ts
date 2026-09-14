import type {CreationCapture} from './creation-target-service';

type Context = {projectId:string;sessionId:string;turnId:string};
type Dependencies = {
  readContext(context:Context):Promise<any>;
  assertCurrent(context:Context,worldId:string):Promise<void>;
  bindWorld(context:Context,worldId:string,requestText:string):Promise<CreationCapture|null>;
  cancel(sessionId:string,turnId:string):void;
};
const sameContext=(binding:any,context:Context)=>binding&&['projectId','sessionId','turnId'].every(key=>binding[key]===context[key as keyof Context]);

/** A player-initiated resume is a fresh permission decision for the new Core
 * generation. It must not reuse automatic repair authority from a cancelled
 * historical capture. The target service reads the current permission mode. */
export async function bindResumedCreationTarget(context:Context,recovery:any,requestText:string,deps:Dependencies):Promise<CreationCapture|null> {
  const workspace=recovery?.workspace,binding=workspace?.task?.binding,worldId=workspace?.worldId;
  if(!sameContext(binding,context)||typeof worldId!=='string'||!worldId||typeof workspace.resumedFrom!=='string'
    ||workspace.resumedFrom===binding.taskId||!Number.isSafeInteger(recovery.generation)||recovery.generation<2)
    throw Error('CREATION_RECOVERY_BINDING_INVALID');
  const read=async()=>{
    await deps.assertCurrent(context,worldId);
    const current=await deps.readContext(context);
    if(!sameContext(current?.binding,context)||current.binding.taskId!==binding.taskId||current.binding.baseBuild!==binding.baseBuild
      ||current.world?.id!==worldId||current.generation!==recovery.generation||current.status!=='running'
      ||current.recovery!=='none'||current.lease?.owned!==true||!current.budget?.ownerTaskId
      ||current.budget.ownerTaskId!==recovery.budget?.ownerTaskId)throw Error('CREATION_RECOVERY_BINDING_INVALID');
    await deps.assertCurrent(context,worldId);
    return current;
  };
  const current=await read();
  // Legacy worlds retain their ordinary renderer application flow.
  if(current.world.runtimeKind!=='godot')return null;
  try{
    const capture=await deps.bindWorld(context,worldId,requestText);
    await read();
    return capture;
  }catch(error){
    deps.cancel(context.sessionId,context.turnId);
    throw error;
  }
}
