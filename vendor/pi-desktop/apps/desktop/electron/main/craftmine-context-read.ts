type Data=Record<string,any>;
/** Completed tasks stay read-only, including an application racing this read. */
export async function readCraftminePromptContext(domain:(method:string,args:Data)=>Promise<unknown>,context:Data,request:{id:string;text:string}):Promise<Data>{
  const before=await domain("task.context",{context}) as Data;
  if(before.status!=="running")return before;
  try{return await domain("task.context",{context,request}) as Data;}
  catch(error){
    const current=await domain("task.context",{context}) as Data;
    if(current.status!=="finished"||current.lease?.owned)throw error;
    return current;
  }
}
