// Test-agent file transport only. Never starts a model or invokes product APIs.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {projectHeadlessAsk,validateHeadlessAskInput,headlessAskAnswers} from '../../vendor/pi-desktop/apps/desktop/shared/headless-ask-contract.ts';
const fail=code=>{throw Error('PROMO_FILE_CLARIFICATION_'+code);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
function directoryIdentity(directory){
 if(typeof directory!=='string'||!path.isAbsolute(directory))fail('ABSOLUTE_DIRECTORY_REQUIRED');
 const resolved=path.resolve(directory),info=fs.lstatSync(resolved);
 if(!info.isDirectory()||info.isSymbolicLink()||!samePath(fs.realpathSync(resolved),resolved))fail('DIRECTORY_LINK_DENIED');
 return resolved;
}
function names(directory,sessionId,requestId){const key=hash(JSON.stringify([sessionId,requestId]));return {requestFile:path.join(directory,key+'.question.json'),responseFile:path.join(directory,key+'.response.json'),receiptFile:path.join(directory,key+'.receipt.json')};}
function read(file,limit){
 const before=fs.lstatSync(file);
 if(!before.isFile()||before.isSymbolicLink()||before.size>limit)fail('FILE_INVALID');
 const fd=fs.openSync(file,'r');let bytes;
 try{
  const opened=fs.fstatSync(fd);if(!opened.isFile()||opened.ino!==before.ino||opened.size>limit)fail('FILE_CHANGED');
  const buffer=Buffer.alloc(limit+1);let count=0,n;
  do{n=fs.readSync(fd,buffer,count,buffer.length-count,count);count+=n;}while(n&&count<buffer.length);
  bytes=buffer.subarray(0,count);
 }finally{fs.closeSync(fd);}
 const after=fs.lstatSync(file);
 if(bytes.length>limit||bytes.length!==before.size||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino||after.isSymbolicLink())fail('FILE_CHANGED');
 let data;try{data=JSON.parse(bytes.toString('utf8'));}catch{fail('INVALID_JSON');}
 return {data,sha256:hash(bytes)};
}
function responseFor(ask,raw){
 const response=validateHeadlessAskInput('resolve',raw);
 if(response.sessionId!==ask.sessionId||response.requestId!==ask.requestId)fail('REQUEST_CHANGED');
 return {choices:response.choices,answers:headlessAskAnswers(ask,response.choices)};
}
/** One fresh exchange per conversation; wait until an answer or explicit cancellation. */
export function createFileClarificationExchange({directory,signal,now=Date.now,delay=sleep}){
 const checkCancelled=()=>{if(signal?.aborted)fail('CANCELLED');};checkCancelled();
 if(typeof directory!=='string'||!path.isAbsolute(directory))fail('ABSOLUTE_DIRECTORY_REQUIRED');
 const parent=directoryIdentity(path.dirname(path.resolve(directory)));
 directory=path.join(parent,path.basename(directory));
 fs.mkdirSync(directory); // Exclusive: never reuse another run's answers or receipts.
 const root=directoryIdentity(directory),owner=fs.statSync(root),records=new Map();
 const checkRoot=()=>{const current=fs.statSync(directoryIdentity(root));if(current.ino!==owner.ino||current.dev!==owner.dev||current.birthtimeMs!==owner.birthtimeMs)fail('DIRECTORY_CHANGED');};
 return Object.freeze({
  directory:root,
  publish(raw,sessionId){
   checkRoot();checkCancelled();
   const ask=projectHeadlessAsk(raw,sessionId);if(!ask)fail('QUESTION_REQUIRED');
   const files=names(root,ask.sessionId,ask.requestId),key=files.requestFile,known=records.get(key),fingerprint=JSON.stringify(ask);
   if(known){if(known.fingerprint!==fingerprint)fail('QUESTION_CHANGED');if(known.state==='consumed'||known.state==='failed')fail('ALREADY_CONSUMED');return known.ticket;}
   const request={format:'craftmine.file-clarification-request/1',...ask,publishedAt:new Date(now()).toISOString(),responseFile:files.responseFile};
   const bytes=JSON.stringify(request,null,2)+'\n';fs.writeFileSync(files.requestFile,bytes,{flag:'wx'});
   const ticket=Object.freeze({...files,sessionId:ask.sessionId,requestId:ask.requestId});
   records.set(key,{ask,fingerprint,ticket,questionHash:hash(bytes),state:'published'});return ticket;
  },
  async waitForResponse(ticket){
   const record=records.get(ticket?.requestFile);
   if(!record||JSON.stringify(record.ticket)!==JSON.stringify(ticket))fail('TICKET_INVALID');
   if(record.state!=='published')fail('ALREADY_CONSUMED');record.state='waiting';
   try{
    while(true){
     checkRoot();checkCancelled();
     if(read(ticket.requestFile,96000).sha256!==record.questionHash)fail('QUESTION_CHANGED');
     let response;try{response=read(ticket.responseFile,8192);}catch(error){if(error.code!=='ENOENT')throw error;}
     if(response){
      const selected=responseFor(record.ask,response.data);checkCancelled();
      const receipt={format:'craftmine.file-clarification-receipt/1',status:'consumed-not-submitted',sessionId:record.ask.sessionId,requestId:record.ask.requestId,questionSha256:record.questionHash,responseSha256:response.sha256,receivedAt:new Date(now()).toISOString(),...selected};
      fs.writeFileSync(ticket.receiptFile,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});record.state='consumed';
      return {ask:structuredClone(record.ask),...selected,selectionReasons:record.ask.questions.map(()=>'explicit-file-response'),responseReceipt:{...ticket,...receipt}};
     }
     await delay(250,undefined,{signal});
    }
   }catch(error){record.state='failed';if(signal?.aborted){fs.writeFileSync(ticket.receiptFile,JSON.stringify({format:'craftmine.file-clarification-receipt/1',status:'cancelled-not-submitted',sessionId:record.ask.sessionId,requestId:record.ask.requestId})+'\n',{flag:'wx'});fail('CANCELLED');}throw error;}
  },
 });
}

/** Agent-side atomic writer. Payload accepts only sessionId/requestId/choices. */
export function writeFileClarificationResponse(directory,raw){
 directory=directoryIdentity(directory);
 const input=validateHeadlessAskInput('resolve',raw),files=names(directory,input.sessionId,input.requestId);
 const request=read(files.requestFile,96000).data;
 if(request.format!=='craftmine.file-clarification-request/1'||request.responseFile!==files.responseFile)fail('QUESTION_INVALID');
 const ask=projectHeadlessAsk(request,input.sessionId);if(!ask)fail('QUESTION_REQUIRED');responseFor(ask,input);
 if(fs.existsSync(files.receiptFile))fail('ALREADY_CONSUMED');
 const temporary=path.join(directory,'.response-'+randomUUID()+'.tmp');
 try{
  fs.writeFileSync(temporary,JSON.stringify(input,null,2)+'\n',{flag:'wx'});
  // link is an exclusive, atomic publication of complete bytes on the same volume.
  fs.linkSync(temporary,files.responseFile);
 }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
 return {responseFile:files.responseFile};
}
