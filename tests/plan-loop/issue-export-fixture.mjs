import fs from 'node:fs/promises';import path from 'node:path';import {createRequire} from 'node:module';import {randomUUID} from 'node:crypto';
const {build}=createRequire(path.resolve(process.env.CRAFTMINE_DEPS_ROOT||'vendor/pi-desktop/apps/desktop','package.json'))('esbuild');
async function load(name){const r=await build({entryPoints:[`vendor/pi-desktop/apps/desktop/electron/main/${name}.ts`],bundle:true,platform:'node',format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));}
export const {createCraftmineIssueService}=await load('craftmine-issue-service');export const {createCraftmineIssueExportService}=await load('craftmine-issue-export-service');
export const {createCraftminePanelGateway}=await load('craftmine-panel-gateway');export const {writeSelectedFile}=await load('craftmine-backup-service');
export async function fixture(){
 await fs.mkdir('test-results',{recursive:true});const out=await fs.mkdtemp(path.resolve('test-results/issue-export-'));const f={out,world:'alpha',fault:null,picks:0,target:path.join(out,'selected.json'),readCalls:[],createdAt:'2026-09-10T01:02:03.000Z'};
 const context={phase:'formal',status:'ready',worldId:'alpha',buildId:'build-original',baseId:'first-person',baseVersion:'0.1.0',instanceId:'instance-original',runtimeTarget:'godot-web',artifactManifestHash:'a'.repeat(64)};
 f.service=createCraftmineIssueService({directory:path.join(out,'ledger'),captureContext:async()=>context,client:{version:'0.14.3',commit:'b'.repeat(40)},now:()=>Date.parse(f.createdAt)});
 f.issue=(await f.service.request('issue.create',{worldId:'alpha',operationId:randomUUID(),description:'  玩家原话\n<script>literal</script> 😃  '})).issue;
 context.buildId='build-followup';context.instanceId='instance-followup';const prepared=await f.service.request('issue.followupPrepare',{worldId:'alpha',issueId:f.issue.id});await f.service.request('issue.followup',{worldId:'alpha',issueId:f.issue.id,operationId:randomUUID(),revision:0,contextHash:prepared.contextHash,kind:'player-resolved',text:'  玩家复测说明\n保留原话  '});
 f.read=()=>f.service.request('issue.read',{worldId:'alpha',issueId:f.issue.id});f.before=await f.read();f.ledger=await fs.readFile(path.join(out,'ledger/issues.json'));
 f.exports=createCraftmineIssueExportService({read:async(worldId,issueId)=>{f.readCalls.push({worldId,issueId});return f.service.request('issue.read',{worldId,issueId});},selection:async()=>f.world,pickFile:async()=>{f.picks++;if(f.holdPick)await f.holdPick;return f.target;},fault:async point=>{await f.fault?.(point);},now:()=>Date.parse('2026-09-10T02:00:00.000Z')});
 f.input={worldId:'alpha',issueId:f.issue.id,revision:1,operationId:randomUUID()};f.call=(input=f.input)=>f.exports.request('issue.export',input);
 return f;
}
