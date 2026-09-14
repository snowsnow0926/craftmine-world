const errorText=error=>String(error?.stack??error);
// Preserve received gameplay evidence before post-input persistence. Cleanup
// failures are separate facts and may never replace the original input error.
export async function settleOperatorInputEvidence({identity,segment,run,archive,release,checkpoint,persist}){
  const evidence={format:'craftmine.operator-input-evidence/1',identity,requested:segment,startedAt:new Date().toISOString(),resultReceived:false,semanticSuccess:null,errors:{}};
  try{evidence.result=await run();evidence.resultReceived=true;}catch(error){evidence.errors.input=errorText(error);}
  if(evidence.resultReceived){try{evidence.result=await archive(evidence.result);}catch(error){evidence.errors.archive=errorText(error);}}
  // This first write survives any later release/save/snapshot failure.
  try{await persist(evidence);}catch(error){evidence.errors.evidenceWriteBefore=errorText(error);}
  try{evidence.release=await release();}catch(error){evidence.errors.release=errorText(error);}
  try{evidence.checkpoint=await checkpoint();evidence.checkpointStatus='saved-and-read-back';}catch(error){evidence.errors.checkpoint=errorText(error);evidence.checkpointStatus='unconfirmed';if(error?.checkpointEvidence)evidence.checkpointPartial=error.checkpointEvidence;}
  evidence.endedAt=new Date().toISOString();
  evidence.primaryError=evidence.errors.input??(evidence.result?.status==='failed'?evidence.result.error??'INPUT_SEGMENT_FAILED':null)??evidence.errors.archive??evidence.errors.release??evidence.errors.checkpoint??evidence.errors.evidenceWriteBefore??null;
  try{await persist(evidence);}catch(error){evidence.errors.evidenceWriteAfter=errorText(error);evidence.primaryError??=evidence.errors.evidenceWriteAfter;}
  return evidence;
}

// The existing exploration RPC may throw after executing earlier actions (for
// example a later unsupported capture). Observe around it without inventing
// missing per-action receipts or requiring a valid persistence snapshot.
export async function settleOperatorExplorationEvidence({identity,steps,observe,run,archive,persist}){
  const evidence={format:'craftmine.operator-exploration-evidence/1',identity,requested:steps,startedAt:new Date().toISOString(),dispatchAttempted:false,resultReceived:false,semanticSuccess:null,errors:{}};
  try{evidence.before=await observe();}catch(error){evidence.errors.beforeObservation=errorText(error);}
  if(!evidence.errors.beforeObservation){
    try{evidence.dispatchAttempted=true;evidence.result=await run();evidence.resultReceived=true;}catch(error){evidence.errors.operation=errorText(error);}
    if(evidence.resultReceived){try{evidence.result=await archive(evidence.result);}catch(error){evidence.errors.archive=errorText(error);}}
    try{evidence.after=await observe();}catch(error){evidence.errors.afterObservation=errorText(error);}
  }
  evidence.executionCoverage=evidence.resultReceived?'native-result-received':evidence.dispatchAttempted?'actions-may-have-executed-without-complete-receipt':'not-dispatched';
  evidence.primaryError=evidence.errors.beforeObservation??evidence.errors.operation??evidence.errors.archive??evidence.errors.afterObservation??null;evidence.endedAt=new Date().toISOString();
  try{await persist(evidence);}catch(error){evidence.errors.evidenceWrite=errorText(error);evidence.primaryError??=evidence.errors.evidenceWrite;}
  return evidence;
}
