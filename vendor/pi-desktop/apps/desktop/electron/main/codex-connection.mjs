import { execFile } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import { CodexAppServer, CLI_VERSION, MODEL, EFFORT, processEnvironment } from '../../../../packages/agent-runtime/src/codex-app-server.mjs';

const actions = new Set(['detect', 'pick', 'verify', 'login', 'status', 'cancel', 'openLogin', 'instructions']);
const codes = new Set(['CODEX_PATH_REQUIRED', 'CODEX_NOT_FOUND', 'CODEX_VERSION_MISMATCH', 'CODEX_CONNECTION_FAILED',
  'CODEX_CHATGPT_LOGIN_REQUIRED', 'CODEX_AUTH_MODE_UNSUPPORTED', 'CODEX_MODEL_UNAVAILABLE', 'CODEX_EFFORT_UNAVAILABLE',
  'CODEX_LOGIN_FAILED', 'CODEX_LOGIN_URL_INVALID', 'CODEX_CUSTOM_ENDPOINT_UNSUPPORTED', 'CODEX_MCP_NAME_UNSUPPORTED']);
const fail = code => { throw Error(code); };
const text = value => typeof value === 'string' ? value.slice(0, 200) : undefined;
function loginUrl(value) {
  let url; try { url = new URL(value); } catch { fail('CODEX_LOGIN_URL_INVALID'); }
  if (url.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com'].includes(url.hostname) || url.username || url.password || url.port)
    fail('CODEX_LOGIN_URL_INVALID');
  return url.href;
}
export function inspectCodexVersion(binary, cwd) {
  return new Promise((resolve, reject) => execFile(binary, ['--version'], {
    cwd, env: processEnvironment(), windowsHide: true, shell: false,
    timeout: 15000, maxBuffer: 4096,
  }, (error, stdout) => error ? reject(Error('CODEX_NOT_FOUND')) : resolve(stdout.trim())));
}
export async function detectCodexBinary(env = process.env) {
  // Native executables only. Never execute npm's cmd/PowerShell wrappers.
  const names = process.platform === 'win32' ? ['codex.exe'] : ['codex'];
  for (const directory of (env.PATH || env.Path || '').split(delimiter).filter(isAbsolute)) {
    for (const name of names) {
      const candidate = join(directory, name);
      try { await access(candidate); return candidate; } catch { /* next PATH entry */ }
    }
  }
  return undefined;
}

/** A single settings connection, independent of author turns and their budgets. */
export class CodexConnection {
  constructor({ cwd, pick, openExternal, clientFactory = options => new CodexAppServer(options),
    inspectVersion = inspectCodexVersion, detect = detectCodexBinary }) {
    Object.assign(this, { cwd, pick, openExternal, clientFactory, inspectVersion, detect });
    this.state = this.result('idle'); this.generation = 0; this.busy = false;
  }
  result(code, extra = {}) {
    return { code, requiredVersion: CLI_VERSION, model: MODEL, effort: EFFORT, ...extra };
  }
  async dispose() { await this.cancel(); }
  async cancel() {
    ++this.generation;
    const client = this.client, loginId = this.loginId;
    this.client = undefined; this.loginId = undefined; this.authUrl = undefined;
    this.state = this.result('cancelled', { path: this.state.path });
    if (client) {
      // Close also stops a pending initialize or failed cancellation RPC.
      if (loginId && !client.closed) void client.call('account/login/cancel', { loginId }).catch(() => {});
      await client.close();
    }
    return this.state;
  }
  async verifyAccount(client, generation) {
    const { account } = await client.call('account/read', { refreshToken: true });
    const summary = account ? { type: text(account.type), email: text(account.email), plan: text(account.planType) } : undefined;
    let code = account ? 'CODEX_AUTH_MODE_UNSUPPORTED' : 'CODEX_CHATGPT_LOGIN_REQUIRED';
    if (account?.type === 'chatgpt') {
      let cursor, match;
      const seen = new Set();
      do {
        const page = await client.call('model/list', { includeHidden: true, ...(cursor ? { cursor } : {}) });
        if (!Array.isArray(page.data)) fail('CODEX_CONNECTION_FAILED');
        match = page.data.find(model => model.model === MODEL);
        if (match) break;
        cursor = page.nextCursor;
        if (cursor && (typeof cursor !== 'string' || seen.has(cursor))) fail('CODEX_CONNECTION_FAILED');
        seen.add(cursor);
      } while (cursor);
      code = !match ? 'CODEX_MODEL_UNAVAILABLE' :
        !match.supportedReasoningEfforts?.some(item => item.reasoningEffort === EFFORT) ? 'CODEX_EFFORT_UNAVAILABLE' : 'ready';
    }
    if (generation === this.generation) this.state = { ...this.state, code, account: summary, loginPending: false };
    return this.state;
  }
  async invoke(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request) || !actions.has(request.action) ||
      Object.keys(request).some(key => !['action', 'path'].includes(key)) ||
      (request.path !== undefined && (typeof request.path !== 'string' || request.path.length > 4096)))
      throw Error('CODEX_INVALID_REQUEST');
    const { action } = request;
    if (action === 'status') return { ...this.state };
    if (action === 'cancel') return this.cancel();
    if (this.busy || this.state.loginPending && !['openLogin'].includes(action)) return { ...this.state };
    this.busy = true;
    const generation = ++this.generation;
    try {
      if (action === 'instructions') {
        await this.openExternal('https://learn.chatgpt.com/docs/cli');
        return this.state;
      }
      if (action === 'openLogin') {
        if (!this.loginId || !this.authUrl) return this.result('CODEX_CHATGPT_LOGIN_REQUIRED');
        // Only a player action opens the URL returned by this exact login.
        await this.openExternal(loginUrl(this.authUrl));
        return this.state;
      }
      let binary = request.path?.trim();
      if (action === 'pick') binary = await this.pick();
      if (action === 'detect') binary = await this.detect();
      if (action === 'pick' && !binary) return this.state;
      this.state = this.result('checking', { path: binary });
      if (!binary) fail(action === 'detect' ? 'CODEX_NOT_FOUND' : 'CODEX_PATH_REQUIRED');
      if (!isAbsolute(binary)) fail('CODEX_PATH_REQUIRED');
      await mkdir(this.cwd, { recursive: true });
      const version = await this.inspectVersion(binary, this.cwd);
      if (generation !== this.generation) return this.state;
      // Never reflect arbitrary executable stdout into the renderer.
      this.state = { ...this.state, version: /^codex-cli [0-9A-Za-z.+-]+$/.test(version) ? version : undefined };
      if (version !== CLI_VERSION) fail('CODEX_VERSION_MISMATCH');
      if (action === 'pick' || action === 'detect') return this.state = { ...this.state, code: 'detected' };
      const client = this.clientFactory({ binary, cwd: this.cwd });
      this.client = client;
      client.on('request', message => client.reject(message.id));
      client.on('failure', () => {
        if (this.client !== client) return;
        this.client = undefined;
        this.loginId = undefined; this.authUrl = undefined;
        this.state = { ...this.state, code: 'CODEX_CONNECTION_FAILED', loginPending: false };
        void client.close();
      });
      await client.start({ requireAccount: false });
      if (generation !== this.generation) return this.state;
      await this.verifyAccount(client, generation);
      if (action !== 'login' || this.state.account?.type === 'chatgpt') return this.state;
      let loginResponsePending = true, earlyCompletion;
      const completed = message => {
        if (message.method !== 'account/login/completed' || this.client !== client) return;
        if (loginResponsePending) { earlyCompletion = message; return; }
        if (!this.loginId || message.params?.loginId !== this.loginId) return;
        this.loginId = undefined; this.authUrl = undefined;
        this.busy = true;
        const current = this.generation;
        void (async () => {
          try {
            if (!message.params.success) fail('CODEX_LOGIN_FAILED');
            await this.verifyAccount(client, current);
          } catch { if (current === this.generation) this.state = { ...this.state, code: 'CODEX_LOGIN_FAILED', loginPending: false }; }
          finally { if (this.client === client) this.client = undefined; await client.close(); this.busy = false; }
        })();
      };
      client.on('notification', completed);
      const login = await client.call('account/login/start', { type: 'chatgpt' });
      if (generation !== this.generation) return this.state;
      if (login.type !== 'chatgpt' || typeof login.loginId !== 'string' || !login.loginId) fail('CODEX_LOGIN_FAILED');
      this.authUrl = loginUrl(login.authUrl); this.loginId = login.loginId;
      this.state = { ...this.state, code: 'login_pending', loginPending: true };
      loginResponsePending = false;
      if (earlyCompletion) queueMicrotask(() => completed(earlyCompletion));
      return this.state;
    } catch (error) {
      this.loginId = undefined; this.authUrl = undefined;
      if (generation === this.generation) this.state = { ...this.state,
        code: codes.has(error.message) ? error.message : 'CODEX_CONNECTION_FAILED', loginPending: false };
      return this.state;
    } finally {
      if (!this.loginId && this.client) {
        const client = this.client; this.client = undefined; await client.close();
      }
      this.busy = false;
    }
  }
}
