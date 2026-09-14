import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {randomUUID} from 'node:crypto';
import {canonicalJSON} from '../app/canonical.mjs';
import {GameplaySession} from '../app/gameplay.mjs';
import {BehaviorState} from '../app/behavior-state.mjs';
const file=new URL('../plugins/craftmine-world/view.mjs',import.meta.url),source=fs.readFileSync(file,'utf8');
const slice=(from,to)=>{const begin=source.indexOf(from),end=source.indexOf(to,begin);assert.ok(begin>=0&&end>begin);return source.slice(begin,end);};
const snapshot=()=>({format:'craftmine.progress/3',player:{x:.5,y:6,z:12.5,yaw:0,pitch:0},gameplay:{systems:{},targets:{},equipped:null,archivedTargets:{},cooldown:0},behaviors:{format:'craftmine.behavior-state/2',time:0,modules:{},inventory:{wood:2},archive:[{id:'a',record:{state:{first:1,second:2}}},{id:'b',record:{state:{first:3,second:4}}}]}});
function fixture(saved=snapshot()){
 const state={live:structuredClone(saved),saves:0,failSave:false};
 const code=`let current,loaded=false,lastSaved='',nonce,godotIdentity,checkWorld,checkOffset;
 let godot=false,applicationAttempt=null,restoreOperation=null,closing=false,preview=null,recoverySequence=0;
 const requests=new Map();
 ${slice('function mount(record) {','\n  godot=isGodotWorld(record);')}\n}
 ${slice('async function save({freeze=false,background=false}={}) {','\nfunction cancelClose()')}
 ${slice('async function beginRestore({operationId}) {','\nasync function finishRestore')}
 function cancelClose(){closing=false;}
 ({save,beginRestore,mount(record){mount(record);loaded=true;},saved:()=>lastSaved,closed:()=>closing});`;
 const api=vm.runInNewContext(code,{canonicalJSON,crypto:{randomUUID},creationGuide:null,closePreview(){},setMode(){},clearTimeout,document:{getElementById:()=>({replaceChildren(){}})},controls(){},send(){},status:{textContent:''},snapshot:async()=>({snapshot:structuredClone(state.live)}),bridge:{invoke:async(method,args)=>{assert.equal(method,'world.saveProgress');state.saves++;if(state.failSave)throw Error('save failed');return {id:'world',revision:state.saves,world:{build:{id:'build'},snapshot:structuredClone(args.snapshot)}};}}});
 api.mount({id:'world',revision:0,world:{build:{id:'build'},snapshot:saved}});return {state,api};
}
test('recursive key order normalization keeps array order and JSON values strict',()=>{
 const original=snapshot(),sorted=JSON.parse(canonicalJSON(original));
 assert.notEqual(JSON.stringify(original),JSON.stringify(sorted));assert.equal(canonicalJSON(original),canonicalJSON(sorted));
 for(const change of [v=>v.player.x++,v=>v.behaviors.time++,v=>v.behaviors.inventory.wood++,v=>v.behaviors.archive.reverse(),v=>v.behaviors.archive[0].record.state.first='1',v=>v.gameplay.equipped=false,v=>delete v.gameplay.cooldown,v=>v.format='craftmine.progress/2']){
  const changed=structuredClone(original);change(changed);assert.notEqual(canonicalJSON(original),canonicalJSON(changed));
 }
});
test('actual view mount/save/restore accepts only key-reordered state without unnecessary save',async()=>{
 const live=snapshot(),f=fixture(JSON.parse(canonicalJSON(live)));f.state.live=live;
 await f.api.save();assert.equal(f.state.saves,0);
 const restored=await f.api.beginRestore({operationId:'restore-key-order'});assert.equal(restored.locked,true);
});
test('actual restore rejects unsaved player, inventory, time and array changes and unlocks on failure',async()=>{
 for(const change of [v=>v.player.y++,v=>v.behaviors.inventory.wood++,v=>v.behaviors.time++,v=>v.behaviors.archive.reverse()]){
  const f=fixture();change(f.state.live);await assert.rejects(f.api.beginRestore({operationId:'restore-dirty-state'}),/BACKUP_PROGRESS_CHANGED_REINSPECT/);assert.equal(f.api.closed(),false);assert.equal(f.state.saves,0);
 }
});
test('successful save updates the same canonical baseline; failed save never advances it',async()=>{
 const f=fixture(),prior=f.api.saved();f.state.live.behaviors.inventory.wood++;f.state.failSave=true;
 await assert.rejects(f.api.save(),/save failed/);assert.equal(f.api.saved(),prior);
 f.state.failSave=false;await f.api.save();assert.equal(f.api.saved(),canonicalJSON(f.state.live));
 f.state.live=JSON.parse(canonicalJSON(f.state.live));assert.equal((await f.api.beginRestore({operationId:'restore-after-save'})).locked,true);
});
test('first-load schema defaults remain a real unsaved difference until explicitly persisted',async()=>{
 const saved={format:'craftmine.progress/1',player:snapshot().player},f=fixture(saved);f.state.live=snapshot();
 await assert.rejects(f.api.beginRestore({operationId:'restore-new-defaults'}),/REINSPECT/);
 await f.api.save({freeze:true});assert.equal(f.state.saves,1);assert.equal((await f.api.beginRestore({operationId:'restore-saved-defaults'})).locked,true);
});
if(process.env.CRAFTMINE_LEGACY_SNAPSHOT_DB)test('actual failed legacy profile matches runtime semantics after normalization',async()=>{
 const {DatabaseSync}=await import('node:sqlite'),file=process.env.CRAFTMINE_LEGACY_SNAPSHOT_DB;assert.ok(path.isAbsolute(file));
 const db=new DatabaseSync(file,{readOnly:true});let world;try{const rows=db.prepare('SELECT document FROM craftmine_worlds').all();assert.equal(rows.length,1);world=JSON.parse(rows[0].document);}finally{db.close();}
 assert.equal(world.build.scene.format,'craftmine.scene/3');assert.equal(world.build.behaviors.length,0);
 const saved=world.snapshot,play=new GameplaySession(world.build.scene.systems,world.build.scene.objects,saved.gameplay),behavior=new BehaviorState(world.build,saved.behaviors,play.state);
 const actual={format:'craftmine.progress/3',player:{...saved.player},gameplay:play.snapshot(),behaviors:behavior.snapshot()};
 assert.deepEqual(saved,actual);assert.notEqual(JSON.stringify(saved),JSON.stringify(actual));assert.equal(canonicalJSON(saved),canonicalJSON(actual));
 const f=fixture(saved);f.state.live=actual;assert.equal((await f.api.beginRestore({operationId:'restore-real-snapshot'})).locked,true);
 console.log(JSON.stringify({scope:'read-only database + production state constructors + actual view comparison, no profile launch',semanticEqual:true,stringEqual:false,canonicalEqual:true}));
});
