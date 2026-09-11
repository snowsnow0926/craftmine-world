// Copies actual PNG bytes into a static local evidence page. Never opens a browser.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const [reportFile,originalImage,output]=process.argv.slice(2);
assert.ok([reportFile,originalImage,output].every(value=>value&&path.isAbsolute(value)),'Three absolute paths required: report, original PNG, output directory');
const reportBytes=fs.readFileSync(reportFile),report=JSON.parse(reportBytes);
assert.equal(report.format,'craftmine.builtin-prefab-demo/1');assert.equal(report.ok,true);
assert.equal(report.modelCalls,0);assert.equal(report.creationEvaluation,false);assert.equal(report.sourceEditsByHarness,0);
assert.deepEqual(report.plan,[{assetId:'cw.environment.natural-daylight',version:1},{assetId:'cw.scene.forest-gateway',version:1,position:{x:0,y:0,z:0}}]);
assert.ok(report.installations.every(item=>item.finished.status==='passed'&&item.applied.status==='applied'));
assert.deepEqual(report.walkthrough.inside.after.payload.player,report.reopened.payload.player,'Cold reopen must preserve the actual walk result');
assert.equal(report.arrangedSource.manifestHash,report.reopenedSource.manifestHash);
assert.equal(report.arrangedSource.revision,report.reopenedSource.revision);
assert.equal(report.saved.buildId,report.reopened.buildId);
for(const launch of report.launches)for(const field of ['violations','pageErrors','shutdownFailures'])assert.deepEqual(launch.audit[field],[]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const items=[
 {file:'original-model-environment.png',title:'旧样本：模型原创环境跟进',description:'原六组环境任务中的连续创造结果。来自另一世界、另一轮模型任务。',source:originalImage},
 {file:'forest-front.png',title:'预制示例：完整正面',description:'开发者组合的林间入口，正常安装与采用后，通过游戏步行后退观察。',capture:report.walkthrough.front.capture},
 {file:'forest-approach.png',title:'预制示例：步行靠近',description:'使用正式有限步行接口沿通道靠近门洞；没有设置玩家位置。',capture:report.walkthrough.approach.capture},
 {file:'forest-inside.png',title:'预制示例：穿过门洞',description:'继续实际步行至门后，展示路径与林内视角。',capture:report.walkthrough.inside.capture},
 {file:'forest-reopened.png',title:'预制示例：保存后冷重开',description:'保存进度，关闭原进程，重新启动同一冻结产品和隔离档案。',capture:report.reopenedCapture},
];
fs.mkdirSync(output,{recursive:true});
const manifest={format:'craftmine.prefab-comparison-evidence/1',disclosure:'旧图为模型原创跟进；森林为开发者组合预制示例。不是相同输入的 A/B，也不是模型自主使用素材的效果。',report:{source:reportFile,sha256:sha(reportBytes),packageIdentity:report.packageIdentity},images:[]};
for(const item of items){
 const source=item.source??path.resolve(path.dirname(reportFile),item.capture.file),bytes=fs.readFileSync(source);
 assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 if(item.capture)assert.equal(sha(bytes),item.capture.sha256);
 fs.writeFileSync(path.join(output,item.file),bytes,{flag:'wx'});
 manifest.images.push({file:item.file,title:item.title,source,sha256:sha(bytes),bytes:bytes.length});
}
fs.writeFileSync(path.join(output,'report.json'),reportBytes,{flag:'wx'});
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const cards=items.map(item=>`<figure><figcaption><h2>${escape(item.title)}</h2><p>${escape(item.description)}</p></figcaption><a href="${item.file}"><img src="${item.file}" alt="${escape(item.title)}" width="1280" height="720"></a></figure>`).join('\n');
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>实际画面 · 原创环境与林间入口预制示例</title><style>body{margin:0;background:#121a20;color:#edf2ee;font:16px/1.6 system-ui,sans-serif}main{max-width:1400px;margin:auto;padding:32px 20px}h1{font-size:30px;line-height:1.3}h2{font-size:20px;margin:0}p{margin:8px 0}header{max-width:1050px;margin-bottom:28px}.note{border-left:4px solid #b2c78e;padding:12px 18px;background:#23312b}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}figure{margin:0;background:#202a33;border:1px solid #34434d;border-radius:10px;overflow:hidden}figure:first-child{grid-column:1/-1;max-width:950px}figcaption{padding:18px}img{width:100%;height:auto;display:block}a{color:#bad99a}footer{margin-top:24px}@media(max-width:800px){.grid{grid-template-columns:1fr}h1{font-size:24px}}</style><main><header><h1>实际画面：原创环境与林间入口预制示例</h1><p class="note">${escape(manifest.disclosure)} 所有图片均为真实产品截图原字节，没有补绘或修改画面。</p><p>预制示例经过正常导入、检查、预览、采用、保存及冷重开；0 次模型调用。两侧树木和草花围出通道，但整体仍是低多边形小场景，叶色偏青、门楼独立、外围平地明显；不是完整自然森林。</p></header><section class="grid">${cards}</section><footer><a href="manifest.json">来源路径与 SHA256 清单</a> · <a href="report.json">完整产品验收报告</a><p>图片可点击查看原始大小。页面仅用于本地审阅，未上传或自动打开浏览器。</p></footer></main></html>`;
fs.writeFileSync(path.join(output,'index.html'),html,{flag:'wx'});
console.log(JSON.stringify({output,page:path.join(output,'index.html'),images:items.length,reportSha256:sha(reportBytes)}));
