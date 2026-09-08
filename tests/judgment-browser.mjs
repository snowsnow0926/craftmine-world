import path from 'node:path';
import { workbench } from './workbench.mjs';
import { runRequirementSet } from '../app/harness/judgment-run.mjs';
import { REQUIREMENTS } from '../app/harness/requirements.mjs';
import { CANDIDATES, FAULTY } from './judgment-fixtures.mjs';

// 端到端：真实引擎录制轨迹 → 确定性裁判判定。没有鼠标/键盘输入，只在隔离页面里跑事件序列。
const w = await workbench('judgment-browser');
try {
  const requirements = REQUIREMENTS.filter(requirement => CANDIDATES[requirement.id]);
  const run = await runRequirementSet({
    origin: w.origin, candidates: CANDIDATES, requirements,
    onResult: record => console.log(`${record.passed ? 'PASS' : 'FAIL'} ${record.requirement} · ${record.summary}`),
  });
  const failures = run.records.filter(record => !record.passed);
  w.check(`参考实现全部通过（${run.records.length} 条需求）`, failures.length === 0, failures.map(record => `${record.requirement}：${record.summary}`).join(' / '));

  const subset = requirements.slice(0, 3);
  const first = await runRequirementSet({ origin: w.origin, candidates: CANDIDATES, requirements: subset });
  const second = await runRequirementSet({ origin: w.origin, candidates: CANDIDATES, requirements: subset });
  w.check('影子运行两遍的判定签名完全一致', first.signature === second.signature, `${first.signature} vs ${second.signature}`);

  const faultyRequirements = REQUIREMENTS.filter(requirement => FAULTY[requirement.id]);
  const faulty = await runRequirementSet({ origin: w.origin, candidates: { ...CANDIDATES, ...FAULTY }, requirements: faultyRequirements });
  const escaped = faulty.records.filter(record => record.passed);
  w.check('故意写错的实现必须被判失败', escaped.length === 0, escaped.map(record => record.requirement).join(' / '));
  for (const record of faulty.records) console.log(`RED ${record.requirement} · ${record.summary}`);

  const { traces } = run;
  const revived = traces['r06-revive-monsters'];
  w.check('真实引擎录到的轨迹里，按 G 之后怪物血量确实恢复', Boolean(revived) && revived.final.objects.some(object => object.id === 'zombie-1' && object.health > 0) && revived.final.objects.some(object => object.id === 'zombie-1' && object.mesh === true), JSON.stringify(revived?.final?.objects?.find(object => object.id === 'zombie-1')));
  const crafted = traces['r05-craft-door-from-three-wood'];
  w.check('真实引擎录到的轨迹里，重载存档后做好的门还在', Boolean(crafted) && crafted.final.objects.some(object => object.id === 'door-3' && object.visible === true) && (crafted.final.inventory.wood ?? 0) === 0);
  w.check('跑分过程没有抢占鼠标锁定', await w.page.evaluate(() => document.pointerLockElement === null));
  w.check('跑分过程没有把页面搞崩', w.errors.length === 0, w.errors.join(' / '));
} catch (error) {
  w.errors.push(error.stack);
  console.error(error);
  process.exitCode = 1;
} finally {
  await w.close();
  console.log('Report: ' + path.join(w.dir, 'report.json'));
}
