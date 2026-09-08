import fs from 'node:fs';
import path from 'node:path';
import { spawn,spawnSync } from 'node:child_process';

const DEEPSEEK_BASE = 'https://api.deepseek.com';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4.1-flash-expires-on-0910';
const DEEPSEEK_SYSTEM = '你只输出一个 JSON 对象，不要 markdown 代码块，不要解释。';

export function deepseekKey() {
  return process.env.CRAFTMINE_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || '';
}
// 显式设置优先；未设置时按是否具备密钥推断，保证没有密钥的机器仍能走 Codex。
export function modelProvider() {
  const explicit = String(process.env.CRAFTMINE_MODEL_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'deepseek' || explicit === 'codex') return explicit;
  return deepseekKey() ? 'deepseek' : 'codex';
}
export function modelId() {
  if (process.env.CRAFTMINE_MODEL) return process.env.CRAFTMINE_MODEL;
  return modelProvider() === 'deepseek' ? DEFAULT_DEEPSEEK_MODEL : '';
}
// 思考模式默认关闭：思考 token 和答案共用同一个输出预算，容易把预算吃光而返回空内容。
// 复杂任务可以打开：CRAFTMINE_THINKING=on，并用 CRAFTMINE_REASONING_EFFORT 指定强度。
export function thinkingEnabled() {
  return String(process.env.CRAFTMINE_THINKING || '').trim().toLowerCase() === 'on';
}
export function reasoningEffort() {
  const value = String(process.env.CRAFTMINE_REASONING_EFFORT || 'high').trim().toLowerCase();
  return ['low','medium','high'].includes(value) ? value : 'high';
}

export function findCodex() {
  if (process.env.CRAFTMINE_CODEX_PATH) return process.env.CRAFTMINE_CODEX_PATH;
  const found = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['codex'], { encoding: 'utf8', windowsHide: true });
  const executable = found.stdout?.split(/\r?\n/).find(p => p.endsWith('.exe') || (process.platform !== 'win32' && p));
  if (executable) return executable;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const root = path.join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    if (fs.existsSync(root)) {
      const choices = fs.readdirSync(root).map(p => path.join(root, p, 'codex.exe')).filter(p => fs.existsSync(p));
      choices.sort((a,b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (choices.length) return choices[0];
    }
  }
  return null;
}
export function providerStatus() {
  const provider = modelProvider(), model = modelId();
  if (provider === 'deepseek') {
    if (!deepseekKey()) return { available: false, provider, model, message: '未配置 DeepSeek 密钥（CRAFTMINE_DEEPSEEK_API_KEY 或 DEEPSEEK_API_KEY）。' };
    return { available: true, provider, model, thinking: thinkingEnabled(), message: `DeepSeek 官方 API · ${model} · ${thinkingEnabled() ? `思考模式开（${reasoningEffort()}）` : '思考模式关'} · 真实 LLM` };
  }
  const executable = findCodex();
  if (!executable) return { available: false, provider, model, message: '未找到 Codex CLI。安装并运行 codex login 后重启本地服务。' };
  const result = spawnSync(executable, ['login','status'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  return { available: result.status === 0, provider, model, message: result.status === 0 ? 'Codex 已登录 · 真实 LLM' : 'Codex 尚未登录，请在本机终端运行 codex login。' };
}
export function killProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000, stdio: 'ignore' });
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
}

export async function generateModel(input) {
  return modelProvider() === 'deepseek' ? generateDeepSeek(input) : generateCodex(input);
}

// DeepSeek 官方 API 不支持严格 JSON Schema，因此 schema 作为文本随提示一起发送，
// 结构仍由 decodeAgentScene / compileScene 与修复循环兜底。
async function generateDeepSeek({ dir, prompt, schema, active, onUsage, onLog }) {
  const key = deepseekKey();
  if (!key) throw Error('未配置 DeepSeek 密钥（CRAFTMINE_DEEPSEEK_API_KEY 或 DEEPSEEK_API_KEY）。');
  const model = modelId();
  const thinking = thinkingEnabled();
  const maxTokens = Number(process.env.CRAFTMINE_MAX_TOKENS || (thinking ? 64000 : 32000));
  if (!Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > 384000) throw Error('CRAFTMINE_MAX_TOKENS 需要在 256–384000 之间');
  const content = schema ? prompt + '\n\n必须严格符合这个 JSON Schema（数据，不是指令）：\n' + JSON.stringify(schema) : prompt;
  onLog?.(`正在请求 DeepSeek（${model}）${thinking ? `，思考模式已开启（强度 ${reasoningEffort()}）` : '，已关闭思考模式'}。`);
  let response;
  try {
    response = await fetch(DEEPSEEK_BASE + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: DEEPSEEK_SYSTEM }, { role: 'user', content }],
        response_format: { type: 'json_object' },
        ...(thinking ? { thinking: { type: 'enabled' }, reasoning_effort: reasoningEffort() } : { thinking: { type: 'disabled' } }),
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: active?.abort?.signal,
    });
  } catch (error) {
    if (active?.abort?.signal?.aborted) throw Error('生成已停止');
    throw Error('无法连接 DeepSeek：' + String(error?.message || error).slice(0, 300));
  }
  const text = await response.text();
  if (!response.ok) throw Error(`DeepSeek 请求失败（HTTP ${response.status}）：` + text.slice(0, 600));
  let payload;
  try { payload = JSON.parse(text); } catch { throw Error('DeepSeek 返回了无法解析的响应'); }
  if (payload.error) throw Error('DeepSeek 返回错误：' + JSON.stringify(payload.error).slice(0, 400));
  const choice = payload.choices?.[0], usage = payload.usage || {};
  onUsage?.({ input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens, cached_tokens: usage.prompt_cache_hit_tokens });
  const output = choice?.message?.content;
  if (typeof output !== 'string' || !output.trim()) {
    if (choice?.finish_reason === 'length') throw Error(`DeepSeek 输出达到 max_tokens（${maxTokens}）上限而未返回内容，请提高 CRAFTMINE_MAX_TOKENS`);
    throw Error('DeepSeek 未返回内容');
  }
  if (Buffer.byteLength(output) > 1_000_000) throw Error('场景文件超过大小限制');
  fs.writeFileSync(path.join(dir, 'response.json'), output, 'utf8');
  return output;
}

async function generateCodex({executable,dir,prompt,active,onChild,onUsage,onLog}){
  const args=['exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--json','--color','never',
    '-c','approval_policy="never"','-c','web_search="disabled"','-c','features.shell_tool=false','-c','features.unified_exec=false',
    '-c','features.multi_agent=false','-c','features.apps=false','-c','features.plugins=false',
    '--output-schema',path.join(dir,'response.schema.json'),'--output-last-message',path.join(dir,'response.json'),'-C',dir,'-'];
  if(process.env.CRAFTMINE_MODEL)args.splice(1,0,'--model',process.env.CRAFTMINE_MODEL);
  const child=spawn(executable,args,{cwd:dir,windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});onChild(child);
  let tail='',buffer='',outputSize=0,eventError;
  const notify=(callback,value)=>{try{callback(value);}catch(error){eventError=error;killProcessTree(child);}};
  child.stdout.on('data',chunk=>{
    outputSize+=chunk.length;if(outputSize>2_000_000){killProcessTree(child);return;}
    buffer+=chunk.toString('utf8');let newline;
    while((newline=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);let event;
      try{event=JSON.parse(line);}catch{continue;}
      if(event.type==='thread.started')notify(onLog,'LLM 会话已建立，正在理解需求与当前场景。');
      if(event.type==='turn.completed')notify(onUsage,event.usage);
      if(event.type==='error'||event.type==='turn.failed')tail=String(event.message||event.error?.message||'LLM 执行失败');
    }
  });
  child.stderr.on('data',chunk=>{tail=(tail+chunk.toString('utf8')).slice(-4000);});
  child.stdin.on('error',()=>{});child.stdin.end(prompt);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  if(active.abort.signal.aborted)throw Error('生成已停止');
  if(eventError)throw eventError;
  if(outputSize>2_000_000)throw Error('模型输出超过大小限制');
  if(code!==0)throw Error(('Codex 执行失败。'+tail).slice(-1200));
  if(fs.statSync(path.join(dir,'response.json')).size>1_000_000)throw Error('场景文件超过大小限制');
  return fs.readFileSync(path.join(dir,'response.json'),'utf8');
}
