/** A model stopping is independent of its already queued build/check work. */
export function promoPilotProgress(snapshot) {
  if(snapshot?.active===true)return {settled:false,reason:'MODEL_RUNNING'};
  if(['queued','running','recovering'].includes(snapshot?.job?.status))return {settled:false,reason:'CHECK_RUNNING'};
  if(snapshot?.application?.status==='applying'||snapshot?.application?.phase==='applying')return {settled:false,reason:'APPLICATION_RUNNING'};
  return {settled:true,reason:snapshot?.budget?.remaining===0?'BUDGET_STOP':'TASK_SETTLED_UNVERIFIED'};
}
