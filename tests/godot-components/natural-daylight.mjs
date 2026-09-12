// Real pinned engine loads an optional component in a disposable stock base.
// No model, user's profile, foreground surface, OS input or visual-success claim.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {createGodotProbeEnvironment} from '../../desktop/godot/toolchain.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const component=path.join(root,'desktop/godot/components/natural-daylight');
const manifest=JSON.parse(fs.readFileSync(path.join(component,'component.json')));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const file of manifest.files){assert.ok(!file.path.includes('..'));assert.equal(digest(fs.readFileSync(path.join(component,file.path))),file.sha256,file.path);}
fs.mkdirSync(path.join(root,'test-results'),{recursive:true});const out=fs.mkdtempSync(path.join(root,'test-results/natural-daylight-'));const project=path.join(out,'project');
fs.cpSync(path.join(root,'desktop/godot/bases/creation-sandbox'),project,{recursive:true});
fs.cpSync(component,path.join(project,'components/natural-daylight'),{recursive:true});
fs.copyFileSync(path.join(root,'tests/godot-components/natural-daylight.gd'),path.join(project,'natural-daylight-test.gd'));
const environment=await createGodotProbeEnvironment(out);
await environment.run('import',['--editor','--path',project,'--import']);
const output=await environment.run('load-state',['--path',project,'--script','res://natural-daylight-test.gd']);
const line=output.split(/\r?\n/).find(line=>line.startsWith('NATURAL_DAYLIGHT_TEST='));assert.ok(line,'Missing actual engine receipt');const receipt=JSON.parse(line.slice('NATURAL_DAYLIGHT_TEST='.length));assert.equal(receipt.headless,true);assert.equal(receipt.visualVerified,false);assert.ok(receipt.checks.length>=15);
const report={format:'craftmine.component-load-test/1',componentId:manifest.id,componentVersion:manifest.version,engineVersion:environment.actualVersion,receipt,runs:environment.runs,modelRequests:0,sourceProfile:'disposable-stock-base',visualVerified:false};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,checks:receipt.checks.length,engine:environment.actualVersion,visualVerified:false}));
