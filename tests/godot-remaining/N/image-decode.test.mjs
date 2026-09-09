/**
 * AL2 image decoding tests (Craftmine World asset library).
 *
 * Run: node --test tests/godot-remaining/N/image-decode.test.mjs
 *
 * No third-party dependencies, no DOM, no network, no real mouse/keyboard
 * input, no window activation. JPEG fixtures are produced either by
 * System.Drawing inside a hidden `powershell.exe -NoProfile -Command` child
 * process, or (fallback) by reading a system wallpaper read-only. If neither
 * source works the JPEG test skips explicitly instead of faking a pass.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

import {
  AssetPreviewError,
  IMAGE_LIMITS,
  probeImage,
  decodeImage,
  encodePng,
} from '../../../vendor/pi-desktop/apps/desktop/electron/craftmine-assets/decode/image-decode.mjs';

// ---------------------------------------------------------------------------
// Per-case reporting
// ---------------------------------------------------------------------------

const results = [];

function caseTest(name, fn) {
  test(name, async (t) => {
    try {
      await fn(t);
      results.push({ name, state: 'pass' });
      console.log(`[pass] ${name}`);
    } catch (err) {
      results.push({ name, state: 'fail', message: err && err.message });
      console.log(`[fail] ${name}: ${err && err.message}`);
      throw err;
    }
  });
}

function skipCase(t, name, reason) {
  results.push({ name, state: 'skip', message: reason });
  console.log(`[skip] ${name}: ${reason}`);
  t.skip(reason);
}

after(() => {
  console.log('--- image-decode test summary ---');
  for (const r of results) {
    const suffix = r.state === 'pass' ? '' : ` (${r.message || ''})`;
    console.log(`${r.state.toUpperCase().padEnd(4)} ${r.name}${suffix}`);
  }
  const passed = results.filter((r) => r.state === 'pass').length;
  const failed = results.filter((r) => r.state === 'fail').length;
  const skipped = results.filter((r) => r.state === 'skip').length;
  console.log(`--- pass ${passed} / fail ${failed} / skip ${skipped} ---`);
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort cleanup */
    }
  }
  tempDirs.length = 0;
});

const tempDirs = [];

function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function expectError(fn, code, label) {
  let thrown = null;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown !== null, `${label}: expected ${code} but nothing was thrown`);
  assert.ok(
    thrown instanceof AssetPreviewError,
    `${label}: expected AssetPreviewError, got ${thrown && thrown.name}: ${thrown && thrown.message}`,
  );
  assert.equal(
    thrown.code,
    code,
    `${label}: expected code ${code}, got ${thrown.code} (${thrown.message})`,
  );
  assert.equal(typeof thrown.code, 'string', `${label}: error code must be a string`);
  return thrown;
}

// ---------------------------------------------------------------------------
// Independent PNG writer (deliberately does NOT use encodePng)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf, start, end) {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const payload = Buffer.from(data);
  const out = Buffer.alloc(12 + payload.length);
  out.writeUInt32BE(payload.length, 0);
  out.write(type, 4, 'latin1');
  payload.copy(out, 8);
  out.writeUInt32BE(crc32(out, 4, 8 + payload.length), 8 + payload.length);
  return out;
}

/** Hand-built PNG. Rows are plain buffers (filter 0) or `{ filter, data }`. */
function buildPng({ width, height, bitDepth, colorType, rows, palette, trns, interlace = 0 }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = interlace;
  const raw = Buffer.concat(
    rows.map((row) => {
      const explicit =
        row !== null && typeof row === 'object' && !Buffer.isBuffer(row) && row.filter !== undefined;
      const filterType = explicit ? row.filter : 0;
      const data = explicit ? row.data : row;
      return Buffer.concat([Buffer.from([filterType]), Buffer.from(data)]);
    }),
  );
  const parts = [
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
  ];
  if (palette) parts.push(pngChunk('PLTE', palette));
  if (trns) parts.push(pngChunk('tRNS', trns));
  parts.push(pngChunk('IDAT', zlib.deflateSync(raw)));
  parts.push(pngChunk('IEND', Buffer.alloc(0)));
  return new Uint8Array(Buffer.concat(parts));
}

/** Forward PNG filters, used to build a file whose rows exercise filters 0-4. */
function applyFilter(filterType, row, prevRow, bpp) {
  const out = Buffer.alloc(row.length);
  for (let i = 0; i < row.length; i += 1) {
    const raw = row[i];
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = prevRow ? prevRow[i] : 0;
    const c = prevRow && i >= bpp ? prevRow[i - bpp] : 0;
    let predicted = 0;
    if (filterType === 1) predicted = a;
    else if (filterType === 2) predicted = b;
    else if (filterType === 3) predicted = (a + b) >> 1;
    else if (filterType === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[i] = (raw - predicted) & 0xff;
  }
  return out;
}

function pixelAt(rgba, width, x, y) {
  const o = (y * width + x) * 4;
  return [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]];
}

// ---------------------------------------------------------------------------
// Minimal baseline JPEG writer (independent of the decoder)
// ---------------------------------------------------------------------------

class BitWriter {
  constructor() {
    this.bits = [];
  }

  write(value, n) {
    for (let i = n - 1; i >= 0; i -= 1) this.bits.push((value >> i) & 1);
  }

  align() {
    while (this.bits.length % 8 !== 0) this.bits.push(1);
  }

  bytes() {
    const out = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j += 1) b = (b << 1) | this.bits[i + j];
      out.push(b);
      if (b === 0xff) out.push(0x00); // byte stuffing
    }
    return out;
  }
}

const jpegSegment = (marker, payload) => [
  0xff,
  marker,
  ((payload.length + 2) >> 8) & 0xff,
  (payload.length + 2) & 0xff,
  ...payload,
];

/**
 * Build a baseline JPEG whose blocks are DC-only (quant table of all ones),
 * so every block decodes to exactly the sample value that was written.
 * `mcus` is indexed [mcuY * mcusPerLine + mcuX][componentIndex] -> array of
 * h*v sample values.
 */
function buildBaselineJpeg({ width, height, comps, mcus, restartInterval = 0 }) {
  const maxH = Math.max(...comps.map((c) => c.h));
  const maxV = Math.max(...comps.map((c) => c.v));
  const mcusPerLine = Math.ceil(width / (8 * maxH));
  const mcusPerColumn = Math.ceil(height / (8 * maxV));
  const dcCounts = new Array(16).fill(0);
  dcCounts[3] = 12; // twelve 4-bit DC codes (categories 0..11)
  const acCounts = new Array(16).fill(0);
  acCounts[0] = 1; // one 1-bit AC code: EOB

  const chunks = [[0xff, 0xd8]];
  chunks.push(jpegSegment(0xdb, [0, ...new Array(64).fill(1)]));
  chunks.push(
    jpegSegment(0xc0, [
      8,
      (height >> 8) & 0xff,
      height & 0xff,
      (width >> 8) & 0xff,
      width & 0xff,
      comps.length,
      ...comps.flatMap((c) => [c.id, (c.h << 4) | c.v, c.tq]),
    ]),
  );
  chunks.push(jpegSegment(0xc4, [0x00, ...dcCounts, ...Array.from({ length: 12 }, (_, i) => i)]));
  chunks.push(jpegSegment(0xc4, [0x10, ...acCounts, 0x00]));
  if (restartInterval > 0) {
    chunks.push(
      jpegSegment(0xdd, [(restartInterval >> 8) & 0xff, restartInterval & 0xff]),
    );
  }
  chunks.push(
    jpegSegment(0xda, [
      comps.length,
      ...comps.flatMap((c) => [c.id, 0x00]),
      0,
      63,
      0,
    ]),
  );

  const previous = new Map();
  const writer = new BitWriter();
  let mcuIndex = 0;
  for (let my = 0; my < mcusPerColumn; my += 1) {
    for (let mx = 0; mx < mcusPerLine; mx += 1) {
      if (restartInterval > 0 && mcuIndex > 0 && mcuIndex % restartInterval === 0) {
        writer.align();
        chunks.push(writer.bytes());
        writer.bits = [];
        chunks.push([0xff, 0xd0 + ((mcuIndex / restartInterval - 1) % 8)]);
        previous.clear();
      }
      const mcu = mcus[my * mcusPerLine + mx];
      comps.forEach((comp, ci) => {
        for (const sample of mcu[ci]) {
          const dc = (sample - 128) * 8;
          const prev = previous.get(ci) ?? 0;
          const diff = dc - prev;
          previous.set(ci, dc);
          const category = diff === 0 ? 0 : Math.floor(Math.log2(Math.abs(diff))) + 1;
          writer.write(category, 4);
          if (category > 0) {
            writer.write(diff >= 0 ? diff : diff + (1 << category) - 1, category);
          }
          writer.write(0, 1); // EOB
        }
      });
      mcuIndex += 1;
    }
  }
  writer.align();
  chunks.push(writer.bytes());
  chunks.push([0xff, 0xd9]);
  return new Uint8Array(chunks.flat());
}

/** Reference YCbCr -> RGB using the ITU-R BT.601 float formula. */
function ycbcrToRgb(y, cb, cr) {
  const cbb = cb - 128;
  const crr = cr - 128;
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return [
    clamp(y + 1.402 * crr),
    clamp(y - 0.344136 * cbb - 0.714136 * crr),
    clamp(y + 1.772 * cbb),
  ];
}

// ---------------------------------------------------------------------------
// JPEG fixture acquisition
// ---------------------------------------------------------------------------

/**
 * Try to generate a real 16x16 gradient JPEG with System.Drawing in a child
 * powershell process. Returns a Uint8Array or null (never throws).
 */
function generateJpegWithSystemDrawing(dir) {
  const outPath = path.join(dir, 'gradient.jpg');
  const script = [
    "Add-Type -AssemblyName System.Drawing",
    "$ErrorActionPreference='Stop'",
    '$dir=$env:CRAFTMINE_FIXTURE_DIR',
    '$bmp=New-Object System.Drawing.Bitmap 16,16',
    'for($y=0;$y -lt 16;$y++){for($x=0;$x -lt 16;$x++){$v=[int][math]::Round($x*255.0/15.0);$bmp.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(255,$v,$v,$v))}}',
    '$encoders=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders()',
    '$codec=$null;foreach($e in $encoders){if($e.MimeType -eq \'image/jpeg\'){$codec=$e}}',
    'if($codec -eq $null){throw \'no jpeg codec\'}',
    '$params=New-Object System.Drawing.Imaging.EncoderParameters 1',
    '$params.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality),92',
    '$bmp.Save($env:CRAFTMINE_FIXTURE_PATH,$codec,$params)',
    '$bmp.Dispose()',
    'Write-Output \'ok\'',
  ].join('; ');
  try {
    execSync(`powershell.exe -NoProfile -Command "${script}"`, {
      env: {
        ...process.env,
        CRAFTMINE_FIXTURE_DIR: dir,
        CRAFTMINE_FIXTURE_PATH: outPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
      windowsHide: true,
    });
    if (!fs.existsSync(outPath)) return null;
    const bytes = new Uint8Array(fs.readFileSync(outPath));
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    return bytes;
  } catch (err) {
    console.log(`[info] System.Drawing fixture generation failed: ${err.message}`);
    return null;
  }
}

/** Read-only fallback: pick the first .jpg under the Windows wallpaper folder. */
function findSystemWallpaperJpeg() {
  const roots = [
    path.join(process.env.WINDIR || 'C:\\Windows', 'Web', 'Wallpaper'),
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (/\.jpe?g$/i.test(entry.name)) {
          try {
            const bytes = new Uint8Array(fs.readFileSync(full));
            if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
              return { bytes, source: `system wallpaper (read-only): ${full}` };
            }
          } catch {
            /* ignore unreadable entries */
          }
        }
      }
    }
  }
  return null;
}

/**
 * @returns {{bytes:Uint8Array, source:string, gradient:boolean}|null}
 */
function acquireJpegFixture() {
  const dir = makeTempDir('craftmine-al2-jpeg-');
  const generated = generateJpegWithSystemDrawing(dir);
  if (generated !== null) {
    return {
      bytes: generated,
      source: `System.Drawing powershell.exe -NoProfile -Command -> ${path.join(dir, 'gradient.jpg')}`,
      gradient: true,
    };
  }
  const wallpaper = findSystemWallpaperJpeg();
  if (wallpaper !== null) {
    return { bytes: wallpaper.bytes, source: wallpaper.source, gradient: false };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tests: module surface
// ---------------------------------------------------------------------------

caseTest('image-limits-exact-values', async () => {
  assert.deepEqual(
    { ...IMAGE_LIMITS },
    {
      bytes: 16 * 1024 * 1024,
      side: 8192,
      pixels: 33554432,
      decodeMs: 20000,
    },
  );
});

caseTest('asset-preview-error-shape', async () => {
  const err = new AssetPreviewError('CORRUPT_IMAGE', 'boom');
  assert.ok(err instanceof Error);
  assert.ok(err instanceof AssetPreviewError);
  assert.equal(err.code, 'CORRUPT_IMAGE');
  assert.equal(typeof err.code, 'string');
  assert.equal(err.message, 'boom');
  assert.equal(err.name, 'AssetPreviewError');
});

// ---------------------------------------------------------------------------
// Tests: PNG decoding
// ---------------------------------------------------------------------------

caseTest('png-rgb8-exact-pixels-and-probe', async () => {
  const rows = [
    Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]),
    Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 250, 251, 252]),
  ];
  const png = buildPng({ width: 4, height: 2, bitDepth: 8, colorType: 2, rows });

  const probe = probeImage(png);
  assert.deepEqual(probe, {
    format: 'png',
    width: 4,
    height: 2,
    bitDepth: 8,
    colorType: 2,
    interlace: 0,
    progressive: false,
    bytes: png.length,
  });

  const decoded = decodeImage(png);
  assert.equal(decoded.format, 'png');
  assert.equal(decoded.width, 4);
  assert.equal(decoded.height, 2);
  assert.ok(decoded.rgba instanceof Uint8Array);
  assert.equal(decoded.rgba.length, 4 * 2 * 4);
  assert.deepEqual(pixelAt(decoded.rgba, 4, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixelAt(decoded.rgba, 4, 1, 0), [0, 255, 0, 255]);
  assert.deepEqual(pixelAt(decoded.rgba, 4, 2, 0), [0, 0, 255, 255]);
  assert.deepEqual(pixelAt(decoded.rgba, 4, 3, 0), [10, 20, 30, 255]);
  assert.deepEqual(pixelAt(decoded.rgba, 4, 0, 1), [1, 2, 3, 255]);
  assert.deepEqual(pixelAt(decoded.rgba, 4, 3, 1), [250, 251, 252, 255]);
  assert.match(decoded.pixelDigest, /^[0-9a-f]{64}$/);
  assert.equal(decoded.thumbnail.width, 4);
  assert.equal(decoded.thumbnail.height, 2);
});

caseTest('png-scanline-filters-0-1-2-3-4', async () => {
  const width = 6;
  const height = 5;
  const bpp = 4; // RGBA8
  const rawRows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(width * bpp);
    for (let x = 0; x < width; x += 1) {
      row[x * 4] = (x * 40 + y * 7) & 0xff;
      row[x * 4 + 1] = (x * 11 + y * 53) & 0xff;
      row[x * 4 + 2] = (x * 90 + y * 3) & 0xff;
      row[x * 4 + 3] = 255 - y * 20;
    }
    rawRows.push(row);
  }
  const rows = rawRows.map((row, y) => ({
    filter: y,
    data: applyFilter(y, row, y > 0 ? rawRows[y - 1] : null, bpp),
  }));
  const png = buildPng({ width, height, bitDepth: 8, colorType: 6, rows });

  const decoded = decodeImage(png);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      assert.deepEqual(
        pixelAt(decoded.rgba, width, x, y),
        Array.from(rawRows[y].subarray(x * 4, x * 4 + 4)),
        `filtered row ${y} pixel ${x}`,
      );
    }
  }
});

caseTest('png-palette-bitdepth4-with-trns', async () => {
  const palette = Buffer.from([
    0, 0, 0,
    255, 0, 0,
    0, 255, 0,
    0, 0, 255,
    9, 8, 7,
  ]);
  const trns = Buffer.from([0, 64, 128, 255, 200]);
  // One row, four 4-bit indices: 0, 1, 2, 3, 4 -> bytes 0x01 0x23 0x40
  const png = buildPng({
    width: 5,
    height: 1,
    bitDepth: 4,
    colorType: 3,
    rows: [Buffer.from([0x01, 0x23, 0x40])],
    palette,
    trns,
  });
  const decoded = decodeImage(png);
  assert.deepEqual(pixelAt(decoded.rgba, 5, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixelAt(decoded.rgba, 5, 1, 0), [255, 0, 0, 64]);
  assert.deepEqual(pixelAt(decoded.rgba, 5, 2, 0), [0, 255, 0, 128]);
  assert.deepEqual(pixelAt(decoded.rgba, 5, 3, 0), [0, 0, 255, 255]);
  assert.deepEqual(pixelAt(decoded.rgba, 5, 4, 0), [9, 8, 7, 200]);
});

caseTest('png-palette-without-trns-is-opaque', async () => {
  const palette = Buffer.from([10, 20, 30, 40, 50, 60]);
  const png = buildPng({
    width: 3,
    height: 1,
    bitDepth: 8,
    colorType: 3,
    rows: [Buffer.from([0, 1, 1])],
    palette,
  });
  const decoded = decodeImage(png);
  assert.deepEqual(pixelAt(decoded.rgba, 3, 0, 0), [10, 20, 30, 255]);
  assert.deepEqual(pixelAt(decoded.rgba, 3, 1, 0), [40, 50, 60, 255]);
  assert.deepEqual(pixelAt(decoded.rgba, 3, 2, 0), [40, 50, 60, 255]);
});

caseTest('png-grayscale-bitdepth1', async () => {
  // 8 samples packed MSB-first: 1,0,1,0,1,0,1,0 -> 0xAA
  const png = buildPng({
    width: 8,
    height: 1,
    bitDepth: 1,
    colorType: 0,
    rows: [Buffer.from([0xaa])],
  });
  const decoded = decodeImage(png);
  for (let x = 0; x < 8; x += 1) {
    const expected = x % 2 === 0 ? 255 : 0;
    assert.deepEqual(
      pixelAt(decoded.rgba, 8, x, 0),
      [expected, expected, expected, 255],
      `1-bit gray sample ${x}`,
    );
  }
});

caseTest('png-16bit-shifts-to-8bit', async () => {
  // gray 16-bit: high bytes 0x12, 0xab
  const gray = buildPng({
    width: 2,
    height: 1,
    bitDepth: 16,
    colorType: 0,
    rows: [Buffer.from([0x12, 0x34, 0xab, 0xcd])],
  });
  const grayDecoded = decodeImage(gray);
  assert.deepEqual(pixelAt(grayDecoded.rgba, 2, 0, 0), [0x12, 0x12, 0x12, 255]);
  assert.deepEqual(pixelAt(grayDecoded.rgba, 2, 1, 0), [0xab, 0xab, 0xab, 255]);

  // RGBA 16-bit
  const rgba = buildPng({
    width: 1,
    height: 1,
    bitDepth: 16,
    colorType: 6,
    rows: [Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88])],
  });
  assert.deepEqual(pixelAt(decodeImage(rgba).rgba, 1, 0, 0), [0x11, 0x33, 0x55, 0x77]);
});

caseTest('png-grayscale-with-trns', async () => {
  const png = buildPng({
    width: 3,
    height: 1,
    bitDepth: 8,
    colorType: 0,
    rows: [Buffer.from([0, 77, 255])],
    trns: Buffer.from([0x00, 0x4d]), // transparent for value 77
  });
  const decoded = decodeImage(png);
  assert.deepEqual(pixelAt(decoded.rgba, 3, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(pixelAt(decoded.rgba, 3, 1, 0), [77, 77, 77, 0]);
  assert.deepEqual(pixelAt(decoded.rgba, 3, 2, 0), [255, 255, 255, 255]);
});

caseTest('png-encode-decode-roundtrip', async () => {
  const width = 9;
  const height = 7;
  const source = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    source[i * 4] = (i * 3) & 0xff;
    source[i * 4 + 1] = (i * 7 + 5) & 0xff;
    source[i * 4 + 2] = (i * 11 + 9) & 0xff;
    source[i * 4 + 3] = i % 3 === 0 ? 128 : 255;
  }
  const png = encodePng(source, width, height);
  assert.ok(png instanceof Uint8Array);
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const probe = probeImage(png);
  assert.equal(probe.format, 'png');
  assert.equal(probe.width, width);
  assert.equal(probe.height, height);
  assert.equal(probe.colorType, 6);
  assert.equal(probe.bitDepth, 8);

  const decoded = decodeImage(png);
  assert.equal(decoded.rgba.length, source.length);
  for (let i = 0; i < source.length; i += 1) {
    assert.equal(decoded.rgba[i], source[i], `roundtrip byte ${i}`);
  }
  const again = decodeImage(png);
  assert.equal(again.pixelDigest, decoded.pixelDigest);
});

// ---------------------------------------------------------------------------
// Tests: JPEG decoding
// ---------------------------------------------------------------------------

caseTest('jpeg-real-file-pixels', async (t) => {
  const fixture = acquireJpegFixture();
  if (fixture === null) {
    skipCase(t, 'jpeg-real-file-pixels', 'no jpeg fixture');
    return;
  }
  console.log(`[info] jpeg fixture source: ${fixture.source}`);
  const { bytes } = fixture;

  const probe = probeImage(bytes);
  assert.equal(probe.format, 'jpeg');
  assert.ok(probe.width > 0 && probe.height > 0);
  assert.equal(probe.progressive, false);
  assert.equal(probe.interlace, 0);
  assert.equal(probe.bytes, bytes.length);
  assert.equal(probe.bitDepth, 8);

  const decoded = decodeImage(bytes);
  assert.equal(decoded.format, 'jpeg');
  assert.equal(decoded.width, probe.width);
  assert.equal(decoded.height, probe.height);
  assert.equal(decoded.rgba.length, probe.width * probe.height * 4);
  assert.match(decoded.pixelDigest, /^[0-9a-f]{64}$/);
  // deterministic
  assert.equal(decodeImage(bytes).pixelDigest, decoded.pixelDigest);

  if (fixture.gradient) {
    // Generated 16x16 horizontal black -> white ramp.
    assert.equal(decoded.width, 16);
    assert.equal(decoded.height, 16);
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const [r, g, b, a] = pixelAt(decoded.rgba, 16, x, y);
        const expected = Math.round((x * 255) / 15);
        assert.equal(a, 255, `alpha at ${x},${y}`);
        assert.ok(
          Math.abs(r - expected) <= 40,
          `red ramp at ${x},${y}: got ${r}, expected ~${expected}`,
        );
        assert.ok(Math.abs(r - g) <= 2 && Math.abs(g - b) <= 2, `gray at ${x},${y}`);
      }
    }
    // monotonic ramp along x (allow tiny local dips from DCT ringing)
    for (let y = 0; y < 16; y += 1) {
      let previous = -1;
      for (let x = 0; x < 16; x += 1) {
        const value = pixelAt(decoded.rgba, 16, x, y)[0];
        assert.ok(value >= previous - 6, `ramp monotonic at ${x},${y}`);
        previous = value;
      }
    }
    assert.ok(pixelAt(decoded.rgba, 16, 0, 8)[0] < 48, 'dark end of ramp');
    assert.ok(pixelAt(decoded.rgba, 16, 15, 8)[0] > 207, 'bright end of ramp');
  } else {
    // System wallpaper fallback: verify real content, not a flat placeholder.
    let distinct = new Set();
    const stepX = Math.max(1, Math.floor(probe.width / 32));
    const stepY = Math.max(1, Math.floor(probe.height / 32));
    for (let y = 0; y < probe.height; y += stepY) {
      for (let x = 0; x < probe.width; x += stepX) {
        const [r, g, b, a] = pixelAt(decoded.rgba, probe.width, x, y);
        assert.equal(a, 255);
        distinct.add((r << 16) | (g << 8) | b);
      }
    }
    assert.ok(distinct.size > 8, `expected varied pixels, got ${distinct.size} distinct colours`);
  }
});

caseTest('jpeg-restart-interval-and-rst-markers', async () => {
  // Grayscale 16x16, one block per MCU, DRI = 1 -> an RSTn after every MCU.
  const comps = [{ id: 1, h: 1, v: 1, tq: 0 }];
  const mcus = Array.from({ length: 16 }, () => [[128]]);
  const jpeg = buildBaselineJpeg({
    width: 16,
    height: 16,
    comps,
    mcus,
    restartInterval: 1,
  });
  const probe = probeImage(jpeg);
  assert.equal(probe.format, 'jpeg');
  assert.equal(probe.colorType, 1);
  assert.equal(probe.width, 16);
  assert.equal(probe.height, 16);

  const decoded = decodeImage(jpeg);
  for (let i = 0; i < decoded.rgba.length; i += 4) {
    assert.deepEqual(
      [decoded.rgba[i], decoded.rgba[i + 1], decoded.rgba[i + 2], decoded.rgba[i + 3]],
      [128, 128, 128, 255],
      `pixel ${i / 4}`,
    );
  }
});

caseTest('jpeg-444-chroma-color-conversion', async () => {
  const comps = [
    { id: 1, h: 1, v: 1, tq: 0 },
    { id: 2, h: 1, v: 1, tq: 0 },
    { id: 3, h: 1, v: 1, tq: 0 },
  ];
  const mcus = Array.from({ length: 4 }, () => [[180], [90], [170]]);
  const jpeg = buildBaselineJpeg({ width: 16, height: 16, comps, mcus });
  const decoded = decodeImage(jpeg);
  const expected = ycbcrToRgb(180, 90, 170);
  for (const [x, y] of [[0, 0], [7, 7], [15, 15], [3, 12]]) {
    const [r, g, b, a] = pixelAt(decoded.rgba, 16, x, y);
    assert.equal(a, 255);
    assert.ok(Math.abs(r - expected[0]) <= 2, `R at ${x},${y}: ${r} vs ${expected[0]}`);
    assert.ok(Math.abs(g - expected[1]) <= 2, `G at ${x},${y}: ${g} vs ${expected[1]}`);
    assert.ok(Math.abs(b - expected[2]) <= 2, `B at ${x},${y}: ${b} vs ${expected[2]}`);
  }
});

caseTest('jpeg-rgb-component-ids-skip-colour-conversion', async () => {
  // Components labelled 'R','G','B' (0x52/0x47/0x42) are already RGB.
  const comps = [
    { id: 0x52, h: 1, v: 1, tq: 0 },
    { id: 0x47, h: 1, v: 1, tq: 0 },
    { id: 0x42, h: 1, v: 1, tq: 0 },
  ];
  const mcus = Array.from({ length: 4 }, () => [[200], [100], [50]]);
  const jpeg = buildBaselineJpeg({ width: 16, height: 16, comps, mcus });
  const decoded = decodeImage(jpeg);
  assert.deepEqual(pixelAt(decoded.rgba, 16, 0, 0), [200, 100, 50, 255]);
  assert.deepEqual(pixelAt(decoded.rgba, 16, 15, 15), [200, 100, 50, 255]);
});

caseTest('jpeg-422-chroma-upsampling-step', async () => {
  // 32x16, Y is 4:2:2 (h=2), chroma is h=1 -> 16 chroma samples = 2 blocks.
  const comps = [
    { id: 1, h: 2, v: 1, tq: 0 },
    { id: 2, h: 1, v: 1, tq: 0 },
    { id: 3, h: 1, v: 1, tq: 0 },
  ];
  const mcus = [];
  for (let my = 0; my < 2; my += 1) {
    for (let mx = 0; mx < 2; mx += 1) {
      mcus.push([[128, 128], [mx === 0 ? 100 : 160], [128]]);
    }
  }
  const jpeg = buildBaselineJpeg({ width: 32, height: 16, comps, mcus });
  const probe = probeImage(jpeg);
  assert.equal(probe.width, 32);
  assert.equal(probe.colorType, 3);

  const decoded = decodeImage(jpeg);
  const leftExpected = ycbcrToRgb(128, 100, 128)[2];
  const rightExpected = ycbcrToRgb(128, 160, 128)[2];
  for (let x = 0; x < 32; x += 1) {
    const [, , b, a] = pixelAt(decoded.rgba, 32, x, 0);
    assert.equal(a, 255);
    const expected = x < 16 ? leftExpected : rightExpected;
    assert.ok(Math.abs(b - expected) <= 1, `blue at x=${x}: ${b} vs ${expected}`);
  }
  assert.ok(
    Math.abs(rightExpected - leftExpected) > 40,
    'fixture must contain a visible chroma step',
  );
});

caseTest('jpeg-420-subsampling-block-layout', async () => {
  // 16x16 = one MCU: Y has 2x2 blocks, chroma 1 block each.
  const comps = [
    { id: 1, h: 2, v: 2, tq: 0 },
    { id: 2, h: 1, v: 1, tq: 0 },
    { id: 3, h: 1, v: 1, tq: 0 },
  ];
  const mcus = [[[10, 60, 110, 160], [128], [128]]];
  const jpeg = buildBaselineJpeg({ width: 16, height: 16, comps, mcus });
  const decoded = decodeImage(jpeg);
  // Block order is [top-left, top-right, bottom-left, bottom-right].
  const expectations = [
    { x0: 0, y0: 0, value: 10 },
    { x0: 8, y0: 0, value: 60 },
    { x0: 0, y0: 8, value: 110 },
    { x0: 8, y0: 8, value: 160 },
  ];
  for (const { x0, y0, value } of expectations) {
    for (let y = y0; y < y0 + 8; y += 1) {
      for (let x = x0; x < x0 + 8; x += 1) {
        const [r, g, b, a] = pixelAt(decoded.rgba, 16, x, y);
        assert.deepEqual([r, g, b, a], [value, value, value, 255], `block pixel ${x},${y}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Tests: thumbnails
// ---------------------------------------------------------------------------

caseTest('thumbnail-maxside-keeps-aspect-ratio', async () => {
  const source = new Uint8Array(300 * 150 * 4).fill(200);
  const png = encodePng(source, 300, 150);

  const small = decodeImage(png, { maxSide: 64 });
  assert.equal(small.thumbnail.width, 64);
  assert.equal(small.thumbnail.height, 32);
  assert.deepEqual(Array.from(small.thumbnail.png.subarray(0, 8)), [
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  const thumbBack = decodeImage(small.thumbnail.png);
  assert.equal(thumbBack.width, 64);
  assert.equal(thumbBack.height, 32);
  assert.equal(thumbBack.rgba[0], 200);

  const wide = decodeImage(png, { maxSide: 200 });
  assert.equal(wide.thumbnail.width, 200);
  assert.equal(wide.thumbnail.height, 100);

  // Smaller than maxSide: never upscale.
  const tinySource = new Uint8Array(16 * 16 * 4).fill(7);
  const tiny = decodeImage(encodePng(tinySource, 16, 16), { maxSide: 256 });
  assert.equal(tiny.thumbnail.width, 16);
  assert.equal(tiny.thumbnail.height, 16);

  // Default maxSide is 256.
  const byDefault = decodeImage(encodePng(source, 300, 150));
  assert.equal(byDefault.thumbnail.width, 256);
  assert.equal(byDefault.thumbnail.height, 128);
});

caseTest('thumbnail-box-filter-averages', async () => {
  // 4x4 image made of four 2x2 blocks with known contents -> 2x2 thumbnail.
  const width = 4;
  const height = 4;
  const source = new Uint8Array(width * height * 4);
  const blocks = [
    // [dx, dy] block origin -> the four pixel values (R channel)
    { x: 0, y: 0, values: [0, 0, 4, 4] },
    { x: 2, y: 0, values: [0, 8, 8, 0] },
    { x: 0, y: 2, values: [10, 20, 30, 40] },
    { x: 2, y: 2, values: [254, 254, 0, 0] },
  ];
  const expected = [];
  for (const block of blocks) {
    let sum = 0;
    for (let i = 0; i < 4; i += 1) {
      const dx = i % 2;
      const dy = Math.floor(i / 2);
      const px = block.x + dx;
      const py = block.y + dy;
      const o = (py * width + px) * 4;
      source[o] = block.values[i];
      source[o + 1] = 128;
      source[o + 2] = 255 - block.values[i];
      source[o + 3] = 255;
      sum += block.values[i];
    }
    expected.push(Math.round(sum / 4));
  }

  const decoded = decodeImage(encodePng(source, width, height), { maxSide: 2 });
  assert.equal(decoded.thumbnail.width, 2);
  assert.equal(decoded.thumbnail.height, 2);
  // Full resolution data must stay untouched by the thumbnail pass.
  for (let i = 0; i < source.length; i += 1) {
    assert.equal(decoded.rgba[i], source[i], `full-res byte ${i}`);
  }
  const thumb = decodeImage(decoded.thumbnail.png);
  assert.equal(thumb.width, 2);
  assert.equal(thumb.height, 2);
  const got = [
    thumb.rgba[0],
    thumb.rgba[4],
    thumb.rgba[8],
    thumb.rgba[12],
  ];
  assert.deepEqual(got, expected);
});

caseTest('options-maxside-validation', async () => {
  const png = encodePng(new Uint8Array(4 * 4 * 4), 4, 4);
  expectError(() => decodeImage(png, { maxSide: 0 }), 'INVALID_OPTION', 'maxSide 0');
  expectError(() => decodeImage(png, { maxSide: 2049 }), 'INVALID_OPTION', 'maxSide 2049');
  expectError(() => decodeImage(png, { maxSide: 1.5 }), 'INVALID_OPTION', 'maxSide 1.5');
  expectError(
    () => decodeImage(png, { deadline: Number.NaN }),
    'INVALID_OPTION',
    'deadline NaN',
  );
});

// ---------------------------------------------------------------------------
// Tests: deadline
// ---------------------------------------------------------------------------

caseTest('deadline-expired-throws-preview-timeout', async () => {
  const source = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < source.length; i += 1) source[i] = i & 0xff;
  const png = encodePng(source, 64, 64);

  // Tiny (already elapsed) deadline: the decode loop must abort.
  const err = expectError(
    () => decodeImage(png, { deadline: Date.now() - 1 }),
    'PREVIEW_TIMEOUT',
    'elapsed deadline',
  );
  assert.match(err.message, /deadline/i);

  // Deadline in the near future still decodes successfully.
  const ok = decodeImage(png, { deadline: Date.now() + 60000 });
  assert.equal(ok.width, 64);
});

// ---------------------------------------------------------------------------
// Tests: malformed input
// ---------------------------------------------------------------------------

caseTest('error-truncated-png-is-corrupt', async () => {
  const rows = [Buffer.from([1, 2, 3, 4, 5, 6])];
  const png = buildPng({ width: 2, height: 1, bitDepth: 8, colorType: 2, rows });
  expectError(() => decodeImage(png.slice(0, png.length - 9)), 'CORRUPT_IMAGE', 'truncated png decode');
  expectError(() => probeImage(png.slice(0, 12)), 'CORRUPT_IMAGE', 'truncated png probe');
  // Broken CRC must be detected too.
  const badCrc = Uint8Array.from(png);
  badCrc[badCrc.length - 5] ^= 0xff;
  expectError(() => probeImage(badCrc), 'CORRUPT_IMAGE', 'png bad crc');
});

caseTest('error-fake-jpeg-sof-is-corrupt', async () => {
  // SOI + SOF0 whose declared length runs past the end of the buffer.
  const fakeSof = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, 0, 16, 0, 16]);
  expectError(() => probeImage(fakeSof), 'CORRUPT_IMAGE', 'fake SOF probe');
  expectError(() => decodeImage(fakeSof), 'CORRUPT_IMAGE', 'fake SOF decode');

  // SOI only: no frame header at all.
  expectError(
    () => probeImage(new Uint8Array([0xff, 0xd8])),
    'CORRUPT_IMAGE',
    'SOI only',
  );
});

caseTest('error-oversized-headers-are-too-large', async () => {
  // PNG IHDR declaring a 100000 px wide image.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(100000, 0);
  ihdr.writeUInt32BE(10, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const hugePng = new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', zlib.deflateSync(Buffer.alloc(4))),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  );
  expectError(() => probeImage(hugePng), 'IMAGE_TOO_LARGE', 'huge png probe');
  expectError(() => decodeImage(hugePng), 'IMAGE_TOO_LARGE', 'huge png decode');

  // Same for a JPEG SOF (10000 x 16).
  const hugeJpeg = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 8, 0, 16, 0x27, 0x10, 3,
    1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xd9,
  ]);
  expectError(() => probeImage(hugeJpeg), 'IMAGE_TOO_LARGE', 'huge jpeg probe');

  // Pixel-count limit: 8192 x 8192 = 67M pixels > 33.5M limit.
  const manyPixels = Buffer.alloc(13);
  manyPixels.writeUInt32BE(8192, 0);
  manyPixels.writeUInt32BE(8192, 4);
  manyPixels[8] = 8;
  manyPixels[9] = 2;
  const pixelBomb = new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', manyPixels),
      pngChunk('IDAT', zlib.deflateSync(Buffer.alloc(4))),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  );
  expectError(() => probeImage(pixelBomb), 'IMAGE_TOO_LARGE', 'pixel bomb');
});

caseTest('error-byte-limit-is-too-large', async () => {
  const oversized = new Uint8Array(IMAGE_LIMITS.bytes + 1);
  expectError(() => probeImage(oversized), 'IMAGE_TOO_LARGE', 'byte limit probe');
  expectError(() => decodeImage(oversized), 'IMAGE_TOO_LARGE', 'byte limit decode');
});

caseTest('error-unsupported-format', async () => {
  expectError(
    () => probeImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
    'UNSUPPORTED_FORMAT',
    'random bytes',
  );
  expectError(
    () => decodeImage(new Uint8Array(0)),
    'UNSUPPORTED_FORMAT',
    'empty bytes',
  );
});

caseTest('error-truncated-jpeg-entropy-is-corrupt', async (t) => {
  const fixture = acquireJpegFixture();
  if (fixture === null) {
    skipCase(t, 'error-truncated-jpeg-entropy-is-corrupt', 'no jpeg fixture');
    return;
  }
  const bytes = fixture.bytes;
  let sosPos = -1;
  for (let i = 0; i + 1 < bytes.length; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xda) {
      sosPos = i;
      break;
    }
  }
  assert.ok(sosPos > 0, 'fixture must contain an SOS marker');
  const sosLength = (bytes[sosPos + 2] << 8) | bytes[sosPos + 3];
  // Keep the complete SOS header plus 2 entropy bytes: the first block cannot
  // be Huffman-decoded, which must surface as CORRUPT_IMAGE.
  const truncated = bytes.slice(0, sosPos + 2 + sosLength + 2);
  expectError(
    () => decodeImage(truncated),
    'CORRUPT_IMAGE',
    'truncated entropy',
  );
});

// ---------------------------------------------------------------------------
// Tests: explicitly unsupported variants
// ---------------------------------------------------------------------------

caseTest('unsupported-adam7-png', async () => {
  const png = buildPng({
    width: 4,
    height: 2,
    bitDepth: 8,
    colorType: 2,
    rows: [Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), Buffer.alloc(12)],
    interlace: 1,
  });
  // probe reports the interlace flag ...
  const probe = probeImage(png);
  assert.equal(probe.format, 'png');
  assert.equal(probe.interlace, 1);
  // ... but decoding refuses instead of producing a fake image.
  const err = expectError(
    () => decodeImage(png),
    'UNSUPPORTED_PNG_VARIANT',
    'adam7 decode',
  );
  assert.match(err.message, /Adam7/i);
});

caseTest('unsupported-progressive-jpeg', async () => {
  const sof2 = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc2, 0x00, 0x11, 8, 0, 16, 0, 16, 3,
    1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xd9,
  ]);
  const probe = probeImage(sof2);
  assert.equal(probe.format, 'jpeg');
  assert.equal(probe.progressive, true);
  assert.equal(probe.width, 16);
  assert.equal(probe.height, 16);

  const err = expectError(
    () => decodeImage(sof2),
    'UNSUPPORTED_JPEG_VARIANT',
    'progressive decode',
  );
  assert.match(err.message, /progressive/i);

  // 12-bit extended sequential and lossless SOF3 are rejected as well.
  const twelveBit = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc1, 0x00, 0x11, 12, 0, 16, 0, 16, 3,
    1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xd9,
  ]);
  expectError(
    () => decodeImage(twelveBit),
    'UNSUPPORTED_JPEG_VARIANT',
    '12-bit jpeg',
  );

  const lossless = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc3, 0x00, 0x0b, 8, 0, 16, 0, 16, 1, 1, 0x11, 0,
    0xff, 0xd9,
  ]);
  expectError(
    () => decodeImage(lossless),
    'UNSUPPORTED_JPEG_VARIANT',
    'lossless jpeg',
  );
});
