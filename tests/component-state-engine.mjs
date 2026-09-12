import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {materializeBase} from '../desktop/godot/shared/materialize.mjs';
import {createGodotProbeEnvironment} from '../desktop/godot/toolchain.mjs';
fs.mkdirSync('test-results',{recursive:true});const out=fs.mkdtempSync(path.resolve('test-results/component-state-')),project=path.join(out,'project');
materializeBase({baseId:'creation-sandbox',worldId:'component-test',template:'blank',out:project});
fs.copyFileSync('tests/component-state-engine.gd',path.join(project,'probe.gd'));
const engine=await createGodotProbeEnvironment(out);const report={out,runs:engine.runs,passed:false};
try{await engine.run('import',['--path',project,'--editor','--import'],{timeout:60000});const output=await engine.run('state',['--path',project,'--script','res://probe.gd','--quit-after','300'],{timeout:15000});const line=output.split(/\r?\n/).find(x=>x.startsWith('COMPONENT_STATE='));assert.ok(line,output);report.result=JSON.parse(line.slice('COMPONENT_STATE='.length));assert.equal(report.result.checks.length,25);report.passed=true;}finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
