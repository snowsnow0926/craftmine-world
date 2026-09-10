// P8 pre-flight: bind a frozen release record to its own package identity before
// any client acceptance entry runs. Read-only: this file never spawns a client,
// never sends input, and never touches a player profile.
//
// Usage (packaged candidate):
//   node tests/godot-final/package-preflight.mjs \
//     --source-root <harness worktree> --deps-app <desktop app dir with node_modules> \
//     --release-root <release dir containing run.json> [--output-parent <absolute dir>]
//
// The release record (run.json) is the only identity source: its commit and
// buildManifestSha256 are re-verified against the actual package bytes. No
// hand-typed hash is trusted.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inspectParameterPackage} from '../plan-loop/parameter-client-package.mjs';
import {loadPackageAsar} from '../../desktop/package-asar.mjs';

function fail(code, detail) {
  const error = Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  throw error;
}

function parseArguments(args) {
  const allowed = new Set(['--source-root', '--deps-app', '--release-root', '--output-parent']);
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!allowed.has(key) || Object.hasOwn(result, key) || !value || value.startsWith('--')) fail('INVALID_PREFLIGHT_ARGUMENT', key);
    result[key] = value;
  }
  for (const key of ['--source-root', '--deps-app', '--release-root']) if (!result[key]) fail('MISSING_PREFLIGHT_ARGUMENT', key);
  for (const key of Object.keys(result)) if (!path.isAbsolute(result[key])) fail('ABSOLUTE_PREFLIGHT_PATH_REQUIRED', key);
  return {
    root: path.resolve(result['--source-root']),
    deps: path.resolve(result['--deps-app']),
    releaseRoot: path.resolve(result['--release-root']),
    outputParent: result['--output-parent'] ? path.resolve(result['--output-parent']) : path.join(path.resolve(result['--source-root']), 'test-results'),
  };
}

// Every package member is opened through a directory chain that must not contain
// a symlink or a reparse point, so a linked release cannot masquerade as frozen.
function regularDirectory(directory, {create = false} = {}) {
  if (!path.isAbsolute(directory)) fail('ABSOLUTE_PREFLIGHT_PATH_REQUIRED', directory);
  const root = path.parse(directory).root;
  let cursor = root;
  for (const part of directory.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch {
      if (!create) fail('PREFLIGHT_PATH_MISSING', cursor);
      fs.mkdirSync(cursor);
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('PREFLIGHT_LINK_OR_FILE_DENIED', cursor);
  }
}

function git(root, ...args) {
  return execFileSync('git', args, {cwd: root, encoding: 'utf8', windowsHide: true}).trim();
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const checks = [];
  const record = (name, passed, detail) => { checks.push({name, passed, ...(detail === undefined ? {} : {detail})}); if (!passed) fail('PREFLIGHT_CHECK_FAILED', name); };

  regularDirectory(options.root);
  regularDirectory(options.deps);
  regularDirectory(options.releaseRoot);

  // 1. The frozen release record identifies itself.
  const runFile = path.join(options.releaseRoot, 'run.json');
  if (!fs.existsSync(runFile)) fail('PREFLIGHT_RELEASE_RECORD_MISSING', runFile);
  const run = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  record('run record format', run.format === 'craftmine.release-run/1', run.format);
  record('run record commit shape', /^[a-f0-9]{40}$/.test(run.commit ?? ''), run.commit);
  record('run record manifest hash shape', /^[a-f0-9]{64}$/.test(run.buildManifestSha256 ?? ''), run.buildManifestSha256);

  const packaged = path.join(options.releaseRoot, 'output', 'win-unpacked');
  regularDirectory(packaged);

  // 2. The harness tree must be exactly the frozen source commit and clean, which
  // is also what client-complete.mjs asserts through CRAFTMINE_EXPECTED_COMMIT.
  record('harness HEAD equals release commit', git(options.root, 'rev-parse', 'HEAD') === run.commit, git(options.root, 'rev-parse', 'HEAD'));
  record('harness worktree is clean', git(options.root, 'status', '--porcelain') === '', undefined);
  record('deps app supplies node_modules', fs.existsSync(path.join(options.deps, 'package.json')), undefined);

  // 3. Full package identity: build manifest, client files, plugin inventory,
  // native binaries, bundled runtime and the isolation guards inside app.asar.
  const identity = await inspectParameterPackage({
    packaged,
    expectedCommit: run.commit,
    expectedManifestHash: run.buildManifestSha256,
    asar: loadPackageAsar(options.deps),
  });
  record('package identity gate', true, identity.identity.appVersion);

  // 4. The packaged paths the acceptance entries will actually execute.
  for (const [name, file] of [['executable', identity.executable], ['core', identity.core], ['host', identity.host]]) {
    record(`packaged ${name} is a regular file`, fs.statSync(file).isFile(), file);
  }
  record('packaged godot bases directory', fs.statSync(identity.bases).isDirectory(), identity.bases);
  record('core/host/bases are inside the audited release', [identity.core, identity.host, identity.bases].every(value => value.startsWith(packaged)), undefined);

  // 5. Evidence sink for this run: independent absolute directory, never the
  // release itself and never a symlinked parent.
  regularDirectory(options.outputParent, {create: true});
  if (packaged.startsWith(options.outputParent)) fail('PREFLIGHT_OUTPUT_INSIDE_RELEASE', options.outputParent);
  const out = fs.mkdtempSync(path.join(options.outputParent, 'p8-preflight-'));
  const report = {
    format: 'craftmine.p8-package-preflight/1',
    startedAt: new Date().toISOString(),
    sourceRoot: options.root,
    depsApp: options.deps,
    releaseRoot: options.releaseRoot,
    packagedRoot: packaged,
    releaseRecordSha256: createHash('sha256').update(fs.readFileSync(runFile)).digest('hex'),
    identity: identity.identity,
    packagedPaths: {executable: identity.executable, core: identity.core, host: identity.host, bases: identity.bases},
    checks,
    // The exact environment contract for tests/godot-final/client-complete.mjs.
    clientCompleteEnvironment: {
      CRAFTMINE_PACKAGED_ROOT: packaged,
      CRAFTMINE_EXPECTED_COMMIT: run.commit,
      CRAFTMINE_TEST_OUTPUT_ROOT: options.outputParent,
      CRAFTMINE_TEST_PERFORMANCE: '1',
      CRAFTMINE_TEST_REUSE: '1',
      CRAFTMINE_TEST_COPY: '1',
      CRAFTMINE_TEST_BACKUP: '1',
    },
    // The exact argument contract for the plan-loop and P1 packaged entries.
    nativeEntryArguments: ['--source-root', options.root, '--deps-app', options.deps, '--packaged-root', packaged, '--expected-commit', run.commit, '--expected-build-manifest-sha256', run.buildManifestSha256],
    passed: checks.every(check => check.passed),
    finishedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(out, 'package-identity.json'), JSON.stringify(report, null, 2));
  for (const check of checks) console.log(`PASS ${check.name}${check.detail ? ' :: ' + check.detail : ''}`);
  console.log('IDENTITY ' + JSON.stringify({commit: run.commit, version: identity.identity.appVersion, buildManifestSha256: run.buildManifestSha256, executableSha256: identity.identity.executableSha256, coreSha256: identity.identity.coreSha256, hostSha256: identity.identity.hostSha256, pluginSha256: identity.identity.pluginSha256, runtimeFilesDigest: identity.identity.runtimeFilesDigest}));
  console.log('Evidence: ' + out);
  return {out, report};
}

main().then(() => {
  process.exitCode = 0;
}).catch(error => {
  console.error('PREFLIGHT FAILED ' + (error.code ? `${error.code} ${error.message}` : String(error?.stack ?? error)));
  process.exitCode = 1;
});
