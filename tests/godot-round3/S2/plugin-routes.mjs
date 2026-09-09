// S2 router tests: the private host routes actually forward to the services and
// to the core, and the host-side whitelist stays in step with the router.
//
// The router depends on the built `domain.cjs`, so these tests load the packaged
// plugin bundle produced by `node desktop/build-world-plugin.mjs` - the artifact
// that actually ships. Without that build they skip with an explicit reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const worktree = path.resolve(here, '..', '..', '..');
const routerSource = fs.readFileSync(path.join(worktree, 'plugins', 'craftmine-world', 'host-requests.cjs'), 'utf8');
const runtimeSource = fs.readFileSync(path.join(worktree, 'vendor', 'pi-desktop', 'apps', 'desktop', 'electron', 'main', 'plugin-runtime.ts'), 'utf8');

const bundle = path.join(worktree, 'desktop', 'build', 'craftmine.world');
let builtRouter = null, bundleError = null;
try { builtRouter = require(path.join(bundle, 'host-requests.cjs')); }
catch (error) { bundleError = 'plugin bundle not built (run `node desktop/build-world-plugin.mjs`): ' + error.message; }
const skip = bundleError ? {skip:bundleError} : {};

function router({assetService, reuseService} = {}) {
  const calls = [];
  const core = {
    async start() { return {ok:true}; },
    async call(method, params) { calls.push({method, params}); return {ok:true, method}; },
  };
  const handle = builtRouter.createHostRequests(core, {
    verifications:{cancelTurn(){}, cancelOtherTurns(){}},
    reviews:{cancelTurn(){}, cancelOtherTurns(){}},
    getSettings:async () => ({activeWorldId:'world-s2'}),
    workbench:null,
    godotExecutor:{status:() => ({format:'craftmine.godot-executor-status/1', state:'registered', available:true})},
    assetService,
    reuseService,
  });
  return {handle, calls};
}

test('godotWorld, project, job, history, asset and storage routes forward only listed fields', skip, async () => {
  const {handle, calls} = router();
  const forwarded = [
    ['godotWorld.initialize', {worldId:'w', title:'t', baseId:'first-person', baseBuild:'b', snapshot:{format:'craftmine.godot-progress/1'}}],
    ['godotWorld.initStatus', {worldId:'w'}],
    ['godotProject.create', {context:{}, worldId:'w', toolCallId:'t', baseBuild:'b', baseId:'first-person', files:[{path:'main.gd', text:'extends Node'}]}],
    ['godotProject.index', {context:{}, worldId:'w', offset:0, limit:32}],
    ['godotProject.read', {context:{}, worldId:'w', revision:1, manifestHash:'h', path:'main.gd'}],
    ['godotProject.patch', {context:{}, worldId:'w', toolCallId:'t', revision:1, manifestHash:'h', operations:[]}],
    ['godotBuild.start', {context:{}, worldId:'w', toolCallId:'t', revision:1, manifestHash:'h', mode:'check'}],
    ['godotBuild.read', {worldId:'w', jobId:'gjob-1'}],
    ['godotBuild.cancel', {worldId:'w', jobId:'gjob-1'}],
    ['godotJob.continue', {jobId:'gjob-1', token:'tok'}],
    ['godotJob.usage', {worldId:'w'}],
    ['godotStorage.status', {worldId:'w'}],
    ['godotStorage.reclaimPlan', {worldId:'w'}],
    ['godotStorage.reclaimCommit', {worldId:'w', planId:'p', planHash:'h'}],
    ['godotAsset.put', {context:{}, worldId:'w', toolCallId:'t', name:'a.png', mediaType:'image/png', sha256:'a'.repeat(64), bytesBase64:''}],
    ['godotAsset.list', {context:{}, worldId:'w'}],
    ['content.history', {worldId:'w', limit:32}],
    ['content.version.list', {worldId:'w'}],
    ['content.checkpoint.set', {worldId:'w', taskId:'t', sequence:1, rev:'r'}],
    ['content.apply.prepare', {worldId:'w', context:{}, kind:'apply', targetOid:'o', detail:'d'}],
    ['content.apply.recover', {worldId:'w'}],
    ['content.verify', {worldId:'w'}],
    ['content.bundle', {worldId:'w', target:'t'}],
    ['library.search', {query:'q'}],
    ['library.read', {ref:'r'}],
    ['world.list', {}],
    ['world.saveProgress', {id:'w', revision:1, baseBuild:'b', snapshot:{}}],
  ];
  for (const [method, params] of forwarded) {
    const result = await handle(method, params);
    assert.equal(result.method, method);
  }
  assert.deepEqual(calls.map(call => call.method), forwarded.map(([method]) => method));
  // The router must not widen a call: an unlisted field is refused before it
  // reaches the core.
  await assert.rejects(() => handle('godotWorld.initStatus', {worldId:'w', extra:true}), /HarnessError|UNKNOWN|INVALID|UNSUPPORTED/);
  await assert.rejects(() => handle('godotWorld.initStatus', {}), /HarnessError|MISSING|REQUIRED|INVALID|UNSUPPORTED/);
  await assert.rejects(() => handle('godotProject.build', {}), /UNSUPPORTED_HOST_OPERATION/);
});

test('asset and package routes reach the constructed services and refuse unlisted methods', skip, async () => {
  const seen = [];
  const assetService = {search:async args => { seen.push(['asset.search', args]); return {items:[]}; }};
  const reuseService = {check:async args => { seen.push(['package.check', args]); return {compatible:true}; }};
  const {handle, calls} = router({assetService, reuseService});
  assert.deepEqual(await handle('asset.request', {method:'search', args:{query:'rock'}}), {items:[]});
  assert.deepEqual(await handle('package.request', {method:'check', args:{ref:'r', target:{base:'b', baseVersion:'1', engine:'e', stateFormat:'s'}}}), {compatible:true});
  assert.deepEqual(seen, [['asset.search', {query:'rock'}], ['package.check', {ref:'r', target:{base:'b', baseVersion:'1', engine:'e', stateFormat:'s'}}]]);
  assert.deepEqual(calls, [], 'the services own their own core calls');
  await assert.rejects(() => handle('asset.request', {method:'dropEverything'}), /UNSUPPORTED_ASSET_OPERATION/);
  await assert.rejects(() => handle('package.request', {method:'dropEverything'}), /UNSUPPORTED_PACKAGE_OPERATION/);
  await assert.rejects(() => handle('asset.request', {method:'search', args:{}, extra:true}), /HarnessError|UNKNOWN|INVALID|UNSUPPORTED/);
});

test('a missing service reports its own reason instead of pretending to work', skip, async () => {
  const {handle} = router();
  await assert.rejects(() => handle('asset.request', {method:'search'}), /ASSET_SERVICE_UNAVAILABLE/);
  await assert.rejects(() => handle('package.request', {method:'check'}), /PACKAGE_SERVICE_UNAVAILABLE/);
});

test('the packaged plugin ships the services main.cjs constructs', skip, () => {
  for (const file of ['main.cjs', 'host-requests.cjs', 'godot-executor.cjs', 'asset-service.mjs', 'reuse-service.mjs', 'domain.cjs']) {
    assert.equal(fs.existsSync(path.join(bundle, file)), true, 'packaged plugin is missing ' + file);
  }
  const main = require(path.join(bundle, 'main.cjs'));
  for (const name of ['onLoad', 'onUnload', 'onPanelInvoke', 'onHostRequest', 'onHostTurnEnd']) {
    assert.equal(typeof main[name], 'function', 'packaged main.cjs does not export ' + name);
  }
  const {createAssetService} = require(path.join(bundle, 'asset-service.mjs'));
  const {createReuseService} = require(path.join(bundle, 'reuse-service.mjs'));
  assert.equal(typeof createAssetService, 'function');
  assert.equal(typeof createReuseService, 'function');
});

test('every router method is reachable through the host whitelist', () => {
  const routerMethods = new Set();
  for (const match of routerSource.matchAll(/'([a-zA-Z]+(?:\.[a-zA-Z]+)+)'\s*:\s*\[/g)) routerMethods.add(match[1]);
  const whitelist = new Set();
  const start = runtimeSource.indexOf('const allowed = new Set([');
  const end = runtimeSource.indexOf('if (!allowed.has(method))', start);
  const region = runtimeSource.slice(start, end);
  for (const match of region.matchAll(/"([a-zA-Z]+(?:\.[a-zA-Z]+)+)"/g)) whitelist.add(match[1]);
  const missing = [...routerMethods].filter(method => !whitelist.has(method)).sort();
  assert.deepEqual(missing, [], 'router methods absent from the host whitelist: ' + missing.join(', '));
});

