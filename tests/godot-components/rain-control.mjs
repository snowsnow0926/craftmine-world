import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createGodotProbeEnvironment} from '../../desktop/godot/toolchain.mjs';
import {buildRainControlPackage,RAIN_CONTROL_ID} from '../../desktop/build-rain-control-package.mjs';
import {unpackStaticPackage} from '../../plugins/craftmine-world/package-zip.mjs';
import {planSceneInsertion,applySceneInsertion} from '../../desktop/godot/shared/scene_materializer.mjs';
const root=path.resolve(import.meta.dirname,'../..'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/rain-control-native-')),project=path.join(out,'project');
const approved=path.join(root,'desktop/godot/shared/promo-templates/promo-rain/source');
function inventory(directory){return fs.readdirSync(directory,{recursive:true}).filter(name=>fs.statSync(path.join(directory,name)).isFile()).sort().map(name=>({path:name.replaceAll('\\','/'),sha256:hash(fs.readFileSync(path.join(directory,name)))}));}
const originalInventory=inventory(approved);
fs.cpSync(path.join(root,'desktop/godot/bases/creation-sandbox'),project,{recursive:true,filter:p=>!['.godot','tests','docs','tools'].includes(path.basename(p))});
const built=buildRainControlPackage({repository:root}),resource=unpackStaticPackage(built.bytes).resources[0];
const addon=path.join(project,'addons',RAIN_CONTROL_ID);fs.mkdirSync(addon,{recursive:true});
for(const [name,bytes]of resource.files){fs.mkdirSync(path.dirname(path.join(addon,name)),{recursive:true});fs.writeFileSync(path.join(addon,name),bytes);}
const sceneFile=path.join(project,'scenes/creation.tscn'),originalScene=fs.readFileSync(sceneFile,'utf8');
const spec={...resource.manifest.content.entry.sceneInstall,sceneFile:'addons/'+RAIN_CONTROL_ID+'/rain_control.tscn',parent:'.',nodeName:'RainFixture'};
const plan=planSceneInsertion({sceneText:originalScene,scenePath:'scenes/creation.tscn',spec,entityId:'rain-fixture'});assert(plan.ok);
const installed=applySceneInsertion(originalScene,plan.edit);fs.writeFileSync(sceneFile,installed);
// The installer derives the node name from the identity, so pass that name to
// the fixture without altering the application scene or actor configuration.
const name=installed.match(/\[node name="([^"]+)"[^\]]*\]\s*\nentity_id = "rain-fixture"/)?.[1];
assert(name,'RAIN_INSTALLED_NODE_MISSING');
fs.mkdirSync(path.join(project,'craftmine_shared'),{recursive:true});
fs.copyFileSync(path.join(root,'desktop/godot/shared/component_state.gd'),path.join(project,'craftmine_shared/component_state.gd'));
fs.writeFileSync(path.join(project,'test.gd'),fs.readFileSync(path.join(root,'tests/godot-components/rain-control.gd'),'utf8').replace('stage.get_node("RainFixture")',`stage.get_node(${JSON.stringify(name)})`));
const protectedFiles=['scripts/creation_world.gd','scripts/reused/player_controller.gd','scripts/reused/camera_rig.gd','world/creation.json','project.godot'];
const protectedBefore=Object.fromEntries(protectedFiles.map(name=>[name,hash(fs.readFileSync(path.join(project,name)))]));
const report={format:'craftmine.rain-control-native/1',out,modelCalls:0,productProfilesOpened:0,playerAcceptance:false,visualVerified:false,archiveSha256:hash(built.bytes),sourcePackageContentHash:built.entry.rootContentHash,originalRainInventorySha256:hash(JSON.stringify(originalInventory)),protectedBefore,
 scope:'Pinned headless Godot; ordinary scene insertion, actual original creation controller physics, synthetic engine input and component ledger. Fixture enables the base controller input route that stock headless mode disables. No actor motion/progress assignment, OS input, focus or Pointer Lock.'};
const engine=await createGodotProbeEnvironment(out);report.engine=engine.actualVersion;
try{
 await engine.run('import',['--editor','--path',project,'--import']);
 const output=await engine.run('behavior',['--path',project,'--fixed-fps','60','--script','res://test.gd']);
 const line=output.split(/\r?\n/).find(line=>line.startsWith('RAIN_CONTROL_TEST='));assert(line);
 report.receipt=JSON.parse(line.slice('RAIN_CONTROL_TEST='.length));assert.equal(report.receipt.ok,true);assert.equal(report.receipt.headless,true);assert(report.receipt.checks.length>=25);
 const reopened=await engine.run('cold-reopen',['--path',project,'--fixed-fps','60','--script','res://test.gd','--','--reload']);
 const reopenLine=reopened.split(/\r?\n/).find(line=>line.startsWith('RAIN_CONTROL_REOPEN='));assert(reopenLine);
 report.reopened=JSON.parse(reopenLine.slice('RAIN_CONTROL_REOPEN='.length));assert.equal(report.reopened.ok,true);assert(report.reopened.checks.length>=6);
 for(const [name,expected]of Object.entries(protectedBefore))assert.equal(hash(fs.readFileSync(path.join(project,name))),expected,'Protected source changed: '+name);
 assert.deepEqual(inventory(approved),originalInventory);report.originalRainSourceUnchanged=true;report.protectedWorldSourcesUnchanged=true;report.ok=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally{report.runs=engine.runs;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,report:path.join(out,'report.json'),checks:report.receipt?.checks.length,error:report.error?.split('\n')[0]}));}
