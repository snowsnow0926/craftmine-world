// Read an explicitly authorized, completed acceptance core directory only.
// Copy first; never start a process on the archive or read its sibling profile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
const args=Object.fromEntries(process.argv.slice(2).reduce((list,item,i,all)=>i%2?list:[...list,[item,all[i+1]]],[]));
for(const flag of ['--source-core','--binary','--deps-root','--world'])assert.ok(args[flag],`Required ${flag}`);
const source=path.resolve(args['--source-core']),binary=path.resolve(args['--binary']),worldId=args['--world'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function inventory(directory,prefix=''){
  const result=[];
  assert.ok(fs.lstatSync(directory).isDirectory()&&!fs.lstatSync(directory).isSymbolicLink());
  for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const file=path.join(directory,entry.name),relative=prefix+entry.name,stat=fs.lstatSync(file);
    assert.ok(!stat.isSymbolicLink(),`Linked entry rejected: ${relative}`);
    if(stat.isDirectory())result.push(...inventory(file,relative+'/'));
    else {assert.ok(stat.isFile()&&stat.nlink===1,`Nonregular entry rejected: ${relative}`);result.push({path:relative,bytes:stat.size,sha256:hash(fs.readFileSync(file))});}
  }return result;
}
assert.ok(fs.existsSync(path.join(source,'tasks.sqlite')),'Expected exact Craftmine core directory');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/version-diff-applied-'));
const report={format:'craftmine.version-diff-applied-core/1',source,worldId,binarySha256:hash(fs.readFileSync(binary)),checks:[],limits:['The source is a copy of an earlier real broker/candidate/adoption acceptance; this run launches Rust only.','No model, engine, renderer, or credentials are used in this additional archive check.']};
const before=inventory(source);
fs.cpSync(source,path.join(out,'core'),{recursive:true,errorOnExist:true,force:false});
assert.deepEqual(inventory(path.join(out,'core')),before);
const require=createRequire(import.meta.url),{CoreClient}=require('../../plugins/craftmine-world/core-client.cjs');
const {build}=createRequire(path.join(path.resolve(args['--deps-root']),'vendor/pi-desktop/packages/agent-runtime/package.json'))('esbuild');
await build({entryPoints:[path.join(root,'vendor/pi-desktop/apps/desktop/electron/main/godot-history-panel-service.ts')],bundle:true,platform:'node',format:'esm',outfile:path.join(out,'service.mjs')});
const {createGodotHistoryPanelService}=await import(pathToFileURL(path.join(out,'service.mjs')));
let core=new CoreClient(binary,path.join(out,'core'));
const calls=[],check=(name,passed)=>{report.checks.push({name,passed:!!passed});assert.ok(passed,name);console.log('PASS '+name);};
const service=createGodotHistoryPanelService({selection:async()=>worldId,domain:async(method,params)=>{calls.push(method);assert.ok(!['turn.begin','workspace.endTurn'].includes(method));return core.call(method,params,60000);}});
try{
  await core.start();
  const world=await core.call('world.read',{id:worldId}),db=await core.call('backup.status',{});
  const view=await service.invoke('godot.historyLoad',{worldId});
  report.view=view;
  check('actual adopted world has an authoritative formal Git commit',/^[a-f0-9]{40,64}$/.test(view.appliedOid));
  const older=view.history.records.find(record=>record.oid!==view.appliedOid);assert.ok(older,'Actual earlier source version');
  const changes=await service.invoke('godot.historyCompare',{worldId,viewId:view.viewId,targetOid:older.oid});report.changes=changes;
  check('actual adopted formal source differs from earlier source',changes.total>0&&changes.fromOid===view.appliedOid);
  const textPath=changes.changes.find(item=>item.path.endsWith('.tscn'))?.path;assert.ok(textPath,'Real changed scene');
  report.diff=await service.invoke('godot.historyDiff',{worldId,viewId:view.viewId,targetOid:older.oid,path:textPath});
  check('real scene diff carries parameter source history',report.diff.kind==='text'&&report.diff.patch.includes('hit_flash_seconds'));
  check('reads preserve full progress, source and DB fingerprint',JSON.stringify(await core.call('world.read',{id:worldId}))===JSON.stringify(world)&&(await core.call('backup.status',{})).currentHash===db.currentHash);
  await core.stop();core=new CoreClient(binary,path.join(out,'core'));await core.start();
  const reopened=await service.invoke('godot.historyLoad',{worldId});
  check('full Rust restart preserves exact formal and branch identities',reopened.appliedOid===view.appliedOid&&reopened.headOid===view.headOid&&JSON.stringify(await core.call('world.read',{id:worldId}))===JSON.stringify(world));
}catch(error){report.error=String(error);throw error;}
finally{
  await core.stop();report.archiveUnchanged=JSON.stringify(inventory(source))===JSON.stringify(before);assert.ok(report.archiveUnchanged);
  fs.writeFileSync(path.join(out,'source-index.json'),JSON.stringify(before,null,2));
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({...report,calls},null,2));console.log('Evidence: '+out);
}
