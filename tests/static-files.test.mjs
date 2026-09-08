import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { STATIC_FILES } from '../app/static-files.mjs';

const APP = path.resolve('app');
const routes = new Set(STATIC_FILES.map(([route]) => route));
const specifiers = source => [...source.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)].map(match => match[1]);

test('静态白名单没有重复路由，登记的文件都存在', () => {
  assert.equal(routes.size, STATIC_FILES.length);
  for (const [route, file] of STATIC_FILES) {
    assert.match(route, /^\/app\/[\w./-]+$/);
    assert.ok(fs.existsSync(path.join(APP, file)), `缺少文件：${file}`);
  }
});

test('浏览器模块的相对导入都在白名单里，否则游戏页会加载失败', () => {
  const missing = [];
  for (const [route, file, type] of STATIC_FILES) {
    if (type !== 'text/javascript') continue;
    const source = fs.readFileSync(path.join(APP, file), 'utf8');
    for (const specifier of specifiers(source)) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      const target = '/app/' + resolved;
      if (!routes.has(target)) missing.push(`${file} → ${specifier}（缺少 ${target}）`);
      else assert.ok(fs.existsSync(path.join(APP, resolved)), `白名单指向了不存在的文件：${resolved}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('浏览器侧新增的运行时模块确实在提示词与运行时之间共享同一份契约', () => {
  const listed = new Set(STATIC_FILES.map(([, file]) => file));
  for (const file of ['world-runtime.mjs', 'behavior-state.mjs', 'behavior-session.mjs', 'behavior-contracts.mjs', 'gameplay.mjs', 'tween.mjs']) {
    assert.ok(listed.has(file), `${file} 必须能被浏览器加载`);
  }
});
