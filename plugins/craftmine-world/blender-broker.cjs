'use strict';
// Trusted transport: no caller-selected executable, shell, environment or receipt.
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn,execFile}=require('node:child_process');
const {createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=files=>hash(JSON.stringify([...files].sort((a,b)=>a.path.localeCompare(b.path)).map(({path,bytes,sha256})=>({path,bytes,sha256}))));
const check=(condition,code)=>{if(!condition)throw Error(code);};
async function ordinary(target,kind='file') {
  const absolute=path.resolve(target);let cursor=path.parse(absolute).root;
  for(const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,part);const info=await fs.lstat(cursor);
    check(!info.isSymbolicLink(),'BLENDER_REPARSE_POINT_REFUSED');
    if(cursor!==absolute)check(info.isDirectory(),'BLENDER_PATH_INVALID');
    else check(kind==='file'?info.isFile():info.isDirectory(),'BLENDER_PATH_INVALID');
  }
  return absolute;
}
async function readOrdinary(file,maxBytes) {
  await ordinary(file);const info=await fs.stat(file);
  check(info.size<=maxBytes,'BLENDER_FILE_TOO_LARGE');return fs.readFile(file);
}
async function discover(toolchain) {
  check(toolchain&&typeof toolchain==='object','BLENDER_TOOLCHAIN_UNAVAILABLE');
  for(const key of ['broker','brokerIdentity','runtimeRoot','toolchainLock'])check(typeof toolchain[key]==='string'&&path.isAbsolute(toolchain[key]),'BLENDER_TOOLCHAIN_INVALID');
  await ordinary(toolchain.runtimeRoot,'directory');
  check(path.resolve(toolchain.broker)===path.join(path.resolve(toolchain.runtimeRoot),'broker','blender-host-broker.exe'),'BLENDER_BROKER_PATH_INVALID');
  const identity=JSON.parse(await readOrdinary(toolchain.brokerIdentity,65536));
  check(identity.format==='craftmine.blender-broker-identity/1'&&/^[a-f0-9]{64}$/.test(identity.sha256)&&Number.isSafeInteger(identity.bytes),'BLENDER_BROKER_PIN_INVALID');
  const broker=await readOrdinary(toolchain.broker,128*1024*1024);
  check(hash(broker)===identity.sha256&&broker.length===identity.bytes,'BLENDER_BROKER_PIN_MISMATCH');
  const lock=JSON.parse(await readOrdinary(toolchain.toolchainLock,4*1024*1024));
  check(lock.format==='craftmine.blender-toolchain/1'&&typeof lock.runtimeVersion==='string'&&Array.isArray(lock.files)&&lock.files.length>0,'BLENDER_RUNTIME_LOCK_INVALID');
  const runtimeInventoryDigest=hash(JSON.stringify(lock.files.map(({path,bytes,sha256})=>({path,bytes,sha256}))));
  check(identity.runtimeVersion===lock.runtimeVersion&&identity.runtimeInventoryDigest===runtimeInventoryDigest,'BLENDER_RUNTIME_PIN_MISMATCH');
  await ordinary(path.join(toolchain.runtimeRoot,'runtime','blender.exe'));
  return {toolchain,brokerSha256:identity.sha256,lock,runtimeVersion:lock.runtimeVersion,runtimeInventoryDigest};
}
function runBroker(discovery,request,signal) {
  return new Promise((resolve,reject)=>{
    const child=spawn(discovery.toolchain.broker,['run'],{windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});
    let stdout='',stderr='',failure=null,cancelTimer;
    const cancel=()=>{if(!child.stdin.destroyed)child.stdin.end('\n');cancelTimer??=setTimeout(()=>child.kill(),15000);cancelTimer.unref?.();};
    signal.addEventListener('abort',cancel,{once:true});
    child.stdin.on('error',()=>{});
    child.on('error',error=>{failure=error;});
    child.stdout.on('data',chunk=>{stdout+=chunk.toString('utf8');if(Buffer.byteLength(stdout)>2*1024*1024){failure=Error('BLENDER_BROKER_RESPONSE_TOO_LARGE');cancel();stdout='';}});
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString('utf8')).slice(-8192);});
    child.on('close',code=>{
      clearTimeout(cancelTimer);signal.removeEventListener('abort',cancel);
      if(failure)return reject(failure);
      if(signal.aborted)return reject(Error('BLENDER_JOB_CANCELLED'));
      if(code!==0)return reject(Error('BLENDER_BROKER_EXIT_FAILED'));
      try {const lines=stdout.trim().split(/\r?\n/);check(lines.length===1,'BLENDER_BROKER_RESPONSE_INVALID');resolve(JSON.parse(lines[0]));}
      catch(error){reject(error);}
    });
    child.stdin.write(JSON.stringify(request)+'\n');
    if(signal.aborted)cancel();
  });
}
async function recover(discovery,tasksRoot){
  await ordinary(tasksRoot,'directory');
  const result=await new Promise(resolve=>execFile(discovery.toolchain.broker,['recover',tasksRoot],{windowsHide:true,shell:false,timeout:120000,maxBuffer:2*1024*1024},(error,stdout)=>resolve({error,stdout})));
  let report;try{report=JSON.parse(result.stdout);}catch{throw Error('BLENDER_RECOVERY_REPORT_INVALID');}
  const plain=value=>typeof value==='string'?value.replace(/^\\\\\?\\/,''):'';
  check(report.policyVersion==='craftmine.windows.recovery-journal.v1'&&path.resolve(plain(report.tasksRoot))===path.resolve(tasksRoot)&&Array.isArray(report.entries)&&Array.isArray(report.unreadable),'BLENDER_RECOVERY_REPORT_INVALID');
  check(!result.error&&report.unreadable.length===0&&report.entries.every(entry=>entry.identityVerified===true&&entry.journalRemoved===true&&entry.finalReceiptObserved!==true),'BLENDER_RECOVERY_INCOMPLETE');
  return {verified:true,reclaimed:report.entries.length};
}
function validateReceipt(receipt,request,discovery) {
  check(receipt?.schemaVersion===1&&receipt.requestId===request.requestId&&receipt.taskId===request.taskId&&receipt.operation==='model','BLENDER_BROKER_IDENTITY_MISMATCH');
  check(receipt.inputHash===request.inputHash&&isDeepStrictEqual(receipt.sourceBinding,request.sourceBinding),'BLENDER_BROKER_BINDING_MISMATCH');
  check(receipt.state==='succeeded'&&receipt.exitCode===0,'BLENDER_BROKER_TASK_FAILED');
  check(receipt.policyVersion==='craftmine.windows.lpac-registry.v1'&&receipt.processVerification?.verified===true&&receipt.networkPreflight?.verified===true&&receipt.cleanup?.verified===true&&receipt.resourceEnforcement?.enforced===false,'BLENDER_OS_ISOLATION_UNVERIFIED');
  const process=receipt.processVerification,network=receipt.networkPreflight;
  check(process.verifiedBeforeResume===true&&process.jobMembershipVerified===true&&process.isAppContainer===true&&process.activeProcessLimit===1&&receipt.jobActiveProcesses===0&&network.jobActiveProcesses===0&&network.exactTaskExempt===false&&Array.isArray(network.hostReceivedCounts)&&network.hostReceivedCounts.length===4&&network.hostReceivedCounts.every(value=>value===0),'BLENDER_OS_ISOLATION_UNVERIFIED');
  check(receipt.cleanup.workRemoved===true&&receipt.cleanup.profileHresult===0&&receipt.cleanup.error===null&&receipt.binRemoved===true&&receipt.recoveryJournal?.cleared===true&&receipt.recoveryJournal.error===null&&receipt.recoveryJournal.policyVersion==='craftmine.windows.recovery-journal.v1','BLENDER_CLEANUP_UNVERIFIED');
  check(receipt.brokerSha256===discovery.brokerSha256,'BLENDER_BROKER_PIN_MISMATCH');
  check(Array.isArray(receipt.sourceFiles)&&digest(receipt.sourceFiles)===request.inputHash&&receipt.sourceSnapshotDigest===request.inputHash,'BLENDER_INPUT_CHANGED');
  check(receipt.runtimeVersion===discovery.runtimeVersion&&receipt.runtimeInventoryDigest===discovery.runtimeInventoryDigest,'BLENDER_RUNTIME_UNVERIFIED');
  return receipt;
}
module.exports={discover,runBroker,recover,validateReceipt,ordinary,readOrdinary,hash,digest,check};
