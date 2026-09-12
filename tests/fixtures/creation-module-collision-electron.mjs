import {app,BrowserWindow,session,webContents} from 'electron';import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {GodotBuildVerifier} from '../../vendor/pi-desktop/apps/desktop/electron/main/godot-build-verifier';
import {GodotWorldViewHost} from '../../vendor/pi-desktop/apps/desktop/electron/main/godot-world-view-host';
const out=process.env.CRAFTMINE_COLLISION_OUT,report={passed:false,checks:[],scope:'actual production verifier and latest-progress candidate stage; authored descriptors and no core commit'};let host,owner;
const write=()=>fs.writeFileSync(path.join(out,'electron-report.json'),JSON.stringify(report,null,2));
const fail=async error=>{report.error=String(error.stack||error);write();try{await host?.dispose();owner?.destroy();}finally{app.exit(1);}};
process.on('uncaughtException',fail);process.on('unhandledRejection',fail);app.on('window-all-closed',()=>{});
app.commandLine.appendSwitch('enable-unsafe-swiftshader');app.commandLine.appendSwitch('use-angle','swiftshader');
app.on('session-created',ses=>{ses.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'../preload/craftmine-headless.cjs')});ses.setPermissionRequestHandler((_a,_b,callback)=>callback(false));});
app.whenReady().then(async()=>{
 const projects=JSON.parse(fs.readFileSync(path.join(out,'cases.json'))),get=name=>projects.find(p=>p.variant===name).descriptor;
 for(const name of ['candidate','blocked']){
  const descriptor={...get(name),format:'craftmine.godot-check-descriptor/1',phase:'check',jobId:'gjob-'+createHash('sha256').update(name).digest('hex'),inputHash:'a'.repeat(64)};
  const evidence=await new GodotBuildVerifier({deadlineMs:120000}).check(descriptor);report.checks.push({case:name,evidence});write();assert.equal(evidence.passed,name==='candidate',JSON.stringify(evidence));assert.equal(evidence.recovery.ok,true);
  if(name==='blocked')assert.match(evidence.error,/CREATION_COLLISION_GUARD_FAILED:PLAYER_PENETRATION/);
 }
 owner=new BrowserWindow({show:false,focusable:false,width:1000,height:700,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,sandbox:true}});await owner.loadFile(path.join(__dirname,'owner.html'));
 host=new GodotWorldViewHost({window:()=>owner,allowedRoots:()=>projects.map(p=>p.descriptor.root),progress:async()=>{throw Error('Formal progress writes forbidden in this fixture');}});host.setBounds({x:0,y:0,width:960,height:640});host.setVisible(true);
 await host.ensure(get('formal'));
 assert.deepEqual((await host.snapshot()).state,get('formal').snapshot);
 report.savedFloor={requested:get('formal').snapshot.body.player.position,restored:(await host.snapshot()).state.body.player.position};
 await host.resume();await host.request('walk',{forward:1,right:0,frames:60});await host.pause();
 const latest=await host.snapshot(),position=latest.state.body.player.position;assert.ok(position[2]<3.5&&position[2]>0,'actual walk must enter the proposed building footprint');const original=host.instance;
 const changed={...get('candidate'),snapshot:latest.state,revision:1};
 await assert.rejects(host.stageCandidate(changed),/CREATION_COLLISION_GUARD_FAILED:PLAYER_PENETRATION/);
 assert.deepEqual(host.instance,original);assert.equal(host.candidateInstance,null);assert.deepEqual((await host.snapshot()).state,latest.state);
 report.latestProgress={position,stageRejected:true,formalInstanceRetained:true,formalSnapshotUnchanged:true};
 await host.dispose();
 host=new GodotWorldViewHost({window:()=>owner,allowedRoots:()=>projects.map(p=>p.descriptor.root),progress:async()=>{throw Error('Formal progress writes forbidden in this fixture');}});host.setBounds({x:0,y:0,width:960,height:640});host.setVisible(true);
 await host.ensure({...get('formal'),snapshot:latest.state,revision:1});
 const reopened=await host.snapshot();assert.deepEqual(reopened.state,latest.state);
 report.reopenedProgress={requested:latest.state.body.player,restored:reopened.state.body.player,exactSnapshot:true};
 report.guards=[];for(const contents of webContents.getAllWebContents()){if(contents.isDestroyed()||!contents.getURL().startsWith('http'))continue;const guard=await contents.executeJavaScript('globalThis.__craftmineHeadless',false);assert.deepEqual(guard,{pointerLock:0,focus:0});report.guards.push(guard);assert.equal(contents.isOffscreen(),true);}
 assert.equal(owner.isVisible(),false);assert.equal(owner.isFocusable(),false);await host.dispose();host=null;owner.destroy();owner=null;report.passed=true;write();app.exit(0);
}).catch(fail);
