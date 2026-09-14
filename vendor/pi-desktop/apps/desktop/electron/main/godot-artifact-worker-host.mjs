import {Worker} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {ARTIFACT_WORKER_FORMAT,artifactWorkerRequest,artifactWorkerMessage} from './godot-artifact-worker-protocol.mjs';

/** Host-only fixed worker; completion requires exit, not merely a result message. */
export function startArtifactVerification(descriptor,deadline,{signal,WorkerClass=Worker,timers={setTimeout,clearTimeout,setInterval,clearInterval},now=Date.now}={}){
  const started=now(),request=artifactWorkerRequest({format:ARTIFACT_WORKER_FORMAT,binding:{attemptId:randomUUID(),jobId:descriptor.jobId,worldId:descriptor.worldId,buildId:descriptor.buildId,inputHash:descriptor.inputHash},descriptor:{root:descriptor.root,artifacts:descriptor.artifacts},deadline});
  let worker=null,latest=null,response=null,failure=null,shutdownFailure=null,exitSeen=false,exitCode=null,finishedAt=null,progressMessages=0,reported=false,stopping=false;
  let deadlineTimer=null,stopTimer=null,heartbeat=null,samples=0,maxLagMs=0,lastTick=started;
  let resolveResult,rejectResult,resolveClosed,rejectClosed;
  const result=new Promise((resolve,reject)=>{resolveResult=resolve;rejectResult=reject;});void result.catch(()=>{});
  const closed=new Promise((resolve,reject)=>{resolveClosed=resolve;rejectClosed=reject;});void closed.catch(()=>{});
  const cleanup=()=>{for(const timer of [deadlineTimer,stopTimer])if(timer!==null)timers.clearTimeout(timer);if(heartbeat!==null)timers.clearInterval(heartbeat);signal?.removeEventListener('abort',onAbort);};
  const terminate=reason=>{
    if(exitSeen||stopping)return;stopping=true;failure=reason;if(deadlineTimer!==null)timers.clearTimeout(deadlineTimer);
    stopTimer=timers.setTimeout(()=>{if(exitSeen)return;cleanup();const error=Error('GODOT_CHECK_ARTIFACT_WORKER_STOP_TIMEOUT');shutdownFailure=error;rejectClosed(error);rejectResult(error);},5000);
    try{void worker.terminate().catch(()=>{});}catch{/* exit confirmation still required */}
  };
  const abortReason=()=>signal?.reason instanceof Error&&['GODOT_CHECK_TIMEOUT','GODOT_CHECK_CANCELLED'].includes(signal.reason.message)?signal.reason:Error('GODOT_CHECK_CANCELLED');
  const onAbort=()=>terminate(abortReason());
  if(signal?.aborted||now()>=deadline){failure=signal?.aborted?abortReason():Error('GODOT_CHECK_TIMEOUT');finishedAt=now();resolveClosed();rejectResult(failure);}
  else{
    try{
      // Electron-Vite emits this fixed sibling entry in source builds and ASAR.
      worker=new WorkerClass(fileURLToPath(new URL('./godot-artifact-worker.js',import.meta.url)),{workerData:request,env:{},execArgv:[],stdin:false,stdout:true,stderr:true,trackUnmanagedFds:true});
      worker.on('message',raw=>{
        if(exitSeen||stopping)return;
        let message;try{message=artifactWorkerMessage(raw,request);}catch{return terminate(Error('GODOT_CHECK_ARTIFACT_WORKER_PROTOCOL'));}
        if(message.kind==='progress'){
          if(response!==null||++progressMessages>Math.ceil(Math.max(0,deadline-started)/250)+2)return terminate(Error('GODOT_CHECK_ARTIFACT_WORKER_PROTOCOL'));
          latest=message.snapshot;
        }
        else if(response!==null)terminate(Error('GODOT_CHECK_ARTIFACT_WORKER_PROTOCOL'));
        else{response=message;latest=message.snapshot;}
      });
      worker.once('error',()=>terminate(Error('GODOT_CHECK_ARTIFACT_WORKER_FAILED')));
      worker.once('exit',code=>{
        exitSeen=true;exitCode=code;finishedAt=now();maxLagMs=Math.max(maxLagMs,finishedAt-lastTick-100,0);cleanup();resolveClosed();
        if(!failure&&finishedAt>=deadline)failure=Error('GODOT_CHECK_TIMEOUT');
        if(failure)rejectResult(failure);
        else if(code!==0||!response)rejectResult(failure=Error('GODOT_CHECK_ARTIFACT_WORKER_NO_RESULT'));
        else if(!response.ok)rejectResult(failure=Error(response.error));
        else resolveResult();
      });
      // Register exit handling before anything that can fail after construction.
      worker.stdout?.resume();worker.stderr?.resume();
      deadlineTimer=timers.setTimeout(()=>terminate(Error('GODOT_CHECK_TIMEOUT')),Math.max(0,deadline-now()));deadlineTimer.unref?.();
      heartbeat=timers.setInterval(()=>{const time=now();samples++;maxLagMs=Math.max(maxLagMs,time-lastTick-100,0);lastTick=time;},100);heartbeat.unref?.();
      signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort();
    }catch{const reason=Error('GODOT_CHECK_ARTIFACT_WORKER_START_FAILED');if(worker)terminate(reason);else{failure=reason;cleanup();finishedAt=now();resolveClosed();rejectResult(failure);}}
  }
  return {result,closed,report(log){
    if(reported)return;reported=true;
    const detail=['[artifact-worker] '+JSON.stringify({diagnosticOnly:true,status:failure||shutdownFailure?'failed':'completed',errorCode:failure?.message??null,shutdownErrorCode:shutdownFailure?.message??null,workerStarted:worker!==null,messageReceived:latest!==null,exitConfirmed:exitSeen,exitCode,progressMessages,mainElapsedMs:Math.max(0,(finishedAt??now())-started),mainHeartbeat:{periodMs:100,samples,maxLagMs},workerElapsedMs:latest?.runtime.elapsedMs??null})];
    if(latest){detail.push('[artifact-verification] '+JSON.stringify(latest.progress));detail.push('[artifact-verification-runtime] '+JSON.stringify(latest.runtime));}
    const phases=log.filter(x=>x.startsWith('[phase] ')),other=log.filter(x=>!x.startsWith('[phase] '));
    const kept=phases.concat(other).slice(0,64-detail.length);log.splice(0,log.length,...kept,...detail);
  }};
}
