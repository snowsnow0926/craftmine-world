import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {EventEmitter} from 'node:events';

export const MODEL = 'gpt-6-astra';
export const EFFORT = 'xhigh';
export const CLI_VERSION = 'codex-cli 0.154.0-alpha.6.2';

// These are trusted host settings, never model arguments. Environment access is
// additionally disabled on thread/start AND every turn/start (including resume).
export const LOCKED_CONFIG = Object.freeze({
  model: MODEL, model_provider: 'openai', model_reasoning_effort: EFFORT,
  approval_policy: 'never', sandbox_mode: 'read-only', web_search: 'disabled',
  project_doc_max_bytes: 0, notify: [], include_apps_instructions: false,
  include_environment_context: false, include_collaboration_mode_instructions: false,
  'skills.include_instructions': false,
  'features.shell_tool': false, 'features.unified_exec': false,
  'features.apply_patch_freeform': false, 'features.view_image': false,
  'features.code_mode': {enabled:false,direct_only_tool_namespaces:['craftmine']},
  'features.code_mode_only': false, 'features.code_mode_host': false,
  'features.js_repl': false, 'features.apps': false, 'features.plugins': false,
  'features.connectors': false, 'features.browser_use': false,
  'features.computer_use': false, 'features.in_app_browser': false,
  'features.multi_agent': false, 'features.multi_agent_v2': false,
  'features.collab': false, 'features.image_generation': false,
  'features.imagegenext': false, 'features.memories': false,
  'features.memory_tool': false, 'features.skip_host_skill_discovery': true,
  'features.hooks': false, 'features.codex_hooks': false,
  'features.plugin_hooks': false, 'features.remote_control': false,
  'features.request_permissions_tool': false,
  'orchestrator.skills.enabled': false, 'orchestrator.mcp.enabled': false,
});

export function redact(value) {
  if (typeof value === 'string') return value
    .replace(/\bBearer\s+[^\s"\\]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) =>
    [k, /^(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|password|secret|credential)s?$/i.test(k) ? '[REDACTED]' : redact(v)]));
  return value;
}

const DIAGNOSTIC_STAGES = new Set(['context','checkpoint-load','binary-verify','app-server-start','thread-start','thread-resume','checkpoint-save','history-restore','turn-start']);
const DIAGNOSTIC_METHODS = new Set(['initialize','config/read','account/read','thread/start','thread/resume','turn/start']);
export function protocolDiagnostic(error, stage) {
  const detail = {stage: DIAGNOSTIC_STAGES.has(stage) ? stage : 'unknown'};
  if (!Number.isSafeInteger(error?.rpcCode) || !DIAGNOSTIC_METHODS.has(error?.rpcMethod)) return detail;
  detail.rpcMethod = error.rpcMethod;
  detail.rpcCode = error.rpcCode;
  if (typeof error.diagnostic === 'string') {
    // Only the RPC message is selected; no params, stderr, headers or data blob.
    // Redact before truncating so a partially cut secret cannot evade matching.
    const message = redact(error.diagnostic)
      .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|authorization|password|secret|credential)\s*[=:]\s*["']?)[^\s"'&,}]+/gi,'$1[REDACTED]')
      .replace(/https?:\/\/[^\s"'<>]+/g,'[URL]')
      .replace(/(?:file:\/\/\/)?\b[A-Za-z]:[\\/][^\r\n"'<>]*?(?=:\s|["'\r\n<>]|$)/g,'[LOCAL_PATH]')
      .replace(/\/(?:Users|home|private|tmp)\/[^\s"'<>]+/g,'[LOCAL_PATH]')
      .replace(/\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,'[ACCOUNT]')
      .replace(/[\u0000-\u001f\u007f]/g,' ');
    detail.message = [...message].slice(0,1024).join('') + ([...message].length > 1024 ? ' [truncated]' : '');
  }
  return detail;
}

export function processEnvironment(env = process.env) {
  // Codex opens its own existing credential store. Do not read/copy auth.json,
  // request account tokens, inherit API keys, or pass host/provider secrets.
  const allowed = new Set(['systemroot','windir','path','pathext','comspec','temp','tmp',
    'userprofile','home','homedrive','homepath','appdata','localappdata','codex_home']);
  return Object.fromEntries(Object.entries(env).filter(([k]) => allowed.has(k.toLowerCase())));
}

export function tomlValue(value) {
  if(Array.isArray(value))return '['+value.map(tomlValue).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.entries(value).map(([key,item])=>JSON.stringify(key)+'='+tomlValue(item)).join(',')+'}';
  return JSON.stringify(value);
}

export class CodexAppServer extends EventEmitter {
  constructor({binary, cwd, spawnProcess = spawn}) {
    super(); this.binary = binary; this.cwd = cwd; this.spawnProcess = spawnProcess;
    this.sequence = 0; this.pending = new Map(); this.closed = false;
  }
  async start({requireAccount = true} = {}) {
    const args = ['app-server', '--listen', 'stdio://'];
    for (const [key,value] of Object.entries(LOCKED_CONFIG)) args.push('-c', `${key}=${tomlValue(value)}`);
    this.child = this.spawnProcess(this.binary, args, {
      cwd: this.cwd, env: processEnvironment(), windowsHide: true, shell: false,
      stdio: ['pipe','pipe','pipe'],
    });
    this.exited = new Promise(resolve => this.child.once('close', resolve));
    const fail = error => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear(); this.emit('failure', error);
    };
    this.child.on('error', () => fail(Error('CODEX_PROCESS_START_FAILED')));
    this.child.on('exit', code => fail(Error(`CODEX_PROCESS_EXIT:${code}`)));
    this.child.stdin.on('error', () => fail(Error('CODEX_TRANSPORT_CLOSED')));
    // Raw stderr can contain paths, provider headers or account details. Never
    // stream or persist it. Diagnostics use protocol error codes instead.
    this.child.stderr.on('data', () => {});
    this.lines = createInterface({input: this.child.stdout});
    this.lines.on('line', line => {
      let msg;
      try { msg = JSON.parse(line); if(!msg||typeof msg!=='object'||Array.isArray(msg))throw Error(); }
      catch { fail(Error('CODEX_PROTOCOL_INVALID_JSON')); this.child.kill(); return; }
      if (msg.method) this.emit(msg.id === undefined ? 'notification' : 'request', msg);
      else if (this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id); this.pending.delete(msg.id);
        if (msg.error) p.reject(Object.assign(Error(`CODEX_RPC_ERROR:${msg.error.code}`), {rpcMethod:p.method,rpcCode: msg.error.code, diagnostic:redact(msg.error.message)}));
        else p.resolve(msg.result);
      }
    });
    await this.call('initialize', {clientInfo: {name:'craftmine_world_author', version:'1.0.0'}, capabilities:{experimentalApi:true}});
    this.send({method:'initialized', params:{}});
    // Read only to turn OFF each inherited MCP entry. Values are never logged,
    // copied to project state, or shown to the author. No thread exists yet.
    const {config} = await this.call('config/read', {includeLayers:false});
    this.threadConfig = {...LOCKED_CONFIG};
    for (const name of Object.keys(config?.mcp_servers ?? {})) {
      if (!/^[A-Za-z0-9_-]+$/.test(name)) throw Error('CODEX_MCP_NAME_UNSUPPORTED');
      this.threadConfig[`mcp_servers.${name}.enabled`] = false;
    }
    // An inherited alternate provider endpoint must not receive player prompts
    // or login material. Fail instead of attempting to repair user settings.
    if (config?.model_providers?.openai || config?.openai_base_url ||
        (config?.chatgpt_base_url && config.chatgpt_base_url !== 'https://chatgpt.com/backend-api/'))
      throw Error('CODEX_CUSTOM_ENDPOINT_UNSUPPORTED');
    const {account} = await this.call('account/read', {refreshToken:false});
    if (requireAccount && account?.type !== 'chatgpt') throw Error('CODEX_CHATGPT_LOGIN_REQUIRED');
    return {authenticated:account?.type === 'chatgpt', model:MODEL, effort:EFFORT};
  }
  send(message) {
    if (this.closed || !this.child?.stdin.writable) throw Error('CODEX_TRANSPORT_CLOSED');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  call(method, params) {
    const id = ++this.sequence;
    return new Promise((resolve,reject) => {
      this.pending.set(id,{resolve,reject,method});
      try { this.send({id,method,params}); } catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  respond(id, result) { if (!this.closed) this.send({id,result}); }
  reject(id) { if (!this.closed) this.send({id,error:{code:-32601,message:'Host operation not exposed'}}); }
  async close() {
    if (!this.child) return;
    this.child.stdin.end();
    // A shutdown grace is process cleanup, never an authoring time budget.
    const timer = setTimeout(() => this.child.kill(), 2000);
    await this.exited; clearTimeout(timer); this.lines?.close();
  }
}
