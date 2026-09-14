import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {register} from 'node:module';
register(new URL('./helpers/ts-import-hooks.mjs',import.meta.url));
const {readHeadlessCheckReplayPacket}=await import('../electron/main/craftmine-headless-check-replay.ts');
const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cm-replay-guard-'));
 const descriptor={format:'craftmine.godot-check-descriptor/1',phase:'check',jobId:'gjob-'+ 'a'.repeat(64),worldId:'world-a',buildId:'gbd-'+ 'b'.repeat(64),root:'\\\\?\\D:\\original\\artifacts',snapshot:{original:true},artifacts:[{path:'web/index.html',bytes:1,sha256:'c'.repeat(64)}]};
 const checkInput=JSON.stringify(descriptor),packet={format:'craftmine.godot-check-replay/1',diagnosticOnly:true,job:{id:descriptor.jobId,worldId:descriptor.worldId,buildId:descriptor.buildId,status:'failed',checkInputHash:sha(checkInput)},checkInput};
 const write=()=>{const bytes=JSON.stringify(packet);fs.writeFileSync(path.join(dir,'replay-packet.json'),bytes);return sha(bytes);};
 return {dir,descriptor,packet,write};
}
test('pinned stored descriptor is passed without modifying original root, artifacts or snapshot',()=>{
 const f=fixture();const hash=f.write(),before=fs.readFileSync(path.join(f.dir,'replay-packet.json'));
 const result=readHeadlessCheckReplayPacket(f.dir,hash);assert.deepEqual(result.descriptor,f.descriptor);assert.equal(result.packetSha256,hash);assert.deepEqual(fs.readFileSync(path.join(f.dir,'replay-packet.json')),before);
});
test('parent pin required and mismatch rejected before verifier dispatch',()=>{
 const f=fixture();f.write();assert.throws(()=>readHeadlessCheckReplayPacket(f.dir),/PARENT_PIN_REQUIRED/);assert.throws(()=>readHeadlessCheckReplayPacket(f.dir,'0'.repeat(64)),/PACKET_CHANGED/);
});
test('nonfailed jobs, changed raw input and mismatched job identity are refused',()=>{
 for(const mutate of [p=>{p.job.status='passed';},p=>{p.checkInput+=' ';},p=>{p.job.id='wrong';},p=>{p.diagnosticOnly=false;}]){const f=fixture();mutate(f.packet);assert.throws(()=>readHeadlessCheckReplayPacket(f.dir,f.write()));}
});
