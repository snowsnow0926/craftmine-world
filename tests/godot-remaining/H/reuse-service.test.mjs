import test from 'node:test';
import assert from 'node:assert/strict';
import {createReuseService,explain,compatibilityMatrix,migrationReport} from '../../../plugins/craftmine-world/reuse-service.mjs';

const HASH='a'.repeat(64);
const ref={id:'saved-'+'b'.repeat(32),version:2,hash:HASH};
const target={base:'top-down',baseVersion:'1.0.0',engine:'4.7.2-stable',stateFormat:'craftmine.godot-progress/1'};

// Fake host channel: records every call and answers with canned data. Pure in-memory.
function harness(){
  const recorded=[];
  const canned={'package.check':{ref,compatible:true,reasons:[],closure:[ref]},
    'package.upgrade':{fromRef:ref,toRef:{...ref,version:3},fromStateVersion:1,toStateVersion:2,migration:[],preservedOnce:[]}};
  const call=async(channel,args)=>{recorded.push({channel,args});return canned[channel]??{channel};};
  return {service:createReuseService({call}),recorded};
}

test('every service method forwards to its dotted channel with the exact args object',async()=>{
  const {service,recorded}=harness();
  const calls=[
    ['check',{ref,target}],
    ['install',{operationId:'op-install',ref,worldId:'world-1',mode:'copy',sourceInstanceId:'ins-source',position:{x:1,y:2,z:3}}],
    ['list',{worldId:'world-1',status:'installed',offset:0,limit:10}],
    ['read',{instanceId:'ins-1'}],
    ['progress',{operationId:'op-progress',instanceId:'ins-1',revision:0,state:{format:'craftmine.package-state/1'}}],
    ['grant',{operationId:'op-grant',instanceId:'ins-1',key:'once-chest',reward:{item:'apple',count:1}}],
    ['upgrade',{operationId:'op-upgrade',instanceId:'ins-1',toRef:{...ref,version:3}}],
    ['uninstall',{operationId:'op-uninstall',instanceId:'ins-1',expectedRevision:4}],
    ['restore',{operationId:'op-restore',instanceId:'ins-1'}],
    ['exportPackage',{operationId:'op-export',instanceId:'ins-1'}],
    ['importPackage',{operationId:'op-import',package:{format:'craftmine.work-package/1',ref}}],
    ['usage',{ref}],
    ['backupFull',{operationId:'op-backup'}],
    ['backupVerify',{archive:{format:'craftmine.complete-backup/1',files:[]}}],
    ['backupRestoreFull',{operationId:'op-restore-full',archive:{format:'craftmine.complete-backup/1'},expectedCurrentHash:HASH}],
    ['legacyConvert',{operationId:'op-legacy',importId:'legacy-1',title:'旧世界',compiled:{format:'craftmine.scene/3'}}],
  ];
  for(const [method,args] of calls)await service[method](args);
  assert.deepEqual(recorded.map(item=>item.channel),['package.check','package.install','package.list','package.read','package.progress','package.grant','package.upgrade','package.uninstall','package.restore','package.export','package.import','package.usage','backup.export-full','backup.verify','backup.restore-full','legacy.convert']);
  calls.forEach(([,args],index)=>assert.equal(recorded[index].args,args));
  service.explain('REPLAY_MISMATCH');
  assert.equal(recorded.length,calls.length);
});

test('unknown fields are rejected before any host call',async()=>{
  const {service,recorded}=harness();
  await assert.rejects(service.install({operationId:'op',ref,worldId:'w',mode:'initial',position:{x:0,y:0,z:0},extra:true}),/UNKNOWN_FIELD/);
  await assert.rejects(service.check({ref,target,extra:true}),/UNKNOWN_FIELD/);
  await assert.rejects(service.check({ref,target:{...target,sceneFormat:'craftmine.godot-scene/1'}}),/UNKNOWN_FIELD/);
  await assert.rejects(service.list({offset:0,limit:5,extra:true}),/UNKNOWN_FIELD/);
  await assert.rejects(service.backupVerify({archive:{},extra:true}),/UNKNOWN_FIELD/);
  assert.equal(recorded.length,0);
});

test('install modes require or forbid the source instance',async()=>{
  const {service,recorded}=harness();
  await assert.rejects(service.install({operationId:'op-copy',ref,worldId:'w',mode:'copy'}),/SOURCE_INSTANCE_REQUIRED/);
  await assert.rejects(service.install({operationId:'op-initial',ref,worldId:'w',mode:'initial',sourceInstanceId:'ins-source'}),/UNKNOWN_FIELD/);
  await assert.rejects(service.install({operationId:'op-mode',ref,worldId:'w',mode:'clone'}),/INVALID_MODE/);
  assert.equal(recorded.length,0);
});

test('refs, placements, pages, packages and hashes are strictly validated',async()=>{
  const {service}=harness();
  await assert.rejects(service.check({ref:{id:'saved-x',version:1,hash:'abc'},target}),/INVALID_REFERENCE/);
  await assert.rejects(service.check({ref:{id:'saved-x',hash:HASH},target}),/INVALID_REFERENCE/);
  await assert.rejects(service.usage({ref:{id:'saved-x',version:0,hash:HASH}}),/INVALID_REFERENCE/);
  await assert.rejects(service.install({operationId:'op',ref,worldId:'w',mode:'initial',position:{x:1,y:2}}),/INVALID_PLACEMENT/);
  await assert.rejects(service.install({operationId:'op',ref,worldId:'w',mode:'initial',position:{x:81,y:2,z:3}}),/INVALID_PLACEMENT/);
  await assert.rejects(service.importPackage({operationId:'op',package:{format:'craftmine.work-package/2'}}),/INVALID_PACKAGE/);
  await assert.rejects(service.backupRestoreFull({operationId:'op',archive:{},expectedCurrentHash:'abc'}),/INVALID_HASH/);
  await assert.rejects(service.list({offset:-1,limit:5}),/INVALID_PAGE/);
  await assert.rejects(service.list({offset:0,limit:51}),/INVALID_PAGE/);
  await assert.rejects(service.legacyConvert({operationId:'op',importId:'legacy-1',title:''}),/INVALID_TITLE/);
  await assert.rejects(service.progress({operationId:'op',instanceId:'ins-1',revision:-1,state:{}}),/INVALID_REVISION/);
  await assert.rejects(service.progress({operationId:'op',instanceId:'ins-1',revision:0,state:[]}),/INVALID_STATE/);
});

test('explain is pure offline Chinese text and strips the detail suffix',()=>{
  const loss=explain('PACKAGE_MIGRATION_WOULD_LOSE_PROGRESS: objects.door.health');
  assert.equal(loss.code,'PACKAGE_MIGRATION_WOULD_LOSE_PROGRESS');
  assert.equal(loss.unknown,false);
  assert.match(loss.title,/进度/);
  assert.match(loss.detail,/[\u4e00-\u9fa5]/);
  assert.match(loss.action,/[\u4e00-\u9fa5]/);
  const unknown=explain('SOMETHING_NEW: boom');
  assert.deepEqual(unknown,{code:'SOMETHING_NEW',title:'SOMETHING_NEW',detail:'未收录的错误码',action:'请把原始错误码反馈给开发',unknown:true});
});

test('compatibilityMatrix reports each dimension plus the dependency count',()=>{
  const failed=compatibilityMatrix({ref,compatible:false,reasons:['PACKAGE_INCOMPATIBLE_BASE: top-down/realistic'],closure:[ref]});
  assert.equal(failed.compatible,false);
  const base=failed.rows.find(row=>row.name==='base');
  assert.equal(base.passed,false);
  assert.match(base.value,/top-down\/realistic/);
  assert.equal(failed.rows.find(row=>row.name==='engine').passed,true);
  assert.equal(failed.rows.find(row=>row.name==='dependencies').value,'1');
  const clean=compatibilityMatrix({ref,compatible:true,reasons:[],closure:[]});
  assert.equal(clean.compatible,true);
  assert.ok(clean.rows.every(row=>row.passed));
  assert.deepEqual(clean.rows.map(row=>row.name),['base','baseVersion','engine','stateFormat','sceneFormat','dependencies']);
});

test('migrationReport counts applied operations and warns when the once-ledger is empty',()=>{
  const report=migrationReport({fromRef:ref,toRef:{...ref,version:3},fromStateVersion:1,toStateVersion:2,
    migration:[{op:'rename'},{op:'add'},{op:'add'},{op:'preserve'}],preservedOnce:[]});
  assert.equal(report.rows.find(row=>row.name==='op:add').value,'2');
  assert.equal(report.rows.find(row=>row.name==='op:rename').value,'1');
  assert.equal(report.rows.find(row=>row.name==='fromRef').value,`${ref.id}@2`);
  assert.equal(report.rows.find(row=>row.name==='toStateVersion').value,'2');
  assert.equal(report.rows.find(row=>row.name==='preservedOnce').value,'0');
  assert.equal(report.warnings.length,1);
  assert.match(report.warnings[0],/一次性奖励/);
  const kept=migrationReport({fromRef:ref,toRef:{...ref,version:3},fromStateVersion:1,toStateVersion:2,migration:[],preservedOnce:[{key:'once-chest'}]});
  assert.deepEqual(kept.warnings,[]);
  assert.equal(kept.rows.find(row=>row.name==='preservedOnce').value,'1');
});

test('service surface is pure logic and helpers never touch the host channel',async()=>{
  assert.throws(()=>createReuseService({}),/DOMAIN_CALL_REQUIRED/);
  const {service,recorded}=harness();
  assert.deepEqual(Object.keys(service).sort(),['backupFull','backupRestoreFull','backupVerify','check','explain','exportPackage','grant','importPackage','install','legacyConvert','list','progress','read','restore','uninstall','upgrade','usage']);
  assert.equal(service.explain('REPLAY_MISMATCH') instanceof Promise,false);
  assert.equal(compatibilityMatrix({compatible:true,reasons:[],closure:[]}) instanceof Promise,false);
  assert.equal(migrationReport({}) instanceof Promise,false);
  assert.equal(recorded.length,0);
});
