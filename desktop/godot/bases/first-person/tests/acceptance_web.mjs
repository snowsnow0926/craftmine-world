// First-person base: real Web-export pixel acceptance harness.
//
// It exports the authored base with the pinned engine, serves the export and a
// plain-HTML host from two separate 127.0.0.1 origins, and drives the game only
// through HTTP, page script evaluation and canvas screenshots. There is no
// mouse/keyboard simulation, no pointer lock, no window activation and no
// focus: the init script makes requestPointerLock throw and records every
// focus()/pointer-lock attempt so the run can assert that zero happened.
//
// Every check is recorded and printed (PASS/FAIL) before the process exits
// non-zero, so one unsatisfiable assertion still leaves the rest of the
// evidence in <temp>/report.json.
//
// Run:  node desktop/godot/bases/first-person/tests/acceptance_web.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {playwright, browserOptions} from '../../../../../app/browser-tools.mjs';
import {exportWebBase, rootDirectory} from './export_web.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let PNG;
try { ({PNG} = require('pngjs')); } catch { ({PNG} = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs'))); }

fs.mkdirSync(path.join(rootDirectory, 'test-results'), {recursive: true});
const out = fs.mkdtempSync(path.join(rootDirectory, 'test-results/first-person-web-'));
const profileDirectory = path.join(out, 'browser-profile');
const threads = true;

const report = {
  kind: 'first-person-base-web-export-pixels',
  threads,
  checks: [],
  builds: [],
  runs: [],
  loads: [],
  inputRequests: [],
  hostErrors: [],
  console: [],
  errors: [],
  notVerified: [
    'model-authored creation from the blank start (see docs/MODEL_ACCEPTANCE_TASKS.md)',
    'player feel, mouse look and hardware GPU performance',
    'product PI/Rust project transactions and application receipts',
    'OS-level isolation of untrusted projects',
    'audio output and WebAudio device behaviour',
  ],
};

const failures = [];
const check = (name, value, evidence) => {
  const passed = !!value;
  report.checks.push({name, passed, ...(evidence === undefined ? {} : {evidence})});
  console.log((passed ? 'PASS ' : 'FAIL ') + name);
  if (!passed) failures.push(name);
  return passed;
};

const servers = [];
let environment, build, context, page, frame;

// Same COOP/COEP/CSP header set as tests/godot-web.mjs with threads enabled.
// The host branch additionally allows an inline script (this host page is plain
// HTML by contract) and frames from the separate game origin.
async function server(directory, {game = false} = {}) {
  const mime = {'.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.woff2': 'font/woff2'};
  const instance = http.createServer((request, response) => {
    try {
      const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1) || 'index.html';
      if (relative.includes('\\') || relative.split('/').some(part => part === '..' || part === '.' || part.includes(':'))) throw Error('Invalid path');
      const file = path.resolve(directory, relative);
      if (!file.startsWith(directory + path.sep) || !fs.statSync(file).isFile()) throw Error('Absent');
      response.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (threads) {
        response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      }
      response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self' 'unsafe-inline'${game ? " 'wasm-unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src ${threads ? "'self' blob:" : "'none'"}; frame-src ${game ? "'none'" : 'http://127.0.0.1:*'}; object-src 'none'; base-uri 'none'; form-action 'none'`);
      fs.createReadStream(file).pipe(response);
    } catch {
      response.statusCode = 404;
      response.end('Not found');
    }
  });
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  servers.push(instance);
  return 'http://127.0.0.1:' + instance.address().port;
}

async function launch(hostOrigin, gameOrigin, worldId, viewport) {
  context = await playwright().chromium.launchPersistentContext(profileDirectory, {
    ...browserOptions(),
    viewport,
    reducedMotion: 'reduce',
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  await context.exposeFunction('__recordInputRequest', value => report.inputRequests.push(value));
  await context.addInitScript(() => {
    globalThis.__inputRequests = 0;
    const record = kind => { globalThis.__inputRequests++; void __recordInputRequest({kind, url: location.href}); };
    Element.prototype.requestPointerLock = () => { record('pointer-lock'); throw Error('Pointer lock disabled'); };
    HTMLElement.prototype.focus = () => record('element-focus');
    window.focus = () => record('window-focus');
  });
  page = await context.newPage();
  page.setDefaultTimeout(120000);
  page.on('pageerror', error => report.errors.push(String(error.stack)));
  page.on('console', message => report.console.push({type: message.type(), text: message.text().slice(0, 2000)}));
  const hostUrl = hostOrigin + '/index.html?game=' + encodeURIComponent(gameOrigin + '/index.html') + '&worldId=' + worldId + '&buildId=' + build.buildId;
  const started = performance.now();
  await page.goto(hostUrl);
  await page.evaluate(() => window.base.ready);
  report.loads.push({worldId, buildId: build.buildId, elapsedMs: Math.round(performance.now() - started)});
  frame = page.frames().find(candidate => candidate.url().startsWith(gameOrigin + '/'));
  if (!frame) throw Error('The game must run in its own frame');
  return frame;
}

const request = (op, args = {}) => page.evaluate(({op, args}) => window.base.request(op, args), {op, args});

async function capture(name) {
  // Wait for two drawn frames, then screenshot the real compositor output.
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const buffer = await frame.locator('canvas').screenshot({path: path.join(out, name + '.png')});
  return PNG.sync.read(buffer);
}

// Near-white reticle pixels inside a window centred on the canvas bitmap centre.
//
// This measures *centring*, not a particular reticle design. The authored
// precision style is a gapped cross, so it draws nothing in the innermost pixels
// and a fixed 9x9 count would measure the style rather than the position. The
// count proves the reticle is really drawn; the centroid and bounding box prove
// it is drawn around the bitmap centre at every resolution.
function reticleEvidence(png, radius = 10) {
  const cx = Math.floor(png.width / 2), cy = Math.floor(png.height / 2);
  const pixels = [];
  let count = 0, sumX = 0, sumY = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
    const offset = (y * png.width + x) * 4;
    if (png.data[offset] > 235 && png.data[offset + 1] > 235 && png.data[offset + 2] > 235) {
      count++;
      sumX += x; sumY += y;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      pixels.push([x - cx, y - cy]);
    }
  }
  return {
    radius,
    window: [cx - radius, cy - radius, radius * 2 + 1, radius * 2 + 1],
    count,
    pixels,
    centroidOffset: count ? [sumX / count - cx, sumY / count - cy] : null,
    bboxOffset: count ? [(minX + maxX) / 2 - cx, (minY + maxY) / 2 - cy] : null,
    bbox: count ? [minX - cx, minY - cy, maxX - minX + 1, maxY - minY + 1] : null,
  };
}

const isWhite = (png, x, y) => {
  const offset = (y * png.width + x) * 4;
  return png.data[offset] > 235 && png.data[offset + 1] > 235 && png.data[offset + 2] > 235;
};

// Diagnostic only: the best possible 9x9 window near the bitmap centre (HUD text
// elsewhere on the canvas is excluded), so the report shows whether a centred
// box could ever reach the required count.
function bestWindow(png, size, radius = 24) {
  const width = png.width, height = png.height;
  const cx = Math.floor(width / 2), cy = Math.floor(height / 2);
  let best = 0, at = null;
  for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
    if (x < 0 || y < 0 || x + size > width || y + size > height) continue;
    let sum = 0;
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) if (isWhite(png, x + dx, y + dy)) sum++;
    if (sum > best) { best = sum; at = [x, y]; }
  }
  return {count: best, at, offsetFromBitmapCentre: at ? [at[0] - cx, at[1] - cy] : null};
}

// Samples the midpoint of every reported reticle segment in the real bitmap.
function segmentPixels(png, segments) {
  return segments.map(segment => {
    const x = Math.round((segment.from[0] + segment.to[0]) / 2);
    const y = Math.round((segment.from[1] + segment.to[1]) / 2);
    return {from: segment.from, to: segment.to, sample: [x, y], white: isWhite(png, x, y)};
  });
}

async function settleViewport(width, height) {
  await page.setViewportSize({width, height});
  await frame.waitForFunction(size => {
    const canvas = document.querySelector('canvas');
    return canvas.width === size[0] && canvas.height === size[1];
  }, [width, height], {timeout: 60000});
  let snapshot;
  for (let attempt = 0; attempt < 120; attempt++) {
    snapshot = await request('snapshot');
    if (snapshot.viewportSize[0] === width && snapshot.viewportSize[1] === height) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return snapshot;
}

const health = snapshot => (snapshot.targets || []).find(target => target.id === 'target_b') || {};

try {
  build = await exportWebBase(out, {threads});
  environment = build.environment;
  report.builds.push({buildId: build.buildId, bytes: build.bytes, godotVersion: build.godotVersion, threaded: build.threaded, template: build.template, files: build.files.map(file => ({path: file.path, bytes: file.bytes}))});
  check('Pinned engine exports a real threaded Web build of the base',
    build.threaded === true &&
    build.files.some(file => file.path === 'index.wasm' && file.bytes > 1000000) &&
    build.files.some(file => file.path === 'index.pck' && file.bytes > 1000) &&
    build.files.some(file => file.path === 'bridge.js') &&
    build.files.some(file => file.path === 'licenses/GODOT_LICENSE.txt'),
    {buildId: build.buildId, bytes: build.bytes, threaded: build.threaded, template: build.template, files: build.files.map(file => file.path)});

  const hostOrigin = await server(path.join(here, 'web_host'));
  const gameOrigin = await server(build.output, {game: true});
  report.origins = {host: hostOrigin, game: gameOrigin};

  frame = await launch(hostOrigin, gameOrigin, 'weapon-world', {width: 1280, height: 720});

  const canvasInfo = await frame.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return {bitmap: [canvas.width, canvas.height], css: [canvas.clientWidth, canvas.clientHeight], dpr: devicePixelRatio};
  });
  check('The Godot canvas is non-zero in the exported page',
    canvasInfo.bitmap[0] > 0 && canvasInfo.bitmap[1] > 0,
    canvasInfo);

  check('crossOriginIsolated matches the threaded Web template in both origins',
    await frame.evaluate(() => crossOriginIsolated) === threads && await page.evaluate(() => crossOriginIsolated) === threads,
    {threads, host: await page.evaluate(() => crossOriginIsolated), game: await frame.evaluate(() => crossOriginIsolated)});

  for (const [width, height] of [[1280, 720], [800, 600], [1920, 1080]]) {
    const snapshot = await settleViewport(width, height);
    const png = await capture(`crosshair-${width}x${height}`);
    const reticle = reticleEvidence(png);
    report[`canvas${width}x${height}`] = {bitmap: [png.width, png.height], reticle, viewportSize: snapshot.viewportSize, crosshair: snapshot.crosshair};
    check(`Rendered reticle draws at least 24 near-white pixels inside the centred 21x21 window at ${width}x${height}`,
      png.width === width && png.height === height && reticle.count >= 24,
      {bitmap: [png.width, png.height], window: reticle.window, count: reticle.count, pixels: reticle.pixels, crosshairSize: snapshot.crosshair.size, crosshairSegments: snapshot.crosshair.segments.length});
    check(`Rendered reticle is centred on the bitmap centre within 1.5 px at ${width}x${height}`,
      reticle.centroidOffset !== null && Math.abs(reticle.centroidOffset[0]) <= 1.5 && Math.abs(reticle.centroidOffset[1]) <= 1.5 && Math.abs(reticle.bboxOffset[0]) <= 1.5 && Math.abs(reticle.bboxOffset[1]) <= 1.5,
      {centroidOffset: reticle.centroidOffset, bboxOffset: reticle.bboxOffset, bbox: reticle.bbox});
    check(`Reported crosshair offset from the viewport centre is within 0.5 px at ${width}x${height}`,
      Math.abs(snapshot.crosshair.offsetFromViewportCenter[0]) < 0.5 && Math.abs(snapshot.crosshair.offsetFromViewportCenter[1]) < 0.5,
      {offsetFromViewportCenter: snapshot.crosshair.offsetFromViewportCenter, viewportSize: snapshot.viewportSize, crosshairSize: snapshot.crosshair.size});
  }

  const sword = await request('equip', {value: 'practice_sword'});
  const swordReticle = reticleEvidence(await capture('sword'));
  check('Equipping the sword hides the real reticle and shows the sword model',
    swordReticle.count === 0 && sword.display.meshPath.endsWith('weapon_sword.obj') && sword.display.visible === true && sword.crosshair.visible === false,
    {whitePixels: swordReticle.count, whiteOffsets: swordReticle.pixels, meshPath: sword.display.meshPath, displayVisible: sword.display.visible, crosshairVisible: sword.crosshair.visible, equipment: sword.equipment.active});

  const pistol = await request('equip', {value: 'pistol'});
  const pistolPng = await capture('pistol');
  const pistolReticle = reticleEvidence(pistolPng);
  check('Re-equipping the pistol restores the rendered reticle and the pistol model',
    pistolReticle.count >= 24 && pistol.display.meshPath.endsWith('weapon_pistol.obj') && pistol.crosshair.visible === true,
    {whitePixels: pistolReticle.count, whiteOffsets: pistolReticle.pixels, centroidOffset: pistolReticle.centroidOffset, meshPath: pistol.display.meshPath, crosshairVisible: pistol.crosshair.visible, equipment: pistol.equipment.active});

  // Not a relaxation of the pixel-count assertion: this proves the reported
  // reticle geometry is really rendered, so the count above is a geometry
  // threshold rather than a missing or misplaced reticle.
  const pistolSegments = segmentPixels(pistolPng, pistol.crosshair.segments);
  check('Every reported reticle segment is really drawn as near-white pixels around the bitmap centre',
    pistolSegments.length === 4 && pistolSegments.every(entry => entry.white),
    {segments: pistolSegments, crosshairCenter: pistol.crosshair.globalCenter, offsetFromViewportCenter: pistol.crosshair.offsetFromViewportCenter});

  const beforeLook = (await request('snapshot')).display;
  const afterLook = (await request('look', {yaw: 0.7})).display;
  check('Camera rotation moves the held model in world space while it stays attached and aligned',
    JSON.stringify(afterLook.global) !== JSON.stringify(beforeLook.global) && afterLook.attachedToCamera === true && afterLook.alignedWithCamera === true,
    {before: beforeLook.global, after: afterLook.global, attachedToCamera: afterLook.attachedToCamera, alignedWithCamera: afterLook.alignedWithCamera, forwardDot: afterLook.forwardDot});

  await request('look', {yaw: 0, pitch: 0});
  const attack = await request('attack');
  const targetB = health(attack.snapshot);
  check('A real aim ray hits the centre target, deals the authored damage and consumes one round',
    attack.fired === true && attack.damage === 12 && attack.snapshot.equipment.magazine === 5 && targetB.health === 38,
    {fired: attack.fired, damage: attack.damage, magazine: attack.snapshot.equipment.magazine, reserve: attack.snapshot.equipment.reserve, targetB, hits: attack.hits});

  const saved = await request('save');
  check('Saving writes real Web progress through the game filesystem',
    saved.written === true && saved.snapshot.hasSave === true,
    {written: saved.written, path: saved.path, hasSave: saved.snapshot.hasSave});
  const beforeRestart = saved.snapshot;
  // Godot's Web filesystem queues an IDBFS persist on write; give it a tick to
  // reach IndexedDB before the browser is torn down.
  await new Promise(resolve => setTimeout(resolve, 1000));

  report.hostErrors.push(...await page.evaluate(() => window.base.errors));
  await context.close();
  context = undefined;
  page = undefined;
  frame = undefined;

  frame = await launch(hostOrigin, gameOrigin, 'weapon-world', {width: 1280, height: 720});
  const restored = await request('restore');
  const restoredB = health(restored);
  const restart = {hasSave: restored.hasSave, equipment: restored.equipment, targetB: restoredB};
  report.restart = {before: {equipment: beforeRestart.equipment, targetB: health(beforeRestart)}, after: restart};
  check('A full browser restart on the persistent profile restores equipment, ammunition and target damage',
    restored.hasSave === true &&
    restored.equipment.active === beforeRestart.equipment.active &&
    restored.equipment.magazine === beforeRestart.equipment.magazine &&
    restored.equipment.reserve === beforeRestart.equipment.reserve &&
    restoredB.health === health(beforeRestart).health,
    restart);

  report.hostErrors.push(...await page.evaluate(() => window.base.errors));
  check('The exported game and its host reported no runtime errors',
    report.errors.length === 0 && report.hostErrors.length === 0,
    {pageErrors: report.errors, hostErrors: report.hostErrors});

  check('No focus and no pointer lock were requested anywhere in the run',
    report.inputRequests.length === 0,
    report.inputRequests);

  if (failures.length) throw Error('Failed checks: ' + failures.join(' | '));
} catch (error) {
  report.errors.push(String(error.stack));
  process.exitCode = 1;
  console.error(error.message);
} finally {
  if (page) { try { report.hostErrors.push(...await page.evaluate(() => window.base.errors)); } catch {} }
  if (page) await page.screenshot({path: path.join(out, 'last-frame.png')}).catch(() => {});
  if (context) await context.close().catch(() => {});
  for (const instance of servers) await new Promise(resolve => instance.close(resolve));
  if (environment) report.runs = environment.runs;
  report.failures = failures;
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Evidence: ' + out);
}
