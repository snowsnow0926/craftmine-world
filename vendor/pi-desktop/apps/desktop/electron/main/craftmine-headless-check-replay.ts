import {readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

/** Only the protected parent IPC controller can authorize this pinned packet.
 * Never opens a Core client, finishes a job, registers or applies a candidate. */
export function readHeadlessCheckReplayPacket(directory:string,expectedHash:string|undefined){
 if(!expectedHash||!/^[a-f0-9]{64}$/.test(expectedHash))throw Error('CHECK_REPLAY_PARENT_PIN_REQUIRED');
 const file=join(directory,'replay-packet.json'),info=lstatSync(file);
 if(!info.isFile()||info.isSymbolicLink()||info.size>16*1024*1024)throw Error('INVALID_CHECK_REPLAY_PACKET');
 const bytes=readFileSync(file),sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
 if(sha(bytes)!==expectedHash)throw Error('CHECK_REPLAY_PACKET_CHANGED');
 const packet=JSON.parse(bytes.toString('utf8'));
 if(packet?.format!=='craftmine.godot-check-replay/1'||packet.diagnosticOnly!==true||packet.job?.status!=='failed'||typeof packet.checkInput!=='string'||sha(packet.checkInput)!==packet.job.checkInputHash)throw Error('INVALID_CHECK_REPLAY_PACKET');
 // The same production verifier performs full descriptor validation; keep
 // the stored raw root/snapshot/requirements untouched until that call.
 const descriptor=JSON.parse(packet.checkInput);
 if(descriptor?.format!=='craftmine.godot-check-descriptor/1'||descriptor.phase!=='check')throw Error('INVALID_CHECK_REPLAY_DESCRIPTOR');
 if(descriptor.jobId!==packet.job.id||descriptor.worldId!==packet.job.worldId||descriptor.buildId!==packet.job.buildId)throw Error('CHECK_REPLAY_JOB_IDENTITY_MISMATCH');
 return {descriptor,packetSha256:expectedHash,checkInputSha256:packet.job.checkInputHash};
}
