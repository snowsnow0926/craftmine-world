// Read-only source reports: no test execution, model calls, or report mutation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = value => value.replaceAll('\\', '/');
const text = value => typeof value === 'string' ? value.replace(/[\r\n\t]/g, ' ').replace(/(?:bearer\s+\S+|sk-[\w-]+|(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+)/gi, '[REDACTED]').slice(0, 300) : null;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const identityKeys = ['commit','sourceCommit','buildId','contentOid','sourceRevision','revision','baseId','baseVersion','engineVersion','brokerSha256','coreSha256','sourceDigest','sourceArchiveHash'];
function identity(value) {
  return Object.fromEntries(identityKeys.flatMap(key => {
    const v = value?.[key];
    return typeof v === 'number' || (typeof v === 'string' && /^[a-zA-Z0-9._/-]{1,160}$/.test(v)) ? [[key,v]] : [];
  }));
}
async function entries(directory) {
  try { return (await fs.readdir(directory, {withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name)); }
  catch (error) { if(error.code === 'ENOENT') return []; throw error; }
}
async function discover(root) {
  const found = [];
  const results = path.join(root,'test-results');
  for(const dir of await entries(results)) {
    if(dir.isDirectory() && /^desktop-native-complete-/.test(dir.name)) found.push({file:path.join(results,dir.name,'report.json'),kind:'actual-client'});
  }
  const recovery = path.join(results,'desktop-native-recovery-gql5Pk');
  for(const dir of await entries(recovery)) if(dir.isDirectory() && dir.name.startsWith('fault-evidence-')) found.push({file:path.join(recovery,dir.name,'report.json'),kind:'actual-client-recovery'});
  const docs = path.join(root,'docs/dispatch-reports/godot-final');
  async function walk(directory) {
    for(const entry of await entries(directory)) {
      const file = path.join(directory,entry.name);
      if(entry.isDirectory()) await walk(file); // Dirent does not follow symbolic links.
      else if(entry.isFile()) {
        const relative = slash(path.relative(docs,file));
        if(entry.name === 'native-final.json' || (/mining/i.test(relative) && /(?:report|closeout|controller).*\.(?:json|md)$/i.test(entry.name))) {
          found.push({file,kind:entry.name.endsWith('.md')?'narrative-only':'native-fixed-scenario'});
        }
      }
    }
  }
  await walk(docs);
  return found.sort((a,b)=>a.file.localeCompare(b.file));
}
function tasks(report) {
  const items = [];
  function collect(list, prefix, parentPassed) {
    if(!Array.isArray(list)) return;
    list.forEach((item,index) => {
      const scalar = typeof item === 'string';
      const passed = scalar ? parentPassed : item?.passed;
      const state = passed === true ? 'passed' : passed === false ? 'failed' : 'unknown';
      items.push({id:`${prefix}/${index+1}`,name:text(scalar?item:(item?.name ?? item?.fault ?? item?.label)) ?? `${prefix} #${index+1}`,state,
        assertionSource:scalar?'parent-report-claim':'explicit-item',
        ...(typeof item?.ms==='number'?{durationMs:item.ms}:{}),
        // Raw errors, result objects, calls and prompts deliberately stay in the source report.
        ...(item?.error ? {errorPresent:true}:{}),
      });
    });
  }
  collect(report.steps,'steps',undefined);
  collect(report.checks,'checks',report.passed);
  for(const [index,world] of (Array.isArray(report.worlds)?report.worlds:[]).entries()) collect(world.checks,`worlds/${index+1}/${text(world.baseId) ?? 'unknown'}`,world.passed ?? report.passed);
  return items;
}
async function readReport(root, source) {
  const record = {path:slash(path.relative(root,source.file)),absolutePath:slash(path.resolve(source.file)),kind:source.kind,state:'unknown',sha256:null};
  try {
    const stat = await fs.lstat(source.file);
    if(!stat.isFile() || stat.isSymbolicLink()) throw new Error('NOT_REGULAR_FILE');
    const bytes = await fs.readFile(source.file);
    Object.assign(record,{sha256:sha(bytes),bytes:bytes.length,fileModifiedAt:stat.mtime.toISOString()});
    if(source.kind === 'narrative-only') return {...record,state:'not-evaluated',note:'说明文档只记录来源与哈希，不从文字推断验收通过。'};
    let report;
    try { report = JSON.parse(bytes.toString('utf8')); } catch { return {...record,state:'invalid',error:'INVALID_JSON'}; }
    if(!report || typeof report !== 'object' || Array.isArray(report)) return {...record,state:'invalid',error:'INVALID_REPORT_OBJECT'};
    const items = tasks(report);
    const failed = report.passed===false || Boolean(report.fatal) || items.some(item=>item.state==='failed');
    const isClient = source.kind.startsWith('actual-client');
    const finishedAt = date(report.finishedAt);
    const finished = isClient ? Boolean(finishedAt) : typeof report.passed === 'boolean';
    const state = !finished ? 'running' : failed ? 'failed' : (report.passed===true || (items.length>0 && items.every(item=>item.state==='passed'))) ? 'passed' : 'unknown';
    return {...record,format:text(report.format),state,startedAt:date(report.startedAt),finishedAt,hasRecordedFailure:failed,
      timeNote:!date(report.startedAt)&&!finishedAt?'原报告未记录运行时间；文件修改时间不能视为运行时间。':null,
      identity:identity(report),worldIdentities:(report.worlds??[]).map(world=>({...identity(world),...identity(world.formal)})),
      tasks:items,counts:{passed:items.filter(i=>i.state==='passed').length,failed:items.filter(i=>i.state==='failed').length,unknown:items.filter(i=>i.state==='unknown').length},
      ...(report.fatal ? {fatalPresent:true}:{}),
    };
  } catch(error) { return {...record,state:error.code==='ENOENT'?'running':'unreadable',error:error.code??'NOT_REGULAR_FILE'}; }
}
async function packageSummary(root, file) {
  if(!file) return {state:'not-verified',note:'未提供同源码安装包证据；setup 生成、提取核对、签名与首装均不能推定通过。'};
  const record = await readReport(root,{file:path.resolve(root,file),kind:'package-evidence'});
  if(!record.sha256 || ['invalid','unreadable'].includes(record.state)) return {...record,state:'not-verified'};
  const value = JSON.parse(await fs.readFile(path.resolve(root,file),'utf8'));
  const valid = value.format==='craftmine.package-evidence/2' && value.extraction?.verified===true && /^[a-f\d]{40}$/i.test(value.commit??'') && /^[a-f\d]{64}$/i.test(value.sourceArchiveHash??'') && /^[a-f\d]{64}$/i.test(value.buildManifestSha256??'') && Array.isArray(value.installers) && value.installers.some(f=>f.path?.endsWith('.exe')) && value.installers.some(f=>f.path?.endsWith('.exe.blockmap')) && value.installers.every(f=>Number.isInteger(f.bytes)&&f.bytes>0&&/^[a-f\d]{64}$/i.test(f.sha256??''));
  return {path:record.path,absolutePath:record.absolutePath,sha256:record.sha256,fileModifiedAt:record.fileModifiedAt,state:valid?'recorded-payload-verification':'not-verified',identity:identity(value),
    installerExecuted:value.installerExecuted===true,cleanWindowsVerified:value.cleanWindowsVerified===true,signature:text(value.signature),
    note:'只汇总指定发行工具回执，不重新提取安装包，不把回执当成本汇总脚本独立实测。'};
}
export async function summarizeEvidence({root,packageEvidence,now=new Date().toISOString()}) {
  root=path.resolve(root);
  const reports=[];
  for(const source of await discover(root)) reports.push(await readReport(root,source));
  return {format:'craftmine.final-audit-summary/1',generatedAt:now,root:slash(root),
    policy:'逐次运行列出；保留全部失败与未完成。不合并重跑为通过率，不汇总跨运行断言总数；原始报告是结果来源，哈希只确认读取的字节。',
    formalModel:{state:'not-executed',categories:15,rounds:30,assertions:141,note:'本轮外发及费用授权仍待确认，正式真模型验收未执行；费用与通过率未记录，不能填为零费用或100%。'},
    package:await packageSummary(root,packageEvidence),reports,
  };
}
const escape = value => String(value??'未记录').replace(/[|\r\n]/g,' ').replace(/[<>]/g,'');
export function renderMarkdown(summary) {
  const lines=['# 最终验收证据汇总','',`生成时间：${summary.generatedAt}`,'',summary.policy,'',
    '正式真模型：**未执行**。冻结规格为 15 类 / 30 轮 / 141 断言；本轮授权待确认，无费用或通过率结论。','',
    `同源码安装包：**${summary.package.state}**。${summary.package.note}`,''];
  if(summary.package.absolutePath) lines.push(`[发行原始回执](<${summary.package.absolutePath}>)；SHA-256：\`${summary.package.sha256}\`。`,
    `回执版本：${escape(JSON.stringify(summary.package.identity??{}))}；签名：${escape(summary.package.signature)}；安装器执行：${summary.package.installerExecuted===true?'回执声明已执行':'未验证'}；清洁 Windows 首装：${summary.package.cleanWindowsVerified===true?'回执声明已验证':'未验证'}。`,'');
  for(const record of summary.reports) {
    lines.push(`## ${escape(record.path)}`,'',`类型：${record.kind}；状态：**${record.state}**。`,`[原始报告](<${record.absolutePath}>)；SHA-256：\`${record.sha256??'不可读'}\`。`,
      `运行时间：${record.startedAt??'未记录'} → ${record.finishedAt??'未记录'}；文件修改时间：${record.fileModifiedAt??'未知'}。`);
    if(record.identity) lines.push(`报告记录版本：${escape(JSON.stringify(record.identity))}；世界源码身份：${escape(JSON.stringify(record.worldIdentities))}。`);
    if(record.timeNote) lines.push(record.timeNote);
    if(record.error) lines.push(`读取问题：${record.error}。`);
    if(record.fatalPresent) lines.push('报告记录 fatal；错误全文保留在原始报告，避免复制敏感内容。');
    if(record.note) lines.push(record.note);
    if(record.tasks?.length) {
      lines.push('','| 条目 | 状态 | 证据口径 |','| --- | --- | --- |');
      for(const item of record.tasks) lines.push(`| ${escape(item.id)}：${escape(item.name)} | ${item.state} | ${item.assertionSource}${item.errorPresent?'；原文含错误':''} |`);
    }
    lines.push('');
  }
  return lines.join('\n')+'\n';
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);const options={};
  for(let i=0;i<args.length;i+=2) { if(!['--root','--package-evidence'].includes(args[i])||!args[i+1]) throw new Error('Use --root <repository> [--package-evidence <same-run package-evidence.json>]'); options[args[i]]=args[i+1]; }
  const root=path.resolve(options['--root']??path.join(path.dirname(fileURLToPath(import.meta.url)),'../..'));
  const summary=await summarizeEvidence({root,packageEvidence:options['--package-evidence']});
  const out=path.join(root,'test-results');await fs.mkdir(out,{recursive:true});
  await fs.writeFile(path.join(out,'final-audit-summary.json'),JSON.stringify(summary,null,2)+'\n');
  await fs.writeFile(path.join(out,'final-audit-summary.md'),renderMarkdown(summary));
  console.log(JSON.stringify({reports:summary.reports.length,json:path.join(out,'final-audit-summary.json'),markdown:path.join(out,'final-audit-summary.md')}));
}
