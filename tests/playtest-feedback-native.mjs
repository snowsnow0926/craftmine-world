// Real Rust stdio/SQLite and selected-file transport; no engine/gameplay claim.
import assert from 'node:assert/strict';import {createRequire,register} from 'node:module';import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';import {join,resolve,isAbsolute} from 'node:path';import {createHash} from 'node:crypto';
register(new URL('../vendor/pi-desktop/apps/desktop/test/helpers/ts-import-hooks.mjs',import.meta.url));
const {CoreClient}=createRequire(import.meta.url)('../plugins/craftmine-world/core-client.cjs');
const {createPlaytestFeedbackPanel}=await import('../vendor/pi-desktop/apps/desktop/electron/main/playtest-feedback-panel.ts');
const binary=process.env.CRAFTMINE_CORE_BINARY;if(!binary||!isAbsolute(binary))throw Error('CRAFTMINE_CORE_BINARY required');
const out=resolve('test-results');await mkdir(out,{recursive:true});const data=await mkdtemp(join(out,'playtest-native-'));
const friend=new CoreClient(binary,join(data,'friend')),author=new CoreClient(binary,join(data,'author'));let file=join(data,'feedback.json');
const world={build:{id:'fixture-build',scene:{format:'craftmine.scene/3',objects:[]},godot:{engineVersion:'fixture-engine'}},snapshot:{format:'craftmine.progress/1',baseId:'fixture-base',baseVersion:'1',player:{x:0.5,y:6,z:12.5,yaw:0,pitch:0}},extensions:[]};
const panel=(core,worldId)=>createPlaytestFeedbackPanel({domain:(method,args)=>core.call(method,args),selection:async()=>worldId,blocked:()=>false,client:{version:'feedback-storage-fixture'},capture:async()=>{throw Error('Not requested');},pick:async()=>file});
try {
 await friend.start();await author.start();await friend.call('world.create',{id:'friend-world',title:'Friend fixture',world});await author.call('world.create',{id:'author-world',title:'Author fixture',world});
 const fp=panel(friend,'friend-world'),ap=panel(author,'author-world');
 const preview=await fp.request('playtest.preview',{worldId:'friend-world',description:'Door blocks the player',expected:'Walk through',includeScreenshot:false});
 const autosaved=structuredClone(world.snapshot);autosaved.player.x=2;
 await friend.call('world.saveProgress',{id:'friend-world',revision:0,baseBuild:'fixture-build',snapshot:autosaved});
 const exported=await fp.request('playtest.export',{worldId:'friend-world',previewId:preview.previewId});assert.equal(exported.status,'completed');
 assert.deepEqual(JSON.parse(await readFile(file)),preview.report);assert.equal(preview.report.context.worldRevision,0);
 assert.equal((await friend.call('playtest.list',{worldId:'friend-world'})).items.length,1);
 const importPreview=await ap.request('playtest.importPreview',{worldId:'author-world'});assert.deepEqual(importPreview.report,preview.report);
 const commit=await ap.request('playtest.importCommit',{worldId:'author-world',previewId:importPreview.previewId});assert.equal(commit.reused,false);
 assert.equal((await ap.request('playtest.importCommit',{worldId:'author-world',previewId:importPreview.previewId})).reused,true);
 await author.stop();await author.start();assert.deepEqual(await author.call('playtest.read',{worldId:'author-world',id:preview.report.id}),preview.report);
 const reply=await ap.request('playtest.preview',{worldId:'author-world',description:'Please try the new template version',expected:'Door has been moved; retest passage',replyTo:preview.report.id,includeScreenshot:false});
 file=join(data,'reply.json');await ap.request('playtest.export',{worldId:'author-world',previewId:reply.previewId});
 const received=await fp.request('playtest.importPreview',{worldId:'friend-world'});await fp.request('playtest.importCommit',{worldId:'friend-world',previewId:received.previewId});assert.equal(received.report.replyTo,preview.report.id);
 const changed=JSON.parse(await readFile(file));changed.description='tampered';await writeFile(file,JSON.stringify(changed));await assert.rejects(fp.request('playtest.importPreview',{worldId:'friend-world'}),/PLAYTEST_INVALID_REPORT/);
 const result={passed:true,scope:'native-rust-storage-and-file-roundtrip',enginePlayed:false,modelCalls:0,originalId:preview.report.id,replyId:reply.report.id,coreSha256:createHash('sha256').update(await readFile(binary)).digest('hex')};await writeFile(join(data,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({data,...result}));
}finally{await friend.stop();await author.stop();}
