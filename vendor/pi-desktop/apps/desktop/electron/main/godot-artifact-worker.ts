// Fixed Node worker entry: no Electron import, world scripts, model or window.
import {isMainThread,parentPort,workerData} from 'node:worker_threads';
import {createArtifactVerificationProgress,verifyArtifacts} from './godot-artifact-verification';
import {ARTIFACT_WORKER_FORMAT,ARTIFACT_WORKER_ERRORS,artifactWorkerRequest} from './godot-artifact-worker-protocol.mjs';
if(isMainThread||!parentPort)throw Error('GODOT_CHECK_ARTIFACT_WORKER_REQUIRED');
const port=parentPort,request=artifactWorkerRequest(workerData),stop=new AbortController();
let lastProgress=0;
const progress=createArtifactVerificationProgress(request.descriptor.artifacts.length,Date.now,{onSample:()=>publish(false)});
function publish(force:boolean){const time=Date.now();if(!force&&time-lastProgress<250)return;lastProgress=time;port.postMessage({format:ARTIFACT_WORKER_FORMAT,binding:request.binding,kind:'progress',snapshot:progress.snapshot()});}
const timer=setTimeout(()=>stop.abort(Error('GODOT_CHECK_TIMEOUT')),Math.max(0,request.deadline-Date.now()));timer.unref();
try{
  const work=verifyArtifacts(request.descriptor,request.deadline,progress,{signal:stop.signal});publish(true);await work;
  port.postMessage({format:ARTIFACT_WORKER_FORMAT,binding:request.binding,kind:'result',ok:true,snapshot:progress.snapshot()});
}catch(error){
  const code=error instanceof Error&&ARTIFACT_WORKER_ERRORS.has(error.message)?error.message:'GODOT_CHECK_ARTIFACT_IO_ERROR';
  progress.fail([],code);port.postMessage({format:ARTIFACT_WORKER_FORMAT,binding:request.binding,kind:'result',ok:false,error:code,snapshot:progress.snapshot()});
}finally{clearTimeout(timer);progress.complete();port.close();}
