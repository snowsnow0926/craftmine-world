// Reproduce real retained first-load through normal (not offscreen) native views.
// Only copied artifacts and the original saved snapshot are used. No OS input.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {createRequire} from 'node:module';import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),source=process.argv[2];assert.ok(source,'Pass the read-only player profile');
const req=createRequire(path.join(root,'vendor/pi-desktop/apps/desktop/package.json')),{build}=req('esbuild');
const electron=process.env.FB03_ELECTRON??createRequire('D:/Craftmine World/vendor/pi-desktop/apps/desktop/package.json')('electron');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/fb03-normal-staging-'));
const data=path.join(source,'plugins/data/craftmine.world'),db=new DatabaseSync(path.join(data,'tasks.sqlite'),{readOnly:true}),worldId='world-b7608e2da8e8';
const app=db.prepare('SELECT build_id,input FROM craftmine_godot_applications WHERE world_id=? ORDER BY rowid DESC LIMIT 1').get(worldId);assert.ok(app);
const job=db.prepare('SELECT output FROM craftmine_godot_jobs WHERE world_id=? AND build_id=? AND status=? ORDER BY rowid DESC LIMIT 1').get(worldId,app.build_id,'passed');db.close();
const output=JSON.parse(job.output),saved=JSON.parse(app.input),builds=path.join(data,'godot-builds');
const matches=fs.readdirSync(builds).map(name=>path.join(builds,name,app.build_id,'artifacts')).filter(file=>fs.existsSync(file));assert.equal(matches.length,1);
const artifacts=path.join(out,'artifacts');fs.cpSync(matches[0],artifacts,{recursive:true});
fs.writeFileSync(path.join(out,'descriptor.json'),JSON.stringify({worldId,buildId:app.build_id,revision:0,root:artifacts,artifacts:output.artifacts,entry:'web/index.html',threads:true,snapshot:saved.snapshot}));
const appRoot=path.join(out,'electron');fs.mkdirSync(path.join(appRoot,'main'),{recursive:true});fs.mkdirSync(path.join(appRoot,'preload'));
fs.writeFileSync(path.join(appRoot,'package.json'),JSON.stringify({name:'fb03-normal-staging',main:'main/index.cjs'}));fs.writeFileSync(path.join(appRoot,'main/owner.html'),'<!doctype html><title>Hidden staging verification</title><body style="background:#111">Preparing world</body>');
for(const [entry,target] of [['tests/fixtures/fb03-normal-staging-electron.mjs','main/index.cjs'],['vendor/pi-desktop/apps/desktop/electron/preload/godot-world.ts','preload/godot-world.cjs'],['vendor/pi-desktop/apps/desktop/electron/preload/craftmine-headless.ts','preload/craftmine-headless.cjs']])await build({entryPoints:[path.join(root,entry)],outfile:path.join(appRoot,target),bundle:true,platform:'node',format:'cjs',external:['electron'],target:'node22',logLevel:'warning'});
const env={...process.env,FB03_STAGING_OUT:out,FB03_STAGING_CANCEL:process.argv.includes('--cancel-on-load')?'1':''};delete env.CRAFTMINE_HEADLESS_TEST;delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(electron,[appRoot,'--user-data-dir='+path.join(out,'profile')],{cwd:out,windowsHide:true,stdio:['ignore','pipe','pipe'],env});
const log=fs.createWriteStream(path.join(out,'electron.log'));child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
const exit=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});log.end();console.log(JSON.stringify({out,exit,...JSON.parse(fs.readFileSync(path.join(out,'report.json')))}));process.exitCode=exit;
