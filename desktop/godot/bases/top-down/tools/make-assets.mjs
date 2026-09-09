#!/usr/bin/env node
// Generates the top-down base's original pixel art and its TileSet resource.
//
// Everything here is drawn procedurally by this file, so the art has a known
// origin and a permissive licence (see ASSET_SOURCES.md). No third-party or
// engine-sample artwork is copied, and no external npm package is required: the
// PNG encoder below uses only Node's zlib.
//
// Usage:
//   node tools/make-assets.mjs [--out <assets-directory>]

import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(HERE, '..', 'core', 'assets');

const TILE = 16;
const TILESET_COLUMNS = 8;
const TILESET_ROWS = 4;
const SHEET_COLUMNS = 4;
const SHEET_ROWS = 4;

// ------------------------------------------------------------------ PNG output

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function parseColor(value) {
  if (Array.isArray(value)) return value;
  const hex = String(value).replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) : 255;
  return [r, g, b, a];
}

class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 4);
  }

  set(x, y, color) {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const [r, g, b, a] = parseColor(color);
    const index = (py * this.width + px) * 4;
    this.data[index] = r;
    this.data[index + 1] = g;
    this.data[index + 2] = b;
    this.data[index + 3] = a;
  }

  fill(x, y, w, h, color) {
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) this.set(x + dx, y + dy, color);
    }
  }

  toPng() {
    return encodePng(this.width, this.height, this.data);
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------- tile art

const COLORS = {
  grass: '#4f9b45',
  grassLight: '#57a84b',
  grassDark: '#468c3e',
  road: '#b99b6a',
  roadDark: '#a8894f',
  roadLight: '#c6aa79',
  stone: '#b8b0a0',
  stoneDark: '#a09888',
  wood: '#c89a63',
  woodLine: '#b0864f',
  floor: '#d8d0c0',
  floorGrid: '#c0b8a8',
  brick: '#8a6a4a',
  mortar: '#a08a6a',
  brickDark: '#7a5a3a',
  roof: '#a24b3a',
  roofDark: '#8a3a2c',
  door: '#6a4a2a',
  knob: '#d8b060',
  window: '#7ac0e0',
  frame: '#6a4a2a',
  signBoard: '#c8a060',
  post: '#6a4a2a',
  fence: '#a8894f',
  herb: '#2f7a3a',
  herbLight: '#3fa04a',
  counterTop: '#c88a55',
  counterBody: '#b07a4a',
  shelf: '#8a6a4a',
  crate: '#b08a5a',
  crateEdge: '#8a6a3a',
  trunk: '#6a4a2a',
  treeTop: '#2f7a3a',
  treeTopLight: '#3fa04a',
  shadow: '#00000040',
  flowerA: '#e8e05a',
  flowerB: '#e86a8a',
  white: '#e8e8e0',
};

function drawTileset(rng) {
  const canvas = new Canvas(TILESET_COLUMNS * TILE, TILESET_ROWS * TILE);
  const speckle = (x, y, size, base, variants, count) => {
    canvas.fill(x, y, size, size, base);
    for (let i = 0; i < count; i += 1) {
      canvas.set(
        x + Math.floor(rng() * size),
        y + Math.floor(rng() * size),
        variants[Math.floor(rng() * variants.length)],
      );
    }
  };
  const tile = (col, row, painter) => painter(col * TILE, row * TILE);

  tile(0, 0, (x, y) => speckle(x, y, TILE, COLORS.grass, [COLORS.grassLight, COLORS.grassDark], 16));
  tile(1, 0, (x, y) => speckle(x, y, TILE, COLORS.grassDark, [COLORS.grass, COLORS.grassLight], 12));
  tile(2, 0, (x, y) => speckle(x, y, TILE, COLORS.road, [COLORS.roadDark, COLORS.roadLight], 14));
  tile(3, 0, (x, y) => speckle(x, y, TILE, COLORS.roadDark, [COLORS.road, COLORS.roadLight], 12));
  tile(4, 0, (x, y) => {
    speckle(x, y, TILE, COLORS.grass, [COLORS.grassLight, COLORS.grassDark], 14);
    canvas.fill(x + 3, y + 4, 2, 2, COLORS.flowerA);
    canvas.fill(x + 10, y + 9, 2, 2, COLORS.flowerB);
    canvas.set(x + 11, y + 3, COLORS.white);
  });
  tile(5, 0, (x, y) => {
    speckle(x, y, TILE, COLORS.stone, [COLORS.stoneDark], 10);
    canvas.fill(x, y + 7, TILE, 1, COLORS.stoneDark);
    canvas.fill(x + 7, y, 1, TILE, COLORS.stoneDark);
  });
  tile(6, 0, (x, y) => {
    canvas.fill(x, y, TILE, TILE, COLORS.wood);
    canvas.fill(x, y + 5, TILE, 1, COLORS.woodLine);
    canvas.fill(x, y + 11, TILE, 1, COLORS.woodLine);
  });
  tile(7, 0, (x, y) => {
    canvas.fill(x, y, TILE, TILE, COLORS.floor);
    canvas.fill(x + 7, y, 1, TILE, COLORS.floorGrid);
    canvas.fill(x, y + 7, TILE, 1, COLORS.floorGrid);
  });

  tile(0, 1, (x, y) => {
    canvas.fill(x, y, TILE, TILE, COLORS.brick);
    for (let row = 0; row < 4; row += 1) {
      canvas.fill(x, y + row * 4 + 3, TILE, 1, COLORS.mortar);
      const offset = row % 2 === 0 ? 0 : 8;
      canvas.fill(x + offset, y + row * 4, 1, 3, COLORS.mortar);
      canvas.fill(x + (offset + 8) % TILE, y + row * 4, 1, 3, COLORS.mortar);
      canvas.set(x + 2, y + row * 4 + 1, COLORS.brickDark);
    }
  });
  tile(1, 1, (x, y) => {
    canvas.fill(x, y, TILE, TILE, COLORS.brick);
    canvas.fill(x, y, TILE, 3, COLORS.brickDark);
    canvas.fill(x, y, TILE, 1, COLORS.mortar);
  });
  tile(2, 1, (x, y) => {
    canvas.fill(x, y, TILE, TILE, COLORS.roof);
    for (let row = 0; row < 4; row += 1) canvas.fill(x, y + row * 4 + 3, TILE, 1, COLORS.roofDark);
  });
  tile(3, 1, (x, y) => {
    canvas.fill(x, y, TILE, TILE, COLORS.roofDark);
    for (let row = 0; row < 4; row += 1) canvas.fill(x, y + row * 4, TILE, 1, COLORS.roof);
  });
  tile(4, 1, (x, y) => {
    canvas.fill(x, y, TILE, TILE, COLORS.frame);
    canvas.fill(x + 2, y + 1, 12, 14, COLORS.door);
    canvas.fill(x + 11, y + 8, 2, 2, COLORS.knob);
  });
  tile(5, 1, (x, y) => {
    canvas.fill(x, y, TILE, TILE, COLORS.brick);
    canvas.fill(x + 2, y + 3, 12, 10, COLORS.frame);
    canvas.fill(x + 3, y + 4, 10, 8, COLORS.window);
    canvas.fill(x + 8, y + 4, 1, 8, COLORS.frame);
  });
  tile(6, 1, (x, y) => {
    speckle(x, y, TILE, COLORS.grass, [COLORS.grassLight], 12);
    canvas.fill(x + 7, y + 8, 2, 8, COLORS.post);
    canvas.fill(x + 3, y + 3, 10, 6, COLORS.signBoard);
    canvas.fill(x + 4, y + 5, 8, 1, COLORS.post);
  });
  tile(7, 1, (x, y) => {
    speckle(x, y, TILE, COLORS.grass, [COLORS.grassLight], 12);
    canvas.fill(x, y + 4, TILE, 2, COLORS.fence);
    canvas.fill(x, y + 10, TILE, 2, COLORS.fence);
    canvas.fill(x + 6, y, 2, TILE, COLORS.fence);
  });

  tile(0, 2, (x, y) => {
    speckle(x, y, TILE, COLORS.grass, [COLORS.grassLight, COLORS.grassDark], 12);
    canvas.fill(x + 4, y + 6, 2, 8, COLORS.herb);
    canvas.fill(x + 9, y + 5, 2, 9, COLORS.herb);
    canvas.fill(x + 2, y + 4, 3, 3, COLORS.herbLight);
    canvas.fill(x + 11, y + 7, 3, 3, COLORS.herbLight);
  });
  tile(1, 2, (x, y) => {
    canvas.fill(x, y, TILE, TILE, COLORS.counterBody);
    canvas.fill(x, y, TILE, 4, COLORS.counterTop);
    canvas.fill(x, y + 4, TILE, 1, COLORS.woodLine);
  });
  tile(2, 2, (x, y) => {
    canvas.fill(x, y, TILE, TILE, COLORS.shelf);
    canvas.fill(x, y + 4, TILE, 1, COLORS.woodLine);
    canvas.fill(x, y + 10, TILE, 1, COLORS.woodLine);
    canvas.fill(x + 2, y + 1, 3, 3, COLORS.flowerA);
    canvas.fill(x + 8, y + 6, 3, 3, COLORS.window);
  });
  tile(3, 2, (x, y) => {
    canvas.fill(x, y, TILE, TILE, COLORS.crate);
    canvas.fill(x, y, TILE, 1, COLORS.crateEdge);
    canvas.fill(x, y + TILE - 1, TILE, 1, COLORS.crateEdge);
    canvas.fill(x, y, 1, TILE, COLORS.crateEdge);
    canvas.fill(x + TILE - 1, y, 1, TILE, COLORS.crateEdge);
    canvas.fill(x + 1, y + 7, TILE - 2, 1, COLORS.crateEdge);
  });
  tile(4, 2, (x, y) => {
    speckle(x, y, TILE, COLORS.grass, [COLORS.grassDark], 10);
    canvas.fill(x + 6, y + 6, 4, 10, COLORS.trunk);
    canvas.fill(x + 5, y + 8, 6, 1, COLORS.trunk);
  });
  tile(5, 2, (x, y) => {
    canvas.fill(x, y, TILE, TILE, COLORS.treeTop);
    for (let i = 0; i < 22; i += 1) {
      canvas.set(x + Math.floor(rng() * TILE), y + Math.floor(rng() * TILE), COLORS.treeTopLight);
    }
    canvas.fill(x + 3, y + 3, 4, 4, COLORS.treeTopLight);
  });
  tile(6, 2, (x, y) => canvas.fill(x, y, TILE, TILE, COLORS.shadow));
  tile(7, 2, (x, y) => speckle(x, y, TILE, COLORS.grass, [COLORS.grassLight, COLORS.grassDark], 18));

  // Bottom row: subtle variants so map authors have spare tiles to recolour.
  for (let col = 0; col < TILESET_COLUMNS; col += 1) {
    tile(col, 3, (x, y) => {
      canvas.fill(x, y, TILE, TILE, COLORS.grassDark);
      for (let i = 0; i < 8; i += 1) {
        canvas.set(x + Math.floor(rng() * TILE), y + Math.floor(rng() * TILE), COLORS.grass);
      }
      canvas.fill(x + col * 2, y + 12, 2, 2, COLORS.flowerA);
    });
  }

  return canvas;
}

// -------------------------------------------------------------- character art

const PALETTES = {
  player: {
    skin: '#e8b88a', hair: '#4a3a2a', shirt: '#4a7fd0', pants: '#2f3f5a',
    shoes: '#2a2a2a', outline: '#1a1a22', accent: '#e0e8f0',
  },
  npc: {
    skin: '#d9a97a', hair: '#7a3a2a', shirt: '#c86a8a', pants: '#6a4a6a',
    shoes: '#3a2a2a', outline: '#1a1a22', accent: '#f0d060',
  },
  shopkeeper: {
    skin: '#e0b48a', hair: '#3a3a4a', shirt: '#d8d8d0', pants: '#4a5a6a',
    shoes: '#2a2a2a', outline: '#1a1a22', accent: '#8ac0d0',
  },
};

function drawCharacter(canvas, originX, originY, palette, direction, frame) {
  const set = (x, y, color) => canvas.set(originX + x, originY + y, color);
  const fill = (x, y, w, h, color) => canvas.fill(originX + x, originY + y, w, h, color);

  // Legs: alternating stride for frames 1 and 3.
  const stride = frame === 1 ? -1 : frame === 3 ? 1 : 0;
  fill(5, 12, 2, 3, palette.pants);
  fill(9, 12, 2, 3, palette.pants);
  fill(5 + stride, 15, 2, 1, palette.shoes);
  fill(9 - stride, 15, 2, 1, palette.shoes);

  // Torso and arms.
  fill(5, 8, 6, 4, palette.shirt);
  fill(3, 8, 2, 3, palette.shirt);
  fill(11, 8, 2, 3, palette.shirt);
  fill(3, 11, 2, 1, palette.skin);
  fill(11, 11, 2, 1, palette.skin);

  // Head.
  fill(5, 2, 6, 6, palette.skin);
  fill(5, 1, 6, 2, palette.hair);
  fill(4, 2, 1, 4, palette.hair);
  fill(11, 2, 1, 4, palette.hair);

  if (direction === 'up') {
    fill(5, 2, 6, 5, palette.hair);
  } else if (direction === 'down') {
    set(6, 5, palette.outline);
    set(9, 5, palette.outline);
    fill(7, 6, 2, 1, '#b06a5a');
  } else {
    const eyeX = direction === 'left' ? 6 : 9;
    set(eyeX, 5, palette.outline);
    const backX = direction === 'left' ? 10 : 5;
    fill(backX, 2, 1, 5, palette.hair);
    fill(7, 6, 2, 1, '#b06a5a');
  }

  if (palette.accent) fill(5, 2, 6, 1, palette.accent);
}

function drawSheet(palette, seed) {
  const rng = mulberry32(seed);
  const canvas = new Canvas(SHEET_COLUMNS * TILE, SHEET_ROWS * TILE);
  const directions = ['down', 'left', 'right', 'up'];
  for (let row = 0; row < SHEET_ROWS; row += 1) {
    for (let col = 0; col < SHEET_COLUMNS; col += 1) {
      drawCharacter(canvas, col * TILE, row * TILE, palette, directions[row], col);
    }
  }
  // Deterministic tiny variation so the sheets are not byte-identical.
  canvas.set(Math.floor(rng() * canvas.width), Math.floor(rng() * canvas.height), palette.accent);
  return canvas;
}

// ------------------------------------------------------------------ TileSet

function buildTileSetText(atlasPath) {
  const lines = [];
  lines.push('[gd_resource type="TileSet" load_steps=3 format=3]', '');
  lines.push(`[ext_resource type="Texture2D" path="${atlasPath}" id="1_tiles"]`, '');
  lines.push('[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_1"]');
  lines.push('texture = ExtResource("1_tiles")');
  lines.push(`texture_region_size = Vector2i(${TILE}, ${TILE})`);
  for (let row = 0; row < TILESET_ROWS; row += 1) {
    for (let col = 0; col < TILESET_COLUMNS; col += 1) {
      lines.push(`${col}:${row}/0 = 0`);
    }
  }
  lines.push('', '[resource]');
  lines.push(`tile_size = Vector2i(${TILE}, ${TILE})`);
  lines.push('sources/0 = SubResource("TileSetAtlasSource_1")');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------- main

function parseArgs(argv) {
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out' && argv[i + 1]) out = resolve(argv[i + 1]);
  }
  return { out };
}

function main() {
  const { out } = parseArgs(process.argv.slice(2));
  const tilesDir = join(out, 'tiles');
  const charactersDir = join(out, 'characters');
  mkdirSync(tilesDir, { recursive: true });
  mkdirSync(charactersDir, { recursive: true });

  const files = [];

  const tilesetPng = drawTileset(mulberry32(20260909)).toPng();
  files.push(['tiles/town_tiles.png', tilesetPng]);

  const sheets = [
    ['characters/player_sheet.png', PALETTES.player, 11],
    ['characters/npc_sheet.png', PALETTES.npc, 22],
    ['characters/shopkeeper_sheet.png', PALETTES.shopkeeper, 33],
  ];
  for (const [name, palette, seed] of sheets) {
    files.push([name, drawSheet(palette, seed).toPng()]);
  }

  const tileSetText = buildTileSetText('res://assets/tiles/town_tiles.png');
  files.push(['tiles/town_tileset.tres', Buffer.from(tileSetText, 'utf8')]);

  const manifest = {
    format: 'craftmine.topdown-assets/1',
    generatedBy: 'desktop/godot/bases/top-down/tools/make-assets.mjs',
    license: 'Original artwork generated by this repository; see ASSET_SOURCES.md',
    tileSize: TILE,
    tileset: { columns: TILESET_COLUMNS, rows: TILESET_ROWS },
    sheet: { columns: SHEET_COLUMNS, rows: SHEET_ROWS, directions: ['down', 'left', 'right', 'up'] },
    files: [],
  };

  for (const [name, buffer] of files) {
    writeFileSync(join(out, name), buffer);
    manifest.files.push({
      path: name,
      bytes: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    });
  }
  writeFileSync(join(out, 'ASSET_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  for (const entry of manifest.files) {
    process.stdout.write(`${entry.sha256.slice(0, 16)}  ${entry.path} (${entry.bytes} bytes)\n`);
  }
  process.stdout.write(`wrote ${manifest.files.length} files to ${out}\n`);
}

main();
