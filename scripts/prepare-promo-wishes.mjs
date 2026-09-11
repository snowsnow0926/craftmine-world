// Offline preparation only. No network, credentials, Electron or model imports.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPromoWishPlan} from '../tests/helpers/promo-wish-plan.mjs';

export function parseOptions(args) {
  const options = {}, seen = new Set();
  for (let i=0;i<args.length;i++) {
    const flag = args[i];
    if (seen.has(flag)) throw Error(`DUPLICATE_OPTION: ${flag}`);
    seen.add(flag);
    if (flag === '--plan') continue;
    if (!['--suite','--cases','--seed','--out'].includes(flag)) throw Error(`UNKNOWN_OPTION: ${flag}; this command cannot run live models`);
    const value = args[++i];
    if (value === undefined || value.startsWith('--') || !value.trim()) throw Error(`MISSING_VALUE: ${flag}`);
    if (flag === '--suite') options.suite = value;
    if (flag === '--cases') options.selected = value.split(',');
    if (flag === '--seed') {
      if (!/^(0|[1-9]\d*)$/.test(value)) throw Error('INVALID_SEED');
      options.seed = Number(value);
    }
    if (flag === '--out') options.out = value;
  }
  return options;
}

export function main(args=process.argv.slice(2)) {
  const {out,...options} = parseOptions(args);
  const plan = createPromoWishPlan(options);
  if (!out) {process.stdout.write(JSON.stringify(plan,null,2)+'\n');return;}
  // The parent must exist. Exclusive directory creation refuses old runs and
  // symlinks; failure never deletes or rewrites a previous evidence directory.
  const directory = path.resolve(out);
  fs.mkdirSync(directory,{recursive:false});
  fs.writeFileSync(path.join(directory,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
  const summary = [
    '# 宣传愿望测试准备结果','',
    '状态：仅生成案例和空白证据槽位，没有运行产品、调用模型或修改世界。',
    `套件：${plan.suite}；种子：${plan.seed}；清单 SHA-256：${plan.planSha256}`,'',
    ...plan.stories.map(story=>`- ${story.title}：${story.steps.length} 步，全部 NOT_RUN。`),'',
    '现有 creation-model-native runner 仍只接受其固定案例，不能把本清单直接传入。',
    '下一步接入经过审核的隔离 IPC 驱动、实际用量账本及真实效果检查。',
    '本目录为裁判资料，不能加入产品上下文、运行资源或公开试玩包。','',
  ].join('\n');
  fs.writeFileSync(path.join(directory,'README.zh-CN.md'),summary,{flag:'wx'});
  process.stdout.write(`Prepared only (0 model requests): ${directory}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {main();} catch (error) {console.error(error.message);process.exitCode=1;}
}
