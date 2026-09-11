import fs from "node:fs";
import path from "node:path";

export function evaluationRequestLimit(value:string|undefined):number {
  if(value===undefined)return 40;
  if(!/^(?:[1-9]|[1-3][0-9]|40)$/.test(value))throw Error("EVALUATION_BUDGET_INVALID");
  return Number(value);
}

/** Only an already validated isolated evaluator constructs this budget fence. */
export function createEvaluationBudget(directory:string,limit=40){
  if(!path.isAbsolute(directory)||!Number.isSafeInteger(limit)||limit<1||limit>40)throw Error("EVALUATION_BUDGET_INVALID");
  const file=path.join(directory,"creation-evaluation-budget.json");
  const previous=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):{format:"craftmine.creation-evaluation-budget/1",limit,requests:[]};
  if(previous.format!=="craftmine.creation-evaluation-budget/1"||previous.limit!==limit||!Array.isArray(previous.requests)||previous.requests.length>limit||new Set(previous.requests).size!==previous.requests.length||previous.requests.some((id:unknown)=>typeof id!=="string"||!id||id.length>240))throw Error("EVALUATION_BUDGET_CORRUPT");
  const requests=new Set<string>(previous.requests);
  return {
    reserve(requestId:string){
      if(typeof requestId!=="string"||!requestId||requestId.length>240)throw Error("EVALUATION_REQUEST_ID_INVALID");
      if(requests.has(requestId))return;
      if(requests.size>=limit)throw Error("EVALUATION_REQUEST_LIMIT");
      const next=[...requests,requestId];
      fs.writeFileSync(file+".tmp",JSON.stringify({format:previous.format,limit,requests:next})+"\n");
      fs.renameSync(file+".tmp",file);requests.add(requestId);
    },
    snapshot(){return {limit,reserved:requests.size,remaining:limit-requests.size};},
  };
}
