import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {materializeBase} from '../../../desktop/godot/shared/materialize.mjs';
import {createGodotProbeEnvironment} from '../../../desktop/godot/toolchain.mjs';

const root=path.resolve(import.meta.dirname,'../../..');
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
const out=fs.mkdtempSync(path.join(root,'test-results/side-view-camera-'));
const report={format:'craftmine.side-view-camera/1',out,checks:[],passed:false};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
try {
  const engine=await createGodotProbeEnvironment(out);
  const project=path.join(out,'project');
  materializeBase({baseId:'side-view',worldId:'camera-restore-test',template:'ruins',out:project});
  report.source=Object.fromEntries(['player/side_view_player.gd','world/room_manager.gd'].map(file=>[file,sha(fs.readFileSync(path.join(project,'scripts',file)))]));
  fs.copyFileSync(path.join(import.meta.dirname,'side-view-camera.gd'),path.join(project,'camera-test.gd'));
  await engine.run('import',['--path',project,'--editor','--import']);
  const output=await engine.run('paused-restore',['--path',project,'--script','res://camera-test.gd']);
  const result=JSON.parse(output.split('CAMERA_RESULT=')[1].split('\n')[0]);
  report.checks=result.checks;report.engine=engine.actualVersion;report.runs=engine.runs;
  for(const check of result.checks) assert.ok(check.passed,JSON.stringify(check));
  report.passed=true;
}catch(error){report.error=String(error.stack??error);process.exitCode=1;}
finally {fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,error:report.error}));}
