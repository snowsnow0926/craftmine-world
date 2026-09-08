import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../app/store.mjs';
import { verifyBehaviors } from '../app/behavior-verify.mjs';
import { gameplayScene } from './scene-fixtures.mjs';
import { workbench } from './workbench.mjs';

const extension = {
  format: 'craftmine.extension/1', id: 'verify-drain', name: '吸血', version: 1,
  description: '验证真实的扩展命令派发', requires: [], capabilities: [],
  permissions: ['targets.write', 'health.write', 'hud.message'], targets: ['target-one'],
  provides: { commands: [{ type: 'verify.drain', permission: 'targets.write', fields: [{ name: 'targetId', description: '目标' }, { name: 'amount', description: '数值' }] }], events: [] },
  code: `export function apply({command,state}) { return {state:{calls:(state?.calls||0)+1},effects:[
    {type:'target.damage',id:command.targetId,amount:command.amount},
    {type:'health.add',amount:command.amount},{type:'hud.message',text:'吸血 +10'}]}; }`,
};
fs.mkdirSync('test-results', { recursive: true });
const dir = fs.mkdtempSync(path.resolve('test-results/extension-behavior-'));
const store = new ProjectStore(path.join(dir, 'project'));
store.change(data => { data.extensions = [extension]; });
const scene = { ...gameplayScene(), format: 'craftmine.scene/3', behaviors: [{
  format: 'craftmine.behavior/2', id: 'drain-once', name: '一次吸血', description: '首次 tick 执行',
  stateVersion: 1, initialState: {}, params: {}, targets: ['target-one'],
  permissions: ['targets.write', 'health.write', 'hud.message'], requires: ['ext:verify-drain@1'], binding: null, keys: [],
  code: `export function step({frame,state}) { if(!['start','tick'].includes(frame.event.type)||state.fired)return {state,commands:[]};
    return {state:{fired:true},commands:[{type:'verify.drain',targetId:'target-one',amount:10}]}; }`,
}] };
const build = store.build(scene);
store.change(data => { data.current = build.id; });
fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ checks: [], errors: [] }));
const w = await workbench('extension-behavior', { resumeDir: dir });
try {
  const report = await verifyBehaviors(build, { origin: w.origin, extensions: [extension] });
  fs.writeFileSync(path.join(dir, 'verification.json'), JSON.stringify(report, null, 2));
  w.check('验证沙箱装载扩展并完成事件与恢复', report.passed, JSON.stringify(report.modules));
  w.check('验证报告记录真实目标掉血', report.modules[0].gameplay.targets['target-one'].health === 50);
  const absent = await verifyBehaviors(build, { origin: w.origin });
  w.check('遗漏扩展装载时同一模块无法通过', !absent.passed, absent.modules[0].error);
  await new Promise(resolve => setTimeout(resolve, 400));
  const snapshot = await w.snapshot();
  w.check('游戏页面同一扩展真正扣血且只触发一次', snapshot.gameplay.targets['target-one'].health === 50, JSON.stringify(snapshot.gameplay.targets));
  w.check('生成玩法状态已保存', snapshot.behaviors.modules['drain-once'].state.fired === true);
  w.check('自动验证未获取鼠标锁定', await w.game().locator('body').evaluate(() => document.pointerLockElement === null));
  w.check('页面没有未处理异常', w.errors.length === 0, w.errors.join(' / '));
} catch (error) {
  w.errors.push(error.stack); process.exitCode = 1; console.error(error);
} finally {
  await w.close(); console.log('Report: ' + path.join(dir, 'report.json'));
}
