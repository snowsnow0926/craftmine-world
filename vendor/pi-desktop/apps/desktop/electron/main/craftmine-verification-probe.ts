// Fixed headless acceptance. All calls use the real PI/Rust/plugin route.
export async function runNativeVerificationProbe(access: {
  invoke: (name: string, args: unknown, id?: string) => Promise<any>;
  panel: (channel: string, payload: Record<string, unknown>) => Promise<any>;
  preview: (id: string) => Promise<any>;
  apply?: (id: string) => Promise<any>;
  check: (name: string, value: boolean) => void;
  worldId: string;
  liveReview?: boolean;
}): Promise<unknown> {
  const { invoke, check } = access;
  const before = await access.panel("world.open", { id: access.worldId });
  const behavior = { format: "craftmine.behavior/2", id: "native-check-behavior", name: "Verification fixture",
    description: "Runs inside a real bounded Worker", code: "export function step({state}) {return {state,commands:[]};}",
    stateVersion: 1, initialState: {}, params: {}, targets: ["native-flower"], permissions: ["objects.write"], requires: [], binding: null, keys: [] };
  if(access.apply)Object.assign(behavior,{initialState:{visible:true},keys:['KeyG'],
    code:"export function step({frame,state}) {if(frame.event.type!=='key'||frame.event.code!=='KeyG')return {state,commands:[]};const visible=!state.visible;return {state:{visible},commands:[{type:'object.patch',id:'native-flower',visible}]};}"});
  await invoke("workspace_patch", { workspaceRevision: 1, operations: [{ op: "add", kind: "behavior", id: behavior.id, expectedHash: null, value: behavior }] });
  const started = Date.now();
  const job = await invoke("verification_submit", { workspaceRevision: 2, summary: "Native flower and gameplay verification" }, "native-check-submit");
  check("Verification submission returns a durable queued job without waiting for rendering", job.status === "queued" && Date.now() - started < 5000);
  const replay = await invoke("verification_submit", { workspaceRevision: 2, summary: "Native flower and gameplay verification" }, "native-check-submit");
  check("Repeated submission recovers the same job", replay.id === job.id);
  const wait = async (id: string) => {
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      const result = await invoke("verification_read", { id, limit: 16000 });
      if (!["queued", "running"].includes(result.status)) return { ...result, detail: JSON.parse(result.text) };
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Native verification did not settle");
  };
  const passed = await wait(job.id);
  check("The native isolated renderer runs actual behavior Workers and renders the compiled world",
    passed.status === "passed" && passed.detail.evidence.behaviors.modules[0]?.passed && passed.detail.evidence.render.capture?.sha256?.length === 64);
  let denied = false;
  try { await access.panel("verification.finish", { id: job.id, output: { passed: true } }); } catch { denied = true; }
  check("The world panel cannot manufacture verification evidence", denied);
  const preview = await access.preview(job.id);
  check("An independent preview loads the checked build and retains the formal player", preview.loaded && preview.playerPreserved && preview.guards.every((guard: any) => guard && guard.pointerLock === 0 && guard.focus === 0));
  if(access.liveReview&&access.apply){
    const deadline=Date.now()+150_000;let reviews:any[]=[];
    while(Date.now()<deadline){
      reviews=await access.panel("review.list",{verificationId:job.id});
      if(reviews[0]&&reviews[0].status!=="running")break;
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    if(reviews[0]?.status!=="completed")throw Error("Live native review failed: "+JSON.stringify(reviews));
    const review=reviews[0];
    check("The configured real DeepSeek model reviews the original host request through native PI completion",review.request.text.includes("真实宿主需求")&&review.usage?.totalTokens>0&&review.modelKey.includes("/deepseek-"));
    check("The real model's frozen request assertions pass against actual game events",review.acceptance.passed&&review.acceptance.assertions.length>=2);
    const application={...(await access.apply(job.id)),review};
    check("The native panel applies the real-model-reviewed fixture without resetting player progress",application.applied&&application.playerPreserved);
    const formal=await access.panel("world.open",{id:access.worldId});
    check("Rust persists the real-model-reviewed build and its authored flower",formal.world.build.id!==before.world.build.id&&formal.world.build.scene.objects.some((o:any)=>o.id==='native-flower'));
    return {passed,preview,application};
  }
  const read = await invoke("resource_read", { kind: "behavior", id: behavior.id });
  await invoke("workspace_patch", { workspaceRevision: 2, operations: [{ op: "replace", kind: "behavior", id: behavior.id, expectedHash: read.hash,
    value: { ...behavior, code: "export function step() {throw new Error('NATIVE_VERIFIER_FAILURE');}" } }] });
  const failedJob = await invoke("verification_submit", { workspaceRevision: 3, summary: "Intentional Worker failure" });
  const failed = await wait(failedJob.id);
  check("A compiled but broken behavior fails inside the actual Worker and retains its diagnostic",
    failed.status === "failed" && JSON.stringify(failed.detail).includes("NATIVE_VERIFIER_FAILURE"));
  const older = await invoke("verification_read", { id: job.id });
  check("Old successful evidence is marked historical after the draft changes", older.status === "passed" && !older.current);
  const after = await access.panel("world.open", { id: access.worldId });
  check("Verification and preview do not publish draft code or replace saved player progress",
    after.world.build.id === before.world.build.id && JSON.stringify(after.world.snapshot.player) === JSON.stringify(before.world.snapshot.player));
  let application;
  if(access.apply){
    const waitReview=async(id:string)=>{
      const deadline=Date.now()+90_000;let records:any[]=[];
      while(Date.now()<deadline){
        records=await access.panel("review.list",{verificationId:id});
        if(records[0]&&records[0].status!=="running")break;
        await new Promise(resolve=>setTimeout(resolve,150));
      }
      if(records[0]?.status!=="completed")throw Error('Native review failed: '+JSON.stringify(records));
      return records;
    };
    const broken=await invoke("resource_read",{kind:"behavior",id:behavior.id});
    const wrong={...behavior,code:"export function step({frame,state}) {return {state,commands:frame.event.type==='key'?[{type:'object.patch',id:'native-flower',color:'#332211'}]:[]};}"};
    await invoke("workspace_patch",{workspaceRevision:3,operations:[{op:"replace",kind:"behavior",id:behavior.id,expectedHash:broken.hash,value:wrong}]});
    const wrongJob=await invoke("verification_submit",{workspaceRevision:4,summary:"Valid code with the wrong requested effect"});
    check("A wrong-effect implementation can pass general machine checks",(await wait(wrongJob.id)).status==='passed');
    const wrongReviews=await waitReview(wrongJob.id);
    check("Actual request assertions reject changing color instead of hiding the rendered flower",wrongReviews[0].acceptance.passed===false&&wrongReviews[0].acceptance.assertions.some((a:any)=>a.id==='hidden-mesh'&&!a.passed));
    const repairContext=await invoke("verification_read",{id:wrongJob.id,limit:2000});
    check("The Agent can read bounded failed-request evidence to guide its next repair",repairContext.reviews[0].failedCount>0&&repairContext.reviews[0].failedAssertions.some((a:any)=>a.id==='hidden-mesh'&&a.detail));
    let rejected=false;
    const current=await access.panel('world.open',{id:access.worldId});
    try{await access.panel('candidate.apply',{operationId:crypto.randomUUID(),worldId:access.worldId,revision:current.revision,verificationId:wrongJob.id,reviewId:wrongReviews[0].id});}catch{rejected=true;}
    check("Failed request evidence cannot be bypassed through the panel application channel",rejected&&(await access.panel('world.open',{id:access.worldId})).world.build.id===before.world.build.id);
    const bad=await invoke("resource_read",{kind:"behavior",id:behavior.id});
    await invoke("workspace_patch",{workspaceRevision:4,operations:[{op:"replace",kind:"behavior",id:behavior.id,expectedHash:bad.hash,value:behavior}]});
    const repaired=await invoke("verification_submit",{workspaceRevision:5,summary:"Repaired native application fixture"});
    await wait(repaired.id);
    const reviews=await waitReview(repaired.id);
    check("PI one-shot completion receives the host request and actual request assertions pass in the renderer",reviews[0].request.text.includes('真实宿主需求')&&reviews[0].acceptance.passed&&reviews[0].usage?.totalTokens>0);
    check("An advisory block verdict remains visible without vetoing machine acceptance",reviews[0].verdict==='block'&&reviews[0].suggestions.length>0);
    application={...(await access.apply(repaired.id)),review:reviews[0],failedRequest:wrongReviews[0]};
    check("The actual world panel applies the candidate and retains current player progress",application.applied&&application.playerPreserved);
    const formal=await access.panel("world.open",{id:access.worldId});
    check("Rust persists the reviewed build containing the authored flower",formal.world.build.id!==before.world.build.id&&formal.world.build.scene.objects.some((o:any)=>o.id==='native-flower'));
  }
  return { passed, failed, preview, application };
}
