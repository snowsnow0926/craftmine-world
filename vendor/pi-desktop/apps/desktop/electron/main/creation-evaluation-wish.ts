import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";

export type EvaluationWish = {id:string;text:string};
export function parseEvaluationWish(value:unknown):EvaluationWish {
  const input=value as EvaluationWish;
  if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).sort().join(",")!=="id,text"||
    typeof input.id!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(input.id)||
    typeof input.text!=="string"||!input.text.trim()||input.text.length>4000)throw Error("EVALUATION_WISH_INVALID");
  return {id:input.id,text:input.text};
}

/** Evaluator-only journal: claim before submitting, never replay after a lost reply. */
export function createEvaluationWishJournal(directory:string){
  if(!path.isAbsolute(directory))throw Error("EVALUATION_WISH_DIRECTORY_INVALID");
  const file=path.join(directory,"creation-evaluation-wishes.json");
  type Entry={id:string;text:string;sessionId:string;worldId:string;messageId:string;status:"claimed"|"submitted"|"uncertain"};
  const read=():Entry[]=>{
    if(!fs.existsSync(file))return [];
    const data=JSON.parse(fs.readFileSync(file,"utf8"));
    if(data.format!=="craftmine.evaluation-wishes/1"||!Array.isArray(data.entries)||data.entries.length>40||
      new Set(data.entries.map((e:Entry)=>e.id)).size!==data.entries.length)throw Error("EVALUATION_WISH_JOURNAL_CORRUPT");
    for(const e of data.entries){parseEvaluationWish({id:e.id,text:e.text});if(![e.sessionId,e.worldId,e.messageId].every(v=>typeof v==="string"&&v.length>0)||!["claimed","submitted","uncertain"].includes(e.status))throw Error("EVALUATION_WISH_JOURNAL_CORRUPT");}
    return data.entries;
  };
  const write=(entries:Entry[])=>{fs.writeFileSync(file+".tmp",JSON.stringify({format:"craftmine.evaluation-wishes/1",entries})+"\n");fs.renameSync(file+".tmp",file);};
  read();
  return {
    claim(wish:EvaluationWish,sessionId:string,worldId:string){
      wish=parseEvaluationWish(wish);
      if(!sessionId||!worldId)throw Error("EVALUATION_WISH_CONTEXT_REQUIRED");
      const entries=read();
      if(entries.some(e=>e.id===wish.id))throw Error("EVALUATION_WISH_ALREADY_CLAIMED");
      if(entries.length>=40)throw Error("EVALUATION_WISH_LIMIT");
      const entry:Entry={...wish,sessionId,worldId,messageId:randomUUID(),status:"claimed"};
      write([...entries,entry]);return entry;
    },
    finish(id:string,status:"submitted"|"uncertain"){
      const entries=read(),entry=entries.find(e=>e.id===id);
      if(!entry||entry.status!=="claimed")throw Error("EVALUATION_WISH_CLAIM_REQUIRED");
      entry.status=status;write(entries);
    },
    snapshot:read,
  };
}
