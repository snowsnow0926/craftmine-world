#!/usr/bin/env node
// Captures real rendered frames of a top-down world.
//
// The world is exported with the pinned Godot build to Web, served from a
// throwaway local HTTP server, and photographed in a separate headless browser
// profile. No real mouse or keyboard input is sent, no window is focused or
// raised, and Pointer Lock is never requested. The screenshot is only evidence
// that the build renders; gameplay correctness is proven by tools/verify.mjs.
//
// Usage:
//   node tools/capture-web.mjs [--out <dir>] [--godot <exe>] [--templates <web_release.zip>]

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_DIR = resolve(HERE, '..');

const DEFAULT_GODOT = 'D:/Craftmine World/desktop/build/godot/4.7.2-stable/editor/Godot_v4.7.2-stable_win64_console.exe';
const DEFAULT_TEMPLATE = 'D:/Craftmine World/desktop/build/godot/4.7.2-stable/templates/web_release.zip';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.pck': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--godot') args.godot = argv[++i];
    else if (argv[i] === '--templates') args.templates = argv[++i];
    else if (argv[i] === '--scene') args.scene = argv[++i];
    else if (argv[i] === '--shot') args.shot = argv[++i];
  }
  return args;
}

function playwright() {
  try {
    return require('playwright');
  } catch {
    const candidate = process.env.PLAYWRIGHT_MODULE_PATH
      || join(process.env.USERPROFILE || process.env.HOME || '', '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright');
    return require(candidate);
  }
}

function run(command, args, timeoutMs = 300000) {
  return spawnSync(command, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
}

// Minimal PNG decoder (filter reconstruction only); enough to inspect a screenshot.
function decodePng(buffer) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[offset];
    offset += 1;
    const line = raw.subarray(offset, offset + stride);
    offset += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value = (value + a) & 0xff;
      else if (filter === 2) value = (value + b) & 0xff;
      else if (filter === 3) value = (value + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value = (value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[x] = value;
    }
  }
  return { width, height, channels, data: out };
}

function analyse(image, expectedColors) {
  const counts = new Map();
  let colorful = 0;
  for (let i = 0; i < image.data.length; i += image.channels) {
    const key = (image.data[i] << 16) | (image.data[i + 1] << 8) | image.data[i + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
    if (image.data[i] !== image.data[i + 1] || image.data[i + 1] !== image.data[i + 2]) colorful += 1;
  }
  const matched = {};
  for (const [name, hex] of Object.entries(expectedColors)) {
    const target = [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    let total = 0;
    for (const [key, count] of counts) {
      const r = (key >> 16) & 0xff;
      const g = (key >> 8) & 0xff;
      const b = key & 0xff;
      if (Math.abs(r - target[0]) <= 6 && Math.abs(g - target[1]) <= 6 && Math.abs(b - target[2]) <= 6) total += count;
    }
    matched[name] = total;
  }
  return { uniqueColors: counts.size, colorfulPixels: colorful, totalPixels: image.width * image.height, matched };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const godot = args.godot || process.env.CRAFTMINE_GODOT_BIN || DEFAULT_GODOT;
  const template = args.templates || DEFAULT_TEMPLATE;
  if (!existsSync(godot)) throw new Error(`Godot build not found: ${godot}`);
  if (!existsSync(template)) throw new Error(`Web template not found: ${template}`);

  const out = resolve(args.out || join(process.env.PI_SCRATCH_DIR || process.env.TEMP || '.', 'topdown-capture'));
  const worldDir = join(out, 'world');
  const webDir = join(out, 'web');
  mkdirSync(webDir, { recursive: true });

  const created = run('node', [
    join(BASE_DIR, 'tools', 'new-world.mjs'),
    '--template', 'town',
    '--world-id', 'capture-town',
    '--name', 'capture-town',
    '--out', worldDir,
    '--force',
  ]);
  if (created.status !== 0) throw new Error(`new-world failed: ${created.stderr || created.stdout}`);

  if (args.scene) {
    const projectFile = join(worldDir, 'project.godot');
    const source = readFileSync(projectFile, 'utf8');
    writeFileSync(projectFile, source.replace(/run\/main_scene="[^"]*"/, `run/main_scene="${args.scene}"`));
  }

  writeFileSync(join(worldDir, 'export_presets.cfg'), [
    '[preset.0]',
    'name="Web"',
    'platform="Web"',
    'runnable=true',
    'export_filter="all_resources"',
    'include_filter=""',
    'exclude_filter=""',
    `export_path=${JSON.stringify(join(webDir, 'index.html').replace(/\\/g, '/'))}`,
    '[preset.0.options]',
    `custom_template/release=${JSON.stringify(template.replace(/\\/g, '/'))}`,
    'variant/thread_support=true',
    'variant/extensions_support=false',
    'html/custom_html_shell=""',
    'html/focus_canvas_on_start=false',
    'html/canvas_resize_policy=2',
    'progressive_web_app/enabled=false',
    '',
  ].join('\n'));

  const imported = run(godot, ['--headless', '--path', worldDir, '--import']);
  writeFileSync(join(out, 'import.log'), `${imported.stdout || ''}${imported.stderr || ''}`);
  const exported = run(godot, ['--headless', '--path', worldDir, '--export-release', 'Web', join(webDir, 'index.html')]);
  writeFileSync(join(out, 'export.log'), `${exported.stdout || ''}${exported.stderr || ''}`);
  if (!existsSync(join(webDir, 'index.html'))) {
    throw new Error(`export produced no index.html: ${exported.stdout || exported.stderr}`);
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\//, '');
    const file = join(webDir, name);
    if (!file.startsWith(webDir) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cache-Control': 'no-store',
    });
    response.end(readFileSync(file));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;

  const { chromium } = playwright();
  // Use a system browser rather than Playwright's bundled download: the pinned
  // Playwright version and the installed browser archive do not have to match,
  // and this keeps the capture independent of `npx playwright install`.
  const browserPaths = [
    process.env.CRAFTMINE_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  const executablePath = browserPaths.find((candidate) => existsSync(candidate));
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-gl=swiftshader', '--disable-lcd-text', '--no-first-run', '--no-default-browser-check'],
  });
  const context = await browser.newContext({
    viewport: { width: 320, height: 180 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { timeout: 60000 });
  // Wait until the engine reports it is running and the canvas has drawn.
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    return Boolean(canvas) && canvas.width > 0 && canvas.height > 0;
  }, { timeout: 120000 });
  await page.waitForTimeout(4000);
  const shot = join(out, args.shot || 'town.png');
  await page.screenshot({ path: shot });
  const canvasBox = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return canvas ? { width: canvas.width, height: canvas.height } : null;
  });
  await context.close();
  await browser.close();
  await new Promise((done) => server.close(done));

  const image = decodePng(readFileSync(shot));
  const analysis = analyse(image, { grass: '#4f9b45', road: '#b99b6a', roof: '#a24b3a', skin: '#e8b88a' });
  const files = readdirSync(webDir).sort().map((name) => ({
    path: name,
    bytes: statSync(join(webDir, name)).size,
    sha256: createHash('sha256').update(readFileSync(join(webDir, name))).digest('hex'),
  }));
  const report = {
    format: 'craftmine.godot-topdown-capture/1',
    generatedAt: new Date().toISOString(),
    godot,
    webTemplate: template,
    worldDirectory: worldDir,
    webDirectory: webDir,
    screenshot: shot,
    canvas: canvasBox,
    input: 'none: no mouse, keyboard, focus or Pointer Lock requests',
    consoleErrors,
    analysis,
    files,
  };
  writeFileSync(join(out, 'capture.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ canvas: canvasBox, analysis, consoleErrors: consoleErrors.length }, null, 2)}\n`);
  process.stdout.write(`screenshot: ${shot}\n`);
  if (analysis.colorfulPixels === 0 || analysis.uniqueColors < 8 || consoleErrors.length > 0) {
    process.stderr.write('capture: the rendered frame is blank, nearly blank, or the page reported errors\n');
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`capture: ${error.stack || error.message}\n`);
  process.exit(2);
});
