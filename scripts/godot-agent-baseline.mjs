// Offline GU0 evidence: read-only SQLite, Git metadata and file hashes only.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const BINDING_KEYS = new Set(['id', 'contextWindow', 'maxTokens', 'thinkingLevels', 'defaultThinkingLevel', 'supportsImages', 'supportsDocuments', 'availableForSubagents']);
const EVIDENCE = {
  plan: 'docs/GODOT_AGENT_CAPABILITY_DEVELOPMENT_PLAN.md',
  toolManifest: 'plugins/craftmine-world/manifest.json',
  toolImplementation: 'plugins/craftmine-world/world-tools.cjs',
  toolchain: 'desktop/godot/toolchain.lock.json',
};
const fail = code => { throw new Error(code); };
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9._:/-]{1,256}$/.test(value);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function parseOptions(args) {
  const result = {}, names = {'--player-db': 'playerDb', '--session-id': 'sessionId', '--out': 'out', '--core-bin': 'coreBin'};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i], name = names[flag];
    if (!name) fail('BASELINE_UNKNOWN_OPTION');
    if (result[name] !== undefined) fail('BASELINE_DUPLICATE_OPTION');
    const value = args[++i];
    if (!value || value.startsWith('--')) fail('BASELINE_OPTION_VALUE_REQUIRED');
    result[name] = value;
  }
  if (!result.playerDb || !result.out) fail('BASELINE_PLAYER_DB_AND_OUT_REQUIRED');
  for (const key of ['playerDb', 'out', 'coreBin']) if (result[key] && !path.isAbsolute(result[key])) fail('BASELINE_ABSOLUTE_PATH_REQUIRED');
  if (result.sessionId !== undefined && !identifier(result.sessionId)) fail('BASELINE_SESSION_ID_INVALID');
  return result;
}

/** Whitelist the product ModelBinding schema. Never serialize arbitrary config_json. */
export function snapshotFromRow(row, {sourceDatabase, explicit = false, sampledAt}) {
  if (!identifier(row.id) || !identifier(row.model_id) || !identifier(row.provider_id)) fail('BASELINE_SESSION_BINDING_MISSING');
  if (!Number.isSafeInteger(row.updated_at) || row.updated_at < 0 || !LEVELS.has(row.thinking_level)) fail('BASELINE_SESSION_CONFIGURATION_INVALID');
  if (!['agent', 'plan'].includes(row.mode) || !['inherit', 'ask', 'accept-edits', 'auto'].includes(row.permission_mode)) fail('BASELINE_SESSION_CONFIGURATION_INVALID');
  if (!identifier(row.vendor_key) || !identifier(row.protocol) || !identifier(row.api_style)) fail('BASELINE_PROVIDER_CONFIGURATION_MISSING');
  let endpoint;
  try { endpoint = new URL(row.base_url); } catch { fail('BASELINE_ENDPOINT_INVALID'); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) fail('BASELINE_ENDPOINT_NOT_PUBLIC_CONFIGURATION');
  let config;
  try { config = JSON.parse(row.config_json); } catch { fail('BASELINE_PROVIDER_CONFIGURATION_INVALID'); }
  if (!isObject(config) || !Array.isArray(config.models)) fail('BASELINE_MODELS_MISSING');
  const matches = config.models.filter(model => isObject(model) && model.id === row.model_id);
  if (matches.length !== 1) fail('BASELINE_SELECTED_MODEL_BINDING_MISSING_OR_AMBIGUOUS');
  const binding = matches[0];
  if (Object.keys(binding).some(key => !BINDING_KEYS.has(key))) fail('BASELINE_MODEL_BINDING_SCHEMA_MISMATCH');
  for (const key of ['contextWindow', 'maxTokens']) if (!Number.isSafeInteger(binding[key]) || binding[key] <= 0) fail('BASELINE_MODEL_BINDING_INVALID');
  if (!Array.isArray(binding.thinkingLevels) || !binding.thinkingLevels.every(value => LEVELS.has(value)) || !binding.thinkingLevels.includes(row.thinking_level) || new Set(binding.thinkingLevels).size !== binding.thinkingLevels.length) fail('BASELINE_THINKING_CONFIGURATION_INVALID');
  if (binding.defaultThinkingLevel !== null && !binding.thinkingLevels.includes(binding.defaultThinkingLevel)) fail('BASELINE_THINKING_CONFIGURATION_INVALID');
  for (const key of ['supportsImages', 'supportsDocuments']) if (key in binding && binding[key] !== null && typeof binding[key] !== 'boolean') fail('BASELINE_MODEL_BINDING_INVALID');
  if ('availableForSubagents' in binding && typeof binding.availableForSubagents !== 'boolean') fail('BASELINE_MODEL_BINDING_INVALID');
  if (row.default_model_id !== null && !identifier(row.default_model_id)) fail('BASELINE_PROVIDER_DEFAULT_INVALID');
  return {
    format: explicit ? 'craftmine.player-config-snapshot/1' : 'craftmine.player-config-candidate/1',
    credentialsIncluded: false,
    selectionBasis: explicit ? 'explicitly-selected-session' : 'latest-saved-session',
    selectedSessionUnverified: !explicit,
    // Explicit means the CLI caller chose this saved session; no foreground UI inspection.
    foregroundSelectionObserved: false,
    sampledAt, sourceDatabase,
    sourceSession: {id: row.id, updatedAtMs: row.updated_at, updatedAtUTC: new Date(row.updated_at).toISOString()},
    sourceBinding: 'providers.config_json.models entry matching sessions.provider_id + sessions.model_id',
    providerId: row.provider_id, vendorKey: row.vendor_key, baseUrl: row.base_url,
    protocol: row.protocol, apiStyle: row.api_style,
    providerDefaultModelId: row.default_model_id,
    selectedIsProviderDefault: row.model_id === row.default_model_id,
    modelId: row.model_id, thinkingLevel: row.thinking_level,
    contextWindow: binding.contextWindow, maxTokens: binding.maxTokens,
    thinkingLevels: [...binding.thinkingLevels], modelBinding: {...binding},
    mode: row.mode, permissionMode: row.permission_mode,
    effectivePermissionUnverified: row.permission_mode === 'inherit',
    ordinaryDriverCompatible: row.mode === 'agent' && row.vendor_key === 'deepseek' && row.base_url === 'https://api.deepseek.com' && row.protocol === 'openai_compatible' && row.api_style === 'chat_completions' && /^deepseek-[a-zA-Z0-9._-]+$/.test(row.model_id),
  };
}

export function readPlayerConfiguration(playerDb, sessionId, sampledAt = new Date().toISOString()) {
  if (!path.isAbsolute(playerDb) || !fs.statSync(playerDb).isFile()) fail('BASELINE_PLAYER_DB_INVALID');
  const db = new DatabaseSync(playerDb, {readOnly: true});
  try {
    // One SELECT gives a consistent SQLite statement snapshot. No titles, messages,
    // secret_ref, credentials or arbitrary kv values are selected.
    const query = `SELECT s.id,s.provider_id,s.model_id,s.thinking_level,s.mode,s.permission_mode,s.updated_at,
      p.vendor_key,p.protocol,p.api_style,p.base_url,p.default_model_id,p.config_json
      FROM sessions s LEFT JOIN providers p ON p.id=s.provider_id `;
    const rows = sessionId === undefined
      ? db.prepare(query + 'ORDER BY s.updated_at DESC,s.id ASC LIMIT 5').all()
      : db.prepare(query + 'WHERE s.id=?').all(sessionId);
    if (!rows.length) fail(sessionId === undefined ? 'BASELINE_NO_SAVED_SESSIONS' : 'BASELINE_SESSION_NOT_FOUND');
    const samples = rows.map(row => {
      try { return {status: 'available', configuration: snapshotFromRow(row, {sourceDatabase: playerDb, explicit: sessionId !== undefined, sampledAt})}; }
      catch (error) {
        if (sessionId !== undefined) throw error;
        return {status: 'unavailable', sessionId: identifier(row.id) ? row.id : null, reason: /^BASELINE_[A-Z_]+$/.test(error.message) ? error.message : 'BASELINE_CONFIGURATION_INVALID'};
      }
    });
    return {selectedSessionUnverified: sessionId === undefined, selectionBasis: sessionId === undefined ? 'latest-saved-session' : 'explicitly-selected-session', samples};
  } finally { db.close(); }
}

export function hashFile(file) {
  if (!fs.statSync(file).isFile()) fail('BASELINE_HASH_FILE_REQUIRED');
  const bytes = fs.readFileSync(file);
  return {path: file, bytes: bytes.length, sha256: sha256(bytes)};
}

export function gitIdentity(root) {
  const git = args => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  const status = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0');
  const dirtyFiles = [];
  for (let i = 0; i < status.length; i++) {
    if (!status[i]) continue;
    const state = status[i].slice(0, 2), item = {status: state, path: status[i].slice(3)};
    if (/[RC]/.test(state)) item.originalPath = status[++i];
    dirtyFiles.push(item);
  }
  return {root, commit: git(['rev-parse', 'HEAD']).trim(), branch: git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(), dirty: dirtyFiles.length > 0, dirtyFiles};
}

export function collectBaseline(options, root = ROOT) {
  const sampledAt = new Date().toISOString();
  const player = readPlayerConfiguration(options.playerDb, options.sessionId, sampledAt);
  return {
    format: 'craftmine.godot-agent-baseline/1', sampledAt,
    credentialsIncluded: false, modelRequests: 0, processesLaunched: ['git-metadata-only'],
    source: gitIdentity(root),
    artifacts: Object.fromEntries(Object.entries(EVIDENCE).map(([name, relative]) => [name, hashFile(path.join(root, relative))])),
    ...(options.coreBin ? {coreBinary: {...hashFile(options.coreBin), executed: false}} : {}),
    player,
    limits: ['Saved configuration is not proof of the foreground selection or endpoint availability.', 'No engine, installed-package, gameplay or real-model acceptance was performed.', 'Inherited effective permission and existing task budgets are not resolved by this snapshot.'],
  };
}

export function writeBaseline(report, out) {
  if (!path.isAbsolute(out)) fail('BASELINE_ABSOLUTE_PATH_REQUIRED');
  // mkdir is exclusive: never overwrite an older report or a player profile.
  fs.mkdirSync(out);
  const emit = (name, value) => {
    const file = path.join(out, name), bytes = JSON.stringify(value, null, 2) + '\n';
    fs.writeFileSync(file, bytes, {flag: 'wx'});
    return {file, sha256: sha256(bytes)};
  };
  const files = [emit('baseline.json', report)];
  if (!report.player.selectedSessionUnverified) files.push(emit('player-config-snapshot.json', report.player.samples[0].configuration));
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (fs.existsSync(options.out)) fail('BASELINE_OUTPUT_ALREADY_EXISTS');
    const report = collectBaseline(options);
    console.log(JSON.stringify({selectedSessionUnverified: report.player.selectedSessionUnverified, files: writeBaseline(report, options.out)}, null, 2));
  } catch (error) {
    // Raw SQLite/configuration exceptions can include values; expose only codes.
    console.error(/^BASELINE_[A-Z_]+$/.test(error.message) ? error.message : 'BASELINE_COLLECTION_FAILED');
    process.exitCode = 1;
  }
}
