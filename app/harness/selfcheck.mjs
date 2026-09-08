import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { ProjectStore } from '../store.mjs';
import { compileScene } from '../scene.mjs';
import { verifyKernel } from './kernel.mjs';
import { STATIC_FILES } from '../static-files.mjs';
import { providerContract } from './provider-contract.mjs';
import { requirementsHash } from './requirements.mjs';

// 启动自检（P7）：一条命令回答「这台机器现在能不能创作」。
// 只报告事实：能修的给出修法，不能确认的写「无法确认」，绝不假装通过。
export const SELFCHECK_FORMAT = 'craftmine.selfcheck/1';

const need = (condition, message) => { if (!condition) throw Error(message); };

export async function runSelfCheck({ root, provider = 'deepseek', model = null, port = 8787, keyPresent = false, nodeVersion = process.versions.node } = {}) {
  need(root, '自检需要数据目录');
  const checks = [];
  const add = (name, passed, { blocking = true, detail = '', fix = '' } = {}) => checks.push({ name, passed, blocking, detail, fix });

  const major = Number(String(nodeVersion).split('.')[0]);
  add('Node 版本', major >= 22, { detail: `当前 ${nodeVersion}，需要 >= 22`, fix: '升级 Node 到 22 或更高' });

  let dataDirOk = false, dataDetail = '';
  try {
    fs.mkdirSync(root, { recursive: true });
    const probe = path.join(root, '.selfcheck-probe');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    dataDirOk = true;
    dataDetail = `数据目录可写：${root}`;
  } catch (error) { dataDetail = `数据目录不可写：${error.message}`; }
  add('数据目录', dataDirOk, { detail: dataDetail, fix: '检查磁盘权限或 CRAFTMINE_DATA_DIR' });

  const contract = providerContract(provider, { model });
  add('模型后端已登记', contract.registered, { detail: contract.registered ? `${provider} 的能力声明已登记` : `未登记的后端 ${provider}：不能推定它支持任何能力`, fix: '检查 CRAFTMINE_MODEL_PROVIDER' });
  add('模型凭据', keyPresent, { blocking: false, detail: keyPresent ? '密钥已加载' : '没有检测到密钥：只能跑本地检查，不能真实生成', fix: '把密钥写进 <数据目录>/secrets.json' });

  let store = null, build = null;
  try {
    store = new ProjectStore(root);
    build = store.readBuild(store.data.current, { resolveAssets: false });
    compileScene(build.scene, { extensions: store.extensionSet() });
    add('当前世界可构建', true, { detail: `版本 ${store.data.current}，对象 ${build.scene.objects.length} 个，源码模块 ${build.behaviors?.length || 0} 个` });
  } catch (error) {
    add('当前世界可构建', false, { detail: error.message, fix: '用备份恢复上一个可用版本（backups/）' });
  }

  const kernel = verifyKernel();
  add('冻结内核完整', kernel.passed, { detail: kernel.summary, fix: '只有人能更新 app/harness/kernel.mjs 里的哈希清单' });

  const missingFiles = STATIC_FILES.filter(([, file]) => !fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', file))).map(([route]) => route);
  add('浏览器模块齐全', missingFiles.length === 0, { detail: missingFiles.length ? `缺少：${missingFiles.join('、')}` : `${STATIC_FILES.length} 个模块都在`, fix: '补回缺失文件或从 static-files.mjs 移除登记' });

  const requirements = requirementsHash();
  add('冻结需求集可读', typeof requirements === 'string' && requirements.length === 64, { detail: `需求集哈希 ${String(requirements).slice(0, 12)}…`, fix: '检查 app/harness/requirements.mjs 是否被改动' });

  let portFree = false, portDetail = '';
  try {
    portFree = await new Promise(resolve => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => server.close(() => resolve(true)));
      server.listen(port, '127.0.0.1');
    });
    portDetail = portFree ? `端口 ${port} 空闲` : `端口 ${port} 已被占用（可能正是本项目在运行）`;
  } catch (error) { portDetail = `端口检查失败：${error.message}`; }
  add('端口可用', portFree, { blocking: false, detail: portDetail, fix: '关闭占用进程，或设置 CRAFTMINE_PORT 换一个端口' });

  if (store) {
    const extensions = store.data.extensions || [];
    add('已装载扩展', true, { blocking: false, detail: extensions.length ? extensions.map(extension => `${extension.id}@${extension.version}`).join('、') : '没有装载任何扩展' });
  }

  const failed = checks.filter(check => !check.passed && check.blocking);
  return {
    format: SELFCHECK_FORMAT,
    passed: failed.length === 0,
    blocking: failed.length,
    checks,
    summary: failed.length ? `${failed.length} 项阻断问题：${failed.map(check => check.name).join('、')}` : `${checks.length} 项检查通过（${checks.filter(check => !check.blocking).length} 项为提示）`,
  };
}

export function selfCheckText(report) {
  const lines = [`自检结果：${report.summary}`];
  for (const check of report.checks) {
    const mark = check.passed ? '✓' : check.blocking ? '✗' : '!';
    lines.push(`${mark} ${check.name}：${check.detail}${!check.passed && check.fix ? ` → ${check.fix}` : ''}`);
  }
  return lines.join('\n');
}

// CLI：node app/harness/selfcheck.mjs
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.env.CRAFTMINE_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.craftmine'));
  const provider = process.env.CRAFTMINE_MODEL_PROVIDER || 'deepseek';
  const keyPresent = provider === 'deepseek'
    ? Boolean(process.env.CRAFTMINE_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || (fs.existsSync(path.join(root, 'secrets.json')) && /deepseek/i.test(fs.readFileSync(path.join(root, 'secrets.json'), 'utf8'))))
    : true;
  const report = await runSelfCheck({ root, provider, model: process.env.CRAFTMINE_MODEL || null, port: Number(process.env.CRAFTMINE_PORT || 8787), keyPresent });
  console.log(selfCheckText(report));
  process.exitCode = report.passed ? 0 : 1;
}
