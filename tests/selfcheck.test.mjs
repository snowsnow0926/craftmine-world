import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSelfCheck, selfCheckText } from '../app/harness/selfcheck.mjs';

const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'craftmine-selfcheck-'));

test('自检在干净的数据目录上通过，并如实报告密钥与端口状态', async () => {
  const root = tempRoot();
  try {
    const report = await runSelfCheck({ root, provider: 'deepseek', port: 0, keyPresent: false });
    assert.equal(report.format, 'craftmine.selfcheck/1');
    assert.equal(report.passed, true, report.summary);
    assert.equal(report.blocking, 0);
    const names = report.checks.map(check => check.name);
    for (const name of ['Node 版本', '数据目录', '模型后端已登记', '当前世界可构建', '冻结内核完整', '浏览器模块齐全', '冻结需求集可读']) {
      assert.ok(names.includes(name), name);
    }
    const key = report.checks.find(check => check.name === '模型凭据');
    assert.equal(key.passed, false);
    assert.equal(key.blocking, false, '没有密钥只影响真实生成，不该阻断本地检查');
    assert.match(key.fix, /secrets\.json/);
    assert.match(selfCheckText(report), /自检结果/);
    assert.match(selfCheckText(report), /密钥/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('自检发现真实问题时必须判失败，并给出修法', async () => {
  const root = tempRoot();
  try {
    const report = await runSelfCheck({ root, provider: 'unknown-provider', port: 0, keyPresent: true, nodeVersion: '18.0.0' });
    assert.equal(report.passed, false);
    const failed = report.checks.filter(check => !check.passed && check.blocking).map(check => check.name);
    assert.ok(failed.includes('Node 版本'));
    assert.ok(failed.includes('模型后端已登记'));
    for (const check of report.checks.filter(item => !item.passed)) assert.ok(check.fix.length > 0, `${check.name} 缺少修法`);
    assert.match(selfCheckText(report), /✗ Node 版本/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
