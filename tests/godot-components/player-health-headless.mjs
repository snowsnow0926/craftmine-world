// 玩家生命值真实 Godot headless 验收：脚本驱动真实节点，不发送输入事件。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGodotProbeEnvironment, godotLock } from '../../desktop/godot/toolchain.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const base=path.join(root,'desktop/godot/bases/first-person');
const out=fs.mkdtempSync(path.join(root,'test-results/player-health-'));
const project=path.join(out,'project'); fs.cpSync(base,project,{recursive:true,filter:s=>path.basename(s)!=='.godot'});
const commands=[
 {op:'snapshot'},
 {op:'damage-player',args:{amount:35}},
 {op:'hud'},
 {op:'snapshot'},
 {op:'damage-player',args:{amount:100}},
 {op:'attack'},
 {op:'revive-player'},
 {op:'save'},
];
fs.writeFileSync(path.join(project,'health.json'),JSON.stringify(commands));
const env=await createGodotProbeEnvironment(out);
await env.run('import',['--path',project,'--editor','--import']);
const stdout=await env.run('health',['--path',project,'--','--base-script=res://health.json','--base-world-id=health-world']);
const line=stdout.split(/\r?\n/).find(x=>x.startsWith('CRAFTMINE_FP_BASE=')); assert.ok(line,'missing headless result');
const report=JSON.parse(line.slice('CRAFTMINE_FP_BASE='.length)); const result=op=>report.results.find(x=>x.op===op)?.result; const results=op=>report.results.filter(x=>x.op===op).map(x=>x.result);
assert.equal(results('damage-player')[0].applied,35); assert.equal(results('damage-player')[1].dead,true);
assert.match(result('hud').health,/生命 65 \/ 100/);
assert.equal(report.results.find(x=>x.op==='attack')?.result?.reason,'player-dead');
assert.equal(result('revive-player').player.health,100); assert.equal(result('save').written,true);
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({format:'craftmine.player-health-headless/1',engine:godotLock.version,headless:true,checks:['take_damage','death_blocks_attack','revive','save'],result:report},null,2));
console.log('PLAYER_HEALTH_HEADLESS='+JSON.stringify({out,engine:godotLock.version,passed:true}));
