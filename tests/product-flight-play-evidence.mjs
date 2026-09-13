// Read-only verification of this actual operator run. Never dispatches input.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const out=path.resolve(process.argv[2]??'');
assert(path.basename(out).startsWith('desktop-native-product-'),'dedicated operator evidence root required');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const rows=[];
const responses=new Map();
const allowed=new Set(['resume','explore','input-segment','snapshot','capture','save','reopen','status']);
for(let number=1;number<=104;number++){
  const id='play-'+String(number).padStart(3,'0');
  const file=path.join(out,'responses',id+'.json');
  const bytes=fs.readFileSync(file),response=JSON.parse(bytes);
  const request=JSON.parse(fs.readFileSync(path.join(out,'inbox',id+'.json')));
  assert.equal(response.id,id);assert.equal(response.status,'completed');
  assert(allowed.has(request.command));assert.equal(response.command,request.command);
  const result=response.result;responses.set(number,result);
  const row={id,command:request.command,file,sha256:sha(bytes),startedAt:response.startedAt,finishedAt:response.finishedAt};
  if(request.command==='input-segment'){
    assert.equal(result.status,'completed');assert.equal(result.release.released,true);
    // An empty segment has no keyup receipt: its actual empty delivery is evidence.
    if(!result.release.receipt)assert.deepEqual(request.args.segment.keys,[]);
    const released=result.release.receipt??result.delivery;
    assert.deepEqual(released.held,{keys:[],buttons:[]});
    assert.deepEqual(released.guard,{pointerLock:0,focus:0});
    assert(result.operatorCheckpoint.receipt.snapshotHash);
    assert.equal(result.operatorCheckpoint.continuousHumanPlay,false);
    assert.equal(result.operatorCheckpoint.snapshot.state.body.worldId,result.identity.worldId);
    row.identity=result.identity;row.segment=request.args.segment;
    row.checkpoint=result.operatorCheckpoint.receipt;
    row.body=result.operatorCheckpoint.snapshot.state.body;
    row.frames=[];
    for(const phase of ['before','during','after']){
      const frame=result[phase]?.frame;if(!frame?.file)continue;
      assert.equal(sha(fs.readFileSync(frame.file)),frame.sha256);
      row.frames.push({phase,file:frame.file,sha256:frame.sha256,capturedAt:frame.capturedAt});
    }
  }
  rows.push(row);
}
const body=n=>responses.get(n).operatorCheckpoint.snapshot.state.body;
const aircraft='ins-1f469382cd78cdfa61ee927d-e0',pet='ins-41d4d88059c4ba486b108f6e-e0';
const plane=n=>body(n).components[aircraft],dog=n=>body(n).components[pet];
assert.deepEqual(body(9).inventory,{});assert.equal(plane(9).piloted,false);
assert.equal(dog(19).interactionCount,1);assert.equal(dog(20).settings.following,false);
assert.deepEqual(body(14).player.position,body(16).player.position,'preserve actual pet obstruction evidence');
assert(body(22).player.position[0]<body(21).player.position[0]-50,'actual road bypass');
for(const [first,repeated,id]of [[30,31,'org-flight-compass'],[35,36,'org-flight-chart'],[44,45,'org-flight-clearance']]){
  assert.equal(body(first).inventory[id],1);assert.equal(body(repeated).inventory[id],1);
}
assert(body(40).player.position[1]>7&&body(41).player.position[1]>11);
assert.equal(plane(62).piloted,true);assert.equal(plane(65).grounded,true);
assert.equal(plane(66).grounded,false);assert.equal(plane(66).hasFlown,true);
assert.equal(plane(75).grounded,true);assert.equal(plane(75).landings,1);
for(let n=62;n<=98;n++)assert.equal(plane(n).crashed,false);
assert.equal(plane(96).airspeed,0);assert.equal(plane(96).throttle,0);
assert.equal(plane(97).piloted,false);
assert(Math.hypot(plane(97).position[0]-400,plane(97).position[2]-60)<18);
assert(body(98).player.position[2]>body(97).player.position[2]+1,'walking controller restored');
const cold=responses.get(100),final=responses.get(102).state.body;
assert.notEqual(cold.before.instanceId,cold.after.instanceId);
assert.equal(cold.before.buildId,cold.after.buildId);
assert.deepEqual(cold.savedSnapshot.state.body,cold.snapshot.state.body);
assert.deepEqual(final,cold.snapshot.state.body);
assert.deepEqual(final.inventory,body(45).inventory);
assert.deepEqual(final.components[pet],dog(20));
assert.equal(responses.get(101).instanceId,cold.after.instanceId);
const capture=responses.get(103);assert.equal(sha(fs.readFileSync(capture.file)),capture.sha256);
console.log(JSON.stringify({format:'craftmine.actual-flight-play-evidence/1',scope:'2026-09-14 city flight operator play-001..104',verified:true,continuousHumanPlay:false,limitations:['分段之间使用普通存档冻结；不能代替无暂停手感或性能验收。','飞机仅完成一次同跑道短直线起降；未验证空中转弯或高空航线。','博美真实身体阻挡过直线路径；正常抚摸、等待及侧移可绕行。','截图和checkpoint分属真实不同时刻，采样会推进运行，不能把requested frames当精确物理时长。','后续天气/目标编辑及模板发布属于独立验收。'],identity:capture.identity,finalBody:final,finalCapture:capture,raw:rows},null,2));
