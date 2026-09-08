import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ProjectStore,atomicJSON } from './store.mjs';
import { AgentRunner, providerStatus } from './agent.mjs';
import { validateSnapshot, compileScene } from './scene.mjs';
import { verifyBehaviors } from './behavior-verify.mjs';
import { PACKAGE_BYTES } from './asset-packages.mjs';
import { checkCreationModule,rememberCreationCheck } from './creation-verify.mjs';
import { verifyAsset } from './asset-verify.mjs';
import { loadLocalConfig } from './local-config.mjs';
import { capabilitiesCatalog, capabilitiesText } from './harness/capabilities.mjs';
import { summarizeTasks } from './harness/metrics.mjs';
import { judgmentReport, readJudgments } from './harness/judgment-run.mjs';
import { extensionCatalog } from './harness/extension.mjs';
import { stageExtension } from './harness/extension-loader.mjs';
import { withExtensionSandbox } from './harness/extension-sandbox-browser.mjs';
import { findingsToAssertions, parseFindings, reviewPrompt, reviewSummary } from './harness/review.mjs';
import { generateModel } from './agent-model.mjs';
import { STATIC_FILES } from './static-files.mjs';

const APP = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.dirname(APP);
const port = Number(process.env.CRAFTMINE_PORT || 8787), dataRoot = path.resolve(process.env.CRAFTMINE_DATA_DIR || path.join(ROOT,'.craftmine'));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('端口需要在 1024–65535 之间');
fs.mkdirSync(dataRoot, { recursive: true });
const localKeys = loadLocalConfig(path.join(dataRoot, 'secrets.json'));
const lock = path.join(dataRoot, 'server.lock');
if (fs.existsSync(lock)) {
  const old = JSON.parse(fs.readFileSync(lock,'utf8')); let running = true;
  try { process.kill(old.pid,0); } catch (e) { if (e.code === 'ESRCH') running = false; }
  if (running) throw Error('该项目已经有本地服务在运行，请使用已有窗口');
  fs.unlinkSync(lock);
}
fs.writeFileSync(lock, JSON.stringify({pid:process.pid,port}), {flag:'wx'});
const store = new ProjectStore(dataRoot), agent = new AgentRunner(store,{verificationOrigin:`http://127.0.0.1:${port}`}), provider = providerStatus();
const token = randomUUID(); let lease = null, assetImportBusy=false;
const staticFiles=new Map(STATIC_FILES.map(([route,file,type])=>[route,[file,type]]));
// Keep one coherent runtime for this server's lifetime while development continues.
const staticAssets=new Map([...staticFiles].map(([route,[file,type]])=>[route,{type,content:fs.readFileSync(path.join(APP,file))}]));
const pages=new Map(['index.html','game.html','verify.html','asset-viewer.html'].map(file=>[file,fs.readFileSync(path.join(APP,file),'utf8')]));
const runtimeSource=fs.readFileSync(path.join(ROOT,'world-workshop-3d','src','voxel-runtime.js'));
async function checkCode(build,events){
  const report=await verifyBehaviors(build,{origin:`http://127.0.0.1:${port}`,events});
  atomicJSON(path.join(store.root,'builds',build.id,'behavior-verification.json'),report);
  if(!report.passed)throw Error('创作源码未通过后台检查：'+report.modules.filter(m=>!m.passed).map(m=>m.id+'：'+m.error).join('；'));
  return report;
}
async function checkAssets(assets){
  for(const asset of assets){const report=await verifyAsset(asset,{origin:`http://127.0.0.1:${port}`});atomicJSON(path.join(store.root,'assets',asset.id,asset.version+'-'+asset.hash+'.check.json'),report);}
}
// 扩展的对抗评审：评审只能提出带断言的问题，有阻断项就不许装载。
async function reviewExtension(extension) {
  const dir = path.join(dataRoot, 'extensions', 'review-' + extension.id + '-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  const text = await generateModel({
    dir,
    prompt: reviewPrompt({
      said: `新增能力扩展 ${extension.id}@${extension.version}「${extension.name}」`,
      acceptance: extension.description,
      artifact: extension.code,
      evidence: `自带测试 ${extension.selfTests.length} 个；新命令：${extension.provides.commands.map(command => command.type).join('、')}；权限：${extension.permissions.join('、')}`,
      catalog: capabilitiesText({ extensions: extensionCatalog(store.data.extensions) }),
    }),
  });
  const findings = parseFindings(text);
  const summary = reviewSummary(findings);
  return { ...summary, findings, assertions: findingsToAssertions(findings), passed: !summary.blocked };
}
// 完整装载检查：沙箱自带测试 + 反造假 + 对抗评审 + 冻结回归。
async function stageExtensionFully(extension) {
  return withExtensionSandbox(`http://127.0.0.1:${port}`, ({ createRunner }) => stageExtension(extension, {
    loaded: store.data.extensions,
    createRunner,
    review: reviewExtension,
    // 冻结回归是真跑一遍：当前世界的源码要在隔离 Worker 里通过事件与恢复检查。
    verifyWorld: async () => {
      const build = store.readBuild(store.data.current, { resolveAssets: false });
      if (build.behaviors?.length) await checkCode(build);
      return { passed: true, summary: build.behaviors?.length ? `冻结回归：当前世界 ${build.behaviors.length} 个源码模块在隔离 Worker 中通过事件与恢复检查` : '冻结回归：当前世界没有源码模块，构建校验通过' };
    },
  }));
}
// 改动扩展集合前，先确认当前世界还编译得过：依赖被破坏时立刻显式失败。
function assertWorldAccepts(extensions) {
  const scene = store.readBuild(store.data.current, { resolveAssets: false }).scene;
  compileScene(scene, { extensions: new Set(extensions.map(extension => `ext:${extension.id}@${extension.version}`)) });
}
const json = (res, status, data) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(data)); };
async function body(req,limit=1_500_000) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw Error('请求必须为 JSON');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw Error('请求超过大小限制'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
const server = http.createServer(async (req,res) => {
  const host = req.headers.host;
  if (![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)) return json(res,403,{error:'只接受本机访问'});
  const origin = 'http://' + host, url = new URL(req.url,origin);
  res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','no-store');
  try {
    if (url.pathname.startsWith('/api/')) {
      if (req.headers['x-craftmine-token'] !== token || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') return json(res,403,{error:'工作台会话已失效，请刷新页面'});
      if (!['GET','POST'].includes(req.method)) return json(res,405,{error:'不支持的请求方法'});
      if (req.method === 'POST' && req.headers.origin !== origin) return json(res,403,{error:'请求来源无效'});
      const client = req.headers['x-craftmine-client'];
      if (typeof client !== 'string' || !/^[a-zA-Z0-9-]{10,80}$/.test(client)) return json(res,403,{error:'缺少工作台身份'});
      if (url.pathname === '/api/session' && req.method === 'POST') {
        if (lease && lease.id !== client && Date.now()-lease.time < 15000) return json(res,409,{error:'另一个窗口正在使用此项目。请关闭它，等待 15 秒后刷新。'});
        lease = {id:client,time:Date.now()}; return json(res,200,{ok:true,provider});
      }
      if (!lease || lease.id !== client) return json(res,409,{error:'此窗口不再控制项目，请刷新页面'});
      lease.time = Date.now();
      if (req.method === 'GET') {
        if (url.pathname === '/api/state') return json(res,200,{...store.data,provider});
        if (url.pathname === '/api/build') return json(res,200,store.readBuild(url.searchParams.get('id')));
        if (url.pathname === '/api/tasks/attempt') return json(res,200,store.readAttempt(url.searchParams.get('id'),Number(url.searchParams.get('number'))));
        if (url.pathname === '/api/tasks/context') return json(res,200,store.readTaskContext(url.searchParams.get('id')));
        if (url.pathname === '/api/candidate/review') return json(res,200,store.reviewCandidate(url.searchParams.get('id'),url.searchParams.get('base')));
        if (url.pathname === '/api/export') return json(res,200,store.exportSave());
        if (url.pathname === '/api/modules/read') return json(res,200,store.modules.read(store.data,url.searchParams.get('id'),Number(url.searchParams.get('version'))));
        if (url.pathname === '/api/modules/export') return json(res,200,store.exportModule(url.searchParams.get('id'),Number(url.searchParams.get('version'))));
        if (url.pathname === '/api/assets/read') return json(res,200,store.assets.read(store.data,url.searchParams.get('id'),Number(url.searchParams.get('version'))));
        if (url.pathname === '/api/capabilities') return json(res,200,capabilitiesCatalog({extensions:extensionCatalog(store.data.extensions)}));
    if (url.pathname === '/api/extensions') return json(res,200,{format:'craftmine.extensions/1',loaded:extensionCatalog(store.data.extensions),history:(store.data.extensionHistory||[]).map(extension=>({id:extension.id,version:extension.version})),available:providerStatus().available});
        if (url.pathname === '/api/metrics') return json(res,200,summarizeTasks(store.data.tasks));
    if (url.pathname === '/api/judgment') return json(res,200,{report:judgmentReport(),runs:readJudgments(store.root).map(run=>({started:run.started,signature:run.signature,metrics:run.metrics}))});
      } else {
        const input = await body(req,['/api/import','/api/modules/import'].includes(url.pathname)?PACKAGE_BYTES:url.pathname==='/api/assets/import'?12_000_000:1_500_000);
        switch (url.pathname) {
          case '/api/save': store.save(input.version,input.snapshot); break;
          case '/api/project-context': store.editContext(input); return json(res,200,{ok:true,projectContext:store.data.projectContext});
          case '/api/assets/bind': {
            const base=store.data.current,build=store.bindAsset(input),object=build.scene.objects.find(o=>o.id===input.objectId);await checkCode(build);store.idle();
            store.stage(build,object.appearance?`更换「${object.name}」外观（素材 v${object.appearance.asset.version}）`:`恢复「${object.name}」的原几何外观`,base,null,['素材固定版本、哈希和世界资源预算通过','对象 ID、碰撞定义和玩法源码保留；应用时读取最新进度']);break;
          }
          case '/api/assets/import': {
            if(assetImportBusy)throw Error('另一个素材正在检查，请稍候');assetImportBusy=true;
            try{const asset=store.assets.prepare(store.data,input),report=await verifyAsset(asset,{origin:`http://127.0.0.1:${port}`});atomicJSON(path.join(store.root,'assets',asset.id,asset.version+'-'+asset.hash+'.check.json'),report);store.change(d=>store.assets.register(d,asset));return json(res,200,{ok:true,id:asset.id,version:asset.version,report});}finally{assetImportBusy=false;}
          }
          case '/api/tasks': {
            if (input.version !== store.data.current) throw Error('运行版本已过期，请刷新后重试');
            if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 2000 || !['execute','discuss'].includes(input.intent)) throw Error('请输入 1–2000 字的需求');
            if (!provider.available) throw Error(provider.message);
            const player = validateSnapshot({format:'craftmine.progress/1',player:input.context?.player}).player;
            const selected = input.context?.selected;
            if (selected !== null && (typeof selected !== 'string' || !store.readBuild(store.data.current).scene.objects.some(o => o.id === selected))) throw Error('所指对象已不存在，请重新选择');
            const id = agent.start(input.prompt.trim(),input.intent,{player,selected,version:input.version});
            return json(res,200,{ok:true,id});
          }
          case '/api/cancel': agent.cancel(); break;
          case '/api/discard': store.discard(); break;
          case '/api/rollback': store.rollback(input.id); break;
          case '/api/apply/prepare': return json(res,200,store.prepare(input.candidateId,input.version,input.snapshot));
          case '/api/apply/commit': store.commit(input.id,input.snapshot); break;
          case '/api/apply/abort': store.abort(input.id); break;
          case '/api/extensions/propose': return json(res,200,await stageExtensionFully(input.extension));
        case '/api/extensions/activate': {
          // 启用时重新跑一遍完整检查，不复用 propose 的结果。
          const staged = await stageExtensionFully(input.extension);
          if (staged.status !== 'ready') throw Error(staged.error);
          const previous = store.data.extensions.find(extension => extension.id === staged.extension.id) || null;
          const next = store.data.extensions.filter(extension => extension.id !== staged.extension.id).concat([staged.extension]);
          assertWorldAccepts(next);
          store.change(d => {
            d.extensions = next;
            d.extensionHistory = [...(d.extensionHistory || []).filter(extension => extension.id !== staged.extension.id), ...(previous ? [previous] : [])].slice(-10);
          });
          return json(res,200,{ok:true,activated:staged.requirement,previous:previous?`ext:${previous.id}@${previous.version}`:null,checks:staged.checks});
        }
        case '/api/extensions/rollback': {
          const history = (store.data.extensionHistory || []).filter(extension => extension.id === input.id);
          const previous = history[history.length - 1];
          if (!previous) throw Error(`扩展 ${input.id} 没有可以回退的历史版本`);
          const next = store.data.extensions.filter(extension => extension.id !== input.id).concat([previous]);
          assertWorldAccepts(next);
          store.change(d => {
            d.extensions = next;
            // 按 id+版本消费历史条目：深拷贝后引用比较不成立，会导致回退永远回到同一版。
            d.extensionHistory = (d.extensionHistory || []).filter(extension => !(extension.id === previous.id && extension.version === previous.version));
          });
          return json(res,200,{ok:true,activated:`ext:${previous.id}@${previous.version}`});
        }
        case '/api/extensions/unload': {
          const remaining = store.data.extensions.filter(extension => extension.id !== input.id);
          if (remaining.length === store.data.extensions.length) throw Error(`扩展 ${input.id} 没有装载`);
          // 卸载前先确认没有模块依赖它：依赖方在这里显式失败，而不是静默失效。
          assertWorldAccepts(remaining);
          store.change(d => { d.extensions = remaining; });
          return json(res,200,{ok:true,unloaded:input.id});
        }
        case '/api/import': {
            if(assetImportBusy)throw Error('另一个素材或作品正在检查，请稍候');assetImportBusy=true;
            try{store.idle();const base=store.data.current,{build,assets}=store.prepareSave(input);await checkAssets(assets);
            if(build.behaviors?.length){
              const verification=await verifyBehaviors(build,{origin:`http://127.0.0.1:${port}`});
              atomicJSON(path.join(store.root,'builds',build.id,'behavior-verification.json'),verification);
              if(!verification.passed)throw Error('导入源码未通过后台检查：'+verification.modules.filter(m=>!m.passed).map(m=>m.id+'：'+m.error).join('；'));
            }
            store.importSave(input,base);
            if(build.behaviors?.length)store.change(d=>d.candidate.checks.push('导入源码已在隔离 Worker 中通过事件和恢复检查'));
            }finally{assetImportBusy=false;}break;
          }
          case '/api/modules/import': {
            if(assetImportBusy)throw Error('另一个素材或作品正在检查，请稍候');assetImportBusy=true;
            try{store.idle();const {module,assets}=store.prepareModule(input);await checkAssets(assets);
              const report=module.kind==='creation'?await checkCreationModule(store,module,{origin:`http://127.0.0.1:${port}`,assets}):null;
              store.importModule(input);if(report)rememberCreationCheck(store,module,report);
            }finally{assetImportBusy=false;}break;
          }
          case '/api/modules/reuse': {
            if(input.version!==store.data.current)throw Error('运行版本已过期，请刷新后重试');
            const player=validateSnapshot({format:'craftmine.progress/1',player:input.player}).player;
            const module=store.modules.read(store.data,input.id,input.moduleVersion);
            if(module.kind==='creation'){
              store.idle();const report=await checkCreationModule(store,module,{origin:`http://127.0.0.1:${port}`});store.idle();rememberCreationCheck(store,module,report);
              const base=store.data.current,build=store.build(store.modules.instantiate(store.data,store.readBuild(base).scene,input.id,input.moduleVersion,player));
              await checkCode(build,module.payload.tests.events);store.idle();store.stage(build,`复用完整创作「${module.name}」v${module.version}`,base,null,['源码、参数、对象关系、依赖与检查用例已从记忆读取','新实例的源码在后台执行和恢复检查通过']);
            }else store.reuseModule(input.id,input.moduleVersion,player);break;
          }
          case '/api/creations/change': {
            if(input.version!==store.data.current)throw Error('运行版本已过期，请刷新后重试');store.idle();const base=store.data.current;
            const build=store.build(store.modules.changeCreation(store.data,store.readBuild(base).scene,input.instanceId,input.moduleVersion));
            if(build.id===base)throw Error('此实例已经使用该版本');
            await checkCode(build);store.idle();store.stage(build,input.moduleVersion===null?'卸载完整创作（保留可恢复进度）':'切换创作实例到 v'+input.moduleVersion,base,null,['实例身份与依赖已校验','源码检查通过；应用时保留兼容进度']);break;
          }
          default: return json(res,404,{error:'接口不存在'});
        }
        return json(res,200,{ok:true});
      }
      return json(res,404,{error:'接口不存在'});
    }
    if (req.method !== 'GET') return json(res,405,{error:'不支持的请求方法'});
    const isGame=url.pathname==='/game',isAssetViewer=url.pathname==='/asset-viewer';
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'"+(isGame?" blob:":'')+"; worker-src "+(isGame?"blob:":"'none'")+"; style-src 'self'; img-src 'self' data:; connect-src " + (isGame||isAssetViewer ? "'none'" : "'self'") + "; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
    if (url.pathname === '/') {
      res.setHeader('Content-Type','text/html; charset=utf-8');
      return res.end(pages.get('index.html').replace('SESSION_TOKEN',token));
    }
    if (url.pathname === '/game') { res.setHeader('Content-Type','text/html; charset=utf-8'); return res.end(pages.get('game.html')); }
    if (url.pathname === '/asset-viewer') { res.setHeader('Content-Type','text/html; charset=utf-8'); return res.end(pages.get('asset-viewer.html')); }
    if (url.pathname === '/verify') { res.setHeader('Content-Type','text/html; charset=utf-8'); return res.end(pages.get('verify.html')); }
    if (url.pathname === '/runtime.js') { res.setHeader('Content-Type','text/javascript; charset=utf-8'); return res.end(runtimeSource); }
    if (staticAssets.has(url.pathname)) { const {type,content}=staticAssets.get(url.pathname);res.setHeader('Content-Type',type+'; charset=utf-8');if(type==='text/javascript')res.setHeader('Access-Control-Allow-Origin','*');return res.end(content); }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    return json(res,404,{error:'文件不存在'});
  } catch (error) { json(res,400,{error:error.message}); }
});
server.on('error',error => { console.error(error.message); cleanup(); process.exitCode=1; });
server.listen(port,'127.0.0.1',()=> console.log(`craftmine world: http://127.0.0.1:${port}\n${provider.message}${localKeys.length?`\n已从本地密钥文件加载：${localKeys.join('、')}`:''}`));
function cleanup() {
  if (agent.active) agent.cancel();
  if (fs.existsSync(lock) && JSON.parse(fs.readFileSync(lock,'utf8')).pid === process.pid) fs.unlinkSync(lock);
}
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=> { cleanup(); server.close(()=>process.exit()); setTimeout(()=>process.exit(),1000).unref(); });
process.on('exit',()=> { if (fs.existsSync(lock) && JSON.parse(fs.readFileSync(lock,'utf8')).pid === process.pid) fs.unlinkSync(lock); });
