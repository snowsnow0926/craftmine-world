import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import ts from 'typescript';

test('artifact worker declarations preserve validated shapes and reject incorrect caller types',()=>{
  const filename=fileURLToPath(new URL('./artifact-worker-types.fixture.mts',import.meta.url)).replaceAll('\\','/');
  const source=`
import {Worker} from 'node:worker_threads';
import {artifactWorkerRequest,artifactWorkerMessage,type ArtifactWorkerError} from '../electron/main/godot-artifact-worker-protocol.mjs';
import {startArtifactVerification,type ArtifactVerificationDescriptor} from '../electron/main/godot-artifact-worker-host.mjs';
declare const raw:unknown;
const request=artifactWorkerRequest(raw);
const deadline:number=request.deadline;
const bytes:number=request.descriptor.artifacts[0].bytes;
const message=artifactWorkerMessage(raw,request);
if(message.kind==='result'&&!message.ok){const code:ArtifactWorkerError=message.error;const failed:'failed'=message.snapshot.runtime.state;}
if(message.kind==='result'&&message.ok){const completed:'completed'=message.snapshot.runtime.state;}
if(message.kind==='progress'){
  // @ts-expect-error Progress does not validate its raw optional error payload.
  const error:string=message.error;
}
// @ts-expect-error Artifact byte sizes are numeric, not arbitrary payloads.
const invalidBytes:string=request.descriptor.artifacts[0].bytes;
declare const descriptor:ArtifactVerificationDescriptor;
const task=startArtifactVerification(descriptor,deadline,{WorkerClass:Worker,signal:new AbortController().signal});
const result:Promise<void>=task.result;
const closed:Promise<void>=task.closed;
task.report([]);
startArtifactVerification(descriptor,deadline,{timers:{setTimeout:()=>1,clearTimeout:(handle:number)=>{},setInterval:()=>2,clearInterval:(handle:number)=>{}}});
// @ts-expect-error Binding fields are required even if the artifact paths exist.
startArtifactVerification({root:'/tmp/world',artifacts:[]},deadline);
// @ts-expect-error Cancellation uses an AbortSignal.
startArtifactVerification(descriptor,deadline,{signal:'cancel'});
// @ts-expect-error Result/closed resolve without a fabricated success payload.
const resultNumber:Promise<number>=task.result;
// @ts-expect-error Diagnostics append to the bounded mutable string array.
task.report('not an array');
`;
  // Desktop receives Node types through its existing Electron dependency.
  // Resolve that declaration package without loading Electron or adding a dep.
  const electronRequire=createRequire(import.meta.resolve('electron/package.json'));
  const nodeTypes=dirname(dirname(electronRequire.resolve('@types/node/package.json')));
  const options={module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,target:ts.ScriptTarget.ES2023,strict:true,noEmit:true,skipLibCheck:false,types:['node'],typeRoots:[nodeTypes]};
  const host=ts.createCompilerHost(options),original=host.getSourceFile.bind(host);
  host.getSourceFile=(file,version,onError,newSource)=>file===filename?ts.createSourceFile(file,source,version,true):original(file,version,onError,newSource);
  const program=ts.createProgram([filename],options,host);
  const errors=ts.getPreEmitDiagnostics(program);
  assert.equal(errors.length,0,ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:file=>file,getCurrentDirectory:()=>process.cwd(),getNewLine:()=> '\n'}));
});
