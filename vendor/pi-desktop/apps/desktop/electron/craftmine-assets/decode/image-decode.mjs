/**
 * Craftmine World asset library (AL2) - real image decoding.
 *
 * Pure Node ESM. Dependencies: `node:zlib` and `node:crypto` only. No DOM, no
 * network, no windows and no synthetic input events. Every exported decoder
 * performs genuine pixel work; a failure always throws AssetPreviewError and
 * never falls back to a placeholder image.
 *
 * Supported input:
 *   PNG
 *     - color types 0 (gray), 2 (RGB), 3 (palette), 4 (gray+alpha), 6 (RGBA)
 *     - bit depths 1/2/4/8/16; 16-bit samples are shifted down to 8 bits
 *     - scanline filters 0 (none), 1 (sub), 2 (up), 3 (average), 4 (paeth)
 *     - PLTE palettes and tRNS transparency
 *   JPEG
 *     - baseline DCT sequential (SOF0) and extended sequential (SOF1)
 *     - Huffman entropy decoding, dequantisation, 8x8 IDCT, upsampling
 *     - grayscale (1 component), YCbCr and direct RGB (3 components)
 *     - sampling factors 4:4:4, 4:2:2 and 4:2:0 (any H/V in 1..4)
 *     - DRI restart intervals with RST0..RST7 markers
 *     - APPn / COM segments are skipped
 *
 * Explicitly NOT supported (descriptive errors are thrown, never a fake image):
 *   - PNG Adam7 interlacing          -> AssetPreviewError('UNSUPPORTED_PNG_VARIANT')
 *   - progressive JPEG (SOF2)        -> AssetPreviewError('UNSUPPORTED_JPEG_VARIANT')
 *   - lossless / arithmetic / 12-bit JPEG, 2- or 4-component JPEG
 *                                    -> AssetPreviewError('UNSUPPORTED_JPEG_VARIANT')
 *
 * Error codes: CORRUPT_IMAGE, UNSUPPORTED_FORMAT, UNSUPPORTED_PNG_VARIANT,
 * UNSUPPORTED_JPEG_VARIANT, IMAGE_TOO_LARGE, PREVIEW_TIMEOUT, INVALID_OPTION.
 */

import zlib from 'node:zlib';
import { createHash } from 'node:crypto';

/** Error thrown for every recoverable image problem. */
export class AssetPreviewError extends Error {
  /**
   * @param {string} code stable machine readable error code
   * @param {string} message human readable description
   */
  constructor(code, message) {
    super(message);
    this.name = 'AssetPreviewError';
    this.code = String(code);
  }
}

/** Hard limits applied before any pixel work starts. */
export const IMAGE_LIMITS = Object.freeze({
  bytes: 16 * 1024 * 1024,
  side: 8192,
  pixels: 33554432,
  decodeMs: 20000,
});

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function fail(code, message) {
  throw new AssetPreviewError(code, message);
}

function asBytes(input, label) {
  const name = label || 'bytes';
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  fail('INVALID_OPTION', `${name} must be a Uint8Array, Buffer or ArrayBuffer`);
  return null; // unreachable
}

function readU16(bytes, offset) {
  return ((bytes[offset] << 8) | bytes[offset + 1]) & 0xffff;
}

function readU32(bytes, offset) {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes, start, end) {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function assertByteLimit(bytes) {
  if (bytes.length > IMAGE_LIMITS.bytes) {
    fail(
      'IMAGE_TOO_LARGE',
      `image is ${bytes.length} bytes, limit is ${IMAGE_LIMITS.bytes}`,
    );
  }
}

function assertDimensionLimits(width, height, label) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    fail('CORRUPT_IMAGE', `${label} has invalid dimensions ${width}x${height}`);
  }
  if (width > IMAGE_LIMITS.side || height > IMAGE_LIMITS.side) {
    fail(
      'IMAGE_TOO_LARGE',
      `${label} is ${width}x${height}, side limit is ${IMAGE_LIMITS.side}`,
    );
  }
  if (width * height > IMAGE_LIMITS.pixels) {
    fail(
      'IMAGE_TOO_LARGE',
      `${label} is ${width * height} pixels, limit is ${IMAGE_LIMITS.pixels}`,
    );
  }
}

/**
 * Cooperative deadline guard. `tick()` is called from every decode loop; it
 * checks Date.now() on the first call and then every 32 calls so the overhead
 * stays negligible even for 33M pixel images.
 */
function createDeadlineGuard(deadline) {
  let ticks = 0;
  return function tick() {
    ticks += 1;
    if (ticks === 1 || (ticks & 31) === 0) {
      if (deadline !== null && Date.now() > deadline) {
        fail('PREVIEW_TIMEOUT', 'image decode exceeded the supplied deadline');
      }
    }
  };
}

function detectFormat(bytes) {
  if (bytes.length >= 8) {
    let png = true;
    for (let i = 0; i < 8; i += 1) {
      if (bytes[i] !== PNG_SIGNATURE[i]) {
        png = false;
        break;
      }
    }
    if (png) return 'png';
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  return null;
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const PNG_CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const PNG_ALLOWED_BIT_DEPTHS = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};
const PNG_CRITICAL_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

/**
 * Walk the PNG chunk list, validating lengths and CRCs.
 * Never inflates IDAT and never touches pixel data.
 *
 * @param {Uint8Array} bytes
 * @param {boolean} collectIdat keep the IDAT slices for decoding
 * @param {'probe'|'decode'} mode decode rejects unsupported variants, probe reports them
 */
function parsePngStructure(bytes, collectIdat, mode) {
  if (bytes.length < 8) {
    fail('CORRUPT_IMAGE', 'PNG is shorter than the 8 byte signature');
  }
  for (let i = 0; i < 8; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      fail('CORRUPT_IMAGE', 'PNG signature mismatch');
    }
  }

  let offset = 8;
  let ihdr = null;
  let plte = null;
  let trns = null;
  let sawIend = false;
  const idat = [];

  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset);
    if (length > 0x7fffffff) {
      fail('CORRUPT_IMAGE', 'PNG chunk length out of range');
    }
    const typeStart = offset + 4;
    const type = String.fromCharCode(
      bytes[typeStart],
      bytes[typeStart + 1],
      bytes[typeStart + 2],
      bytes[typeStart + 3],
    );
    if (!/^[A-Za-z]{4}$/.test(type)) {
      fail('CORRUPT_IMAGE', 'PNG chunk type is not four ASCII letters');
    }
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      fail('CORRUPT_IMAGE', `PNG chunk ${type} is truncated`);
    }
    const expectedCrc = readU32(bytes, dataEnd);
    const actualCrc = crc32(bytes, typeStart, dataEnd);
    if (actualCrc !== expectedCrc) {
      fail('CORRUPT_IMAGE', `PNG chunk ${type} CRC mismatch`);
    }

    if (type === 'IHDR') {
      if (ihdr !== null) fail('CORRUPT_IMAGE', 'PNG has more than one IHDR chunk');
      if (offset !== 8) fail('CORRUPT_IMAGE', 'PNG IHDR must be the first chunk');
      if (length !== 13) fail('CORRUPT_IMAGE', 'PNG IHDR must be 13 bytes');
      const width = readU32(bytes, dataStart);
      const height = readU32(bytes, dataStart + 4);
      const bitDepth = bytes[dataStart + 8];
      const colorType = bytes[dataStart + 9];
      const compression = bytes[dataStart + 10];
      const filterMethod = bytes[dataStart + 11];
      const interlace = bytes[dataStart + 12];
      assertDimensionLimits(width, height, 'PNG');
      const allowed = PNG_ALLOWED_BIT_DEPTHS[colorType];
      if (allowed === undefined) {
        fail(
          'UNSUPPORTED_PNG_VARIANT',
          `PNG color type ${colorType} is not supported (supported: 0/2/3/4/6)`,
        );
      }
      if (!allowed.includes(bitDepth)) {
        fail(
          'UNSUPPORTED_PNG_VARIANT',
          `PNG bit depth ${bitDepth} is not valid/supported for color type ${colorType}`,
        );
      }
      if (compression !== 0) {
        fail(
          'UNSUPPORTED_PNG_VARIANT',
          `PNG compression method ${compression} is not supported`,
        );
      }
      if (filterMethod !== 0) {
        fail(
          'UNSUPPORTED_PNG_VARIANT',
          `PNG filter method ${filterMethod} is not supported`,
        );
      }
      if (interlace === 1 && mode === 'decode') {
        // Adam7 interlace requires seven sub-image passes; deliberately not
        // implemented, callers get a precise error instead of a fake image.
        fail(
          'UNSUPPORTED_PNG_VARIANT',
          'PNG Adam7 interlacing is not supported',
        );
      }
      if (interlace !== 0 && interlace !== 1) {
        fail('CORRUPT_IMAGE', `PNG interlace method ${interlace} is invalid`);
      }
      ihdr = { width, height, bitDepth, colorType, interlace };
    } else if (type === 'PLTE') {
      if (length === 0 || length % 3 !== 0 || length > 768) {
        fail('CORRUPT_IMAGE', 'PNG PLTE chunk has an invalid length');
      }
      plte = bytes.subarray(dataStart, dataEnd);
    } else if (type === 'tRNS') {
      trns = bytes.subarray(dataStart, dataEnd);
    } else if (type === 'IDAT') {
      if (ihdr === null) fail('CORRUPT_IMAGE', 'PNG IDAT appears before IHDR');
      if (collectIdat) idat.push(bytes.subarray(dataStart, dataEnd));
    } else if (type.charCodeAt(0) < 97 && !PNG_CRITICAL_CHUNKS.has(type)) {
      fail(
        'UNSUPPORTED_PNG_VARIANT',
        `PNG critical chunk ${type} is not supported`,
      );
    }

    offset = dataEnd + 4;
    if (type === 'IEND') {
      sawIend = true;
      break;
    }
  }

  if (ihdr === null) fail('CORRUPT_IMAGE', 'PNG is missing the IHDR chunk');
  if (!sawIend) fail('CORRUPT_IMAGE', 'PNG is missing the IEND chunk');
  if (collectIdat && idat.length === 0) fail('CORRUPT_IMAGE', 'PNG is missing IDAT data');
  if (ihdr.colorType === 3 && plte === null) {
    fail('CORRUPT_IMAGE', 'PNG color type 3 requires a PLTE chunk');
  }

  return {
    ...ihdr,
    plte,
    trns,
    idat,
  };
}

function pngSampleAt(row, rowStart, index, bitDepth) {
  const bitPos = index * bitDepth;
  const byte = row[rowStart + (bitPos >> 3)];
  const shift = 8 - bitDepth - (bitPos & 7);
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Inflate, unfilter and colour-convert a PNG into 8-bit RGBA. */
function pngToRgba(struct, guard) {
  const { width, height, bitDepth, colorType, plte, trns, idat } = struct;
  const channels = PNG_CHANNELS[colorType];
  const bitsPerPixel = channels * bitDepth;
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const bytesPerRow = Math.ceil((width * bitsPerPixel) / 8);
  const rawRowBytes = bytesPerRow + 1;

  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch (err) {
    fail('CORRUPT_IMAGE', `PNG zlib inflate failed: ${err.message}`);
  }
  if (raw.length < rawRowBytes * height) {
    fail(
      'CORRUPT_IMAGE',
      `PNG image data is truncated (${raw.length} < ${rawRowBytes * height} bytes)`,
    );
  }

  const image = Buffer.allocUnsafe(bytesPerRow * height);
  for (let y = 0; y < height; y += 1) {
    const filterType = raw[y * rawRowBytes];
    const srcStart = y * rawRowBytes + 1;
    const dstStart = y * bytesPerRow;
    const prevStart = dstStart - bytesPerRow;
    switch (filterType) {
      case 0:
        for (let i = 0; i < bytesPerRow; i += 1) image[dstStart + i] = raw[srcStart + i];
        break;
      case 1:
        for (let i = 0; i < bytesPerRow; i += 1) {
          const left = i >= bpp ? image[dstStart + i - bpp] : 0;
          image[dstStart + i] = (raw[srcStart + i] + left) & 0xff;
        }
        break;
      case 2:
        for (let i = 0; i < bytesPerRow; i += 1) {
          const up = y > 0 ? image[prevStart + i] : 0;
          image[dstStart + i] = (raw[srcStart + i] + up) & 0xff;
        }
        break;
      case 3:
        for (let i = 0; i < bytesPerRow; i += 1) {
          const left = i >= bpp ? image[dstStart + i - bpp] : 0;
          const up = y > 0 ? image[prevStart + i] : 0;
          image[dstStart + i] = (raw[srcStart + i] + ((left + up) >> 1)) & 0xff;
        }
        break;
      case 4:
        for (let i = 0; i < bytesPerRow; i += 1) {
          const left = i >= bpp ? image[dstStart + i - bpp] : 0;
          const up = y > 0 ? image[prevStart + i] : 0;
          const upLeft = y > 0 && i >= bpp ? image[prevStart + i - bpp] : 0;
          image[dstStart + i] =
            (raw[srcStart + i] + paethPredictor(left, up, upLeft)) & 0xff;
        }
        break;
      default:
        fail('CORRUPT_IMAGE', `PNG scanline filter ${filterType} is invalid`);
    }
    guard();
  }

  const rgba = new Uint8Array(width * height * 4);
  const maxSample = (1 << bitDepth) - 1;
  const hasTrns = trns !== null && trns.length > 0;
  const trnsGray = hasTrns && trns.length >= 2 ? readU16(trns, 0) : -1;
  const trnsRed = hasTrns && trns.length >= 6 ? readU16(trns, 0) : -1;
  const trnsGreen = hasTrns && trns.length >= 6 ? readU16(trns, 2) : -1;
  const trnsBlue = hasTrns && trns.length >= 6 ? readU16(trns, 4) : -1;

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * bytesPerRow;
    const outRow = y * width * 4;
    if (colorType === 6) {
      const step = bitDepth === 16 ? 8 : 4;
      for (let x = 0; x < width; x += 1) {
        const src = rowStart + x * step;
        const dst = outRow + x * 4;
        rgba[dst] = image[src];
        rgba[dst + 1] = image[src + (bitDepth === 16 ? 2 : 1)];
        rgba[dst + 2] = image[src + (bitDepth === 16 ? 4 : 2)];
        rgba[dst + 3] = image[src + (bitDepth === 16 ? 6 : 3)];
      }
    } else if (colorType === 2) {
      const step = bitDepth === 16 ? 6 : 3;
      for (let x = 0; x < width; x += 1) {
        const src = rowStart + x * step;
        const dst = outRow + x * 4;
        const r = image[src];
        const g = image[src + (bitDepth === 16 ? 2 : 1)];
        const b = image[src + (bitDepth === 16 ? 4 : 2)];
        rgba[dst] = r;
        rgba[dst + 1] = g;
        rgba[dst + 2] = b;
        if (trnsRed >= 0 && bitDepth === 16) {
          rgba[dst + 3] =
            readU16(image, src) === trnsRed &&
            readU16(image, src + 2) === trnsGreen &&
            readU16(image, src + 4) === trnsBlue
              ? 0
              : 255;
        } else {
          rgba[dst + 3] = r === trnsRed && g === trnsGreen && b === trnsBlue ? 0 : 255;
        }
      }
    } else if (colorType === 0) {
      for (let x = 0; x < width; x += 1) {
        const dst = outRow + x * 4;
        let sample;
        let gray;
        if (bitDepth === 16) {
          const src = rowStart + x * 2;
          sample = readU16(image, src);
          gray = image[src];
        } else if (bitDepth === 8) {
          sample = image[rowStart + x];
          gray = sample;
        } else {
          sample = pngSampleAt(image, rowStart, x, bitDepth);
          gray = Math.round((sample * 255) / maxSample);
        }
        rgba[dst] = gray;
        rgba[dst + 1] = gray;
        rgba[dst + 2] = gray;
        rgba[dst + 3] = sample === trnsGray ? 0 : 255;
      }
    } else if (colorType === 4) {
      const step = bitDepth === 16 ? 4 : 2;
      for (let x = 0; x < width; x += 1) {
        const src = rowStart + x * step;
        const dst = outRow + x * 4;
        const gray = image[src];
        rgba[dst] = gray;
        rgba[dst + 1] = gray;
        rgba[dst + 2] = gray;
        rgba[dst + 3] = image[src + (bitDepth === 16 ? 2 : 1)];
      }
    } else {
      // colorType 3: palette index, bit depths 1/2/4/8.
      for (let x = 0; x < width; x += 1) {
        const dst = outRow + x * 4;
        const index =
          bitDepth === 8
            ? image[rowStart + x]
            : pngSampleAt(image, rowStart, x, bitDepth);
        const p = index * 3;
        if (p + 2 >= plte.length) {
          fail('CORRUPT_IMAGE', `PNG palette index ${index} is out of range`);
        }
        rgba[dst] = plte[p];
        rgba[dst + 1] = plte[p + 1];
        rgba[dst + 2] = plte[p + 2];
        rgba[dst + 3] = trns !== null && index < trns.length ? trns[index] : 255;
      }
    }
    guard();
  }

  return rgba;
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

// Zig-zag scan order -> natural (row-major, row = vertical frequency) index.
const ZIGZAG = Int32Array.of(
  0, 1, 8, 16, 9, 2, 3, 10,
  17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63,
);

// IDCT_C[u * 8 + x] = cos((2x + 1) * u * PI / 16) * (u === 0 ? 1/sqrt(2) : 1)
const IDCT_C = (() => {
  const table = new Float64Array(64);
  for (let u = 0; u < 8; u += 1) {
    for (let x = 0; x < 8; x += 1) {
      table[u * 8 + x] =
        Math.cos(((2 * x + 1) * u * Math.PI) / 16) * (u === 0 ? Math.SQRT1_2 : 1);
    }
  }
  return table;
})();

const IDCT_TMP = new Float64Array(64);
const IDCT_OUT = new Uint8Array(64);
const BLOCK = new Float32Array(64);

function buildHuffmanTable(counts, values) {
  const minCode = new Int32Array(17);
  const maxCode = new Int32Array(17);
  const valPtr = new Int32Array(17);
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len += 1) {
    valPtr[len] = k;
    minCode[len] = code;
    code += counts[len];
    k += counts[len];
    maxCode[len] = counts[len] > 0 ? code - 1 : -1;
    code <<= 1;
  }
  if (k === 0 || k > 256) {
    fail('CORRUPT_IMAGE', `JPEG Huffman table has an invalid value count (${k})`);
  }
  return { minCode, maxCode, valPtr, values, count: k };
}

class BitReader {
  constructor(data) {
    this.data = data;
    this.bytePos = 0;
    this.bitPos = 0;
  }

  seek(byteOffset) {
    this.bytePos = byteOffset;
    this.bitPos = 0;
  }

  readBit() {
    if (this.bytePos >= this.data.length) {
      fail('CORRUPT_IMAGE', 'JPEG entropy-coded data is truncated');
    }
    const bit = (this.data[this.bytePos] >> (7 - this.bitPos)) & 1;
    this.bitPos += 1;
    if (this.bitPos === 8) {
      this.bitPos = 0;
      this.bytePos += 1;
    }
    return bit;
  }

  /** Read `n` bits and sign-extend them (JPEG "receive/extend"). */
  receiveExtend(n) {
    if (n === 0) return 0;
    let value = 0;
    for (let i = 0; i < n; i += 1) value = (value << 1) | this.readBit();
    if (value < 1 << (n - 1)) value -= (1 << n) - 1;
    return value;
  }
}

function decodeHuffmanSymbol(reader, table) {
  let code = reader.readBit();
  for (let len = 1; len <= 16; len += 1) {
    if (code <= table.maxCode[len]) {
      const index = table.valPtr[len] + code - table.minCode[len];
      if (index < 0 || index >= table.count) {
        fail('CORRUPT_IMAGE', 'JPEG Huffman code points outside its value table');
      }
      return table.values[index];
    }
    code = (code << 1) | reader.readBit();
  }
  fail('CORRUPT_IMAGE', 'JPEG contains an invalid Huffman code');
  return 0; // unreachable
}

/**
 * Inverse DCT of one dequantised 8x8 block into IDCT_OUT (level shifted by 128).
 * Coefficients live in BLOCK in natural order.
 */
function idctBlock() {
  let allZeroAc = true;
  for (let i = 1; i < 64; i += 1) {
    if (BLOCK[i] !== 0) {
      allZeroAc = false;
      break;
    }
  }
  if (allZeroAc) {
    const value = Math.round(BLOCK[0] * 0.125) + 128;
    const clamped = value < 0 ? 0 : value > 255 ? 255 : value;
    IDCT_OUT.fill(clamped);
    return;
  }
  for (let v = 0; v < 8; v += 1) {
    const rowBase = v * 8;
    for (let x = 0; x < 8; x += 1) {
      let sum = 0;
      for (let u = 0; u < 8; u += 1) sum += BLOCK[rowBase + u] * IDCT_C[u * 8 + x];
      IDCT_TMP[rowBase + x] = sum;
    }
  }
  for (let y = 0; y < 8; y += 1) {
    const outBase = y * 8;
    for (let x = 0; x < 8; x += 1) {
      let sum = 0;
      for (let v = 0; v < 8; v += 1) sum += IDCT_C[v * 8 + y] * IDCT_TMP[v * 8 + x];
      const value = Math.round(sum * 0.25) + 128;
      IDCT_OUT[outBase + x] = value < 0 ? 0 : value > 255 ? 255 : value;
    }
  }
}

function parseJpegStructure(bytes, mode) {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    fail('CORRUPT_IMAGE', 'JPEG is missing the SOI marker');
  }

  const frame = {
    width: 0,
    height: 0,
    precision: 0,
    frameType: 0,
    progressive: false,
    components: null,
    maxH: 1,
    maxV: 1,
    quantTables: new Map(),
    huffTables: new Map(),
    restartInterval: 0,
    adobeTransform: null,
    scans: [],
  };

  let pos = 2;
  while (pos + 1 < bytes.length) {
    if (bytes[pos] !== 0xff) {
      fail('CORRUPT_IMAGE', `JPEG expected a marker at offset ${pos}`);
    }
    let marker = bytes[pos + 1];
    let p = pos + 2;
    while (marker === 0xff) {
      if (p >= bytes.length) fail('CORRUPT_IMAGE', 'JPEG truncated inside marker fill');
      marker = bytes[p];
      p += 1;
    }
    pos = p;

    if (marker === 0xd9) break; // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // standalone
    if (pos + 2 > bytes.length) fail('CORRUPT_IMAGE', 'JPEG truncated at segment length');
    const length = readU16(bytes, pos);
    if (length < 2 || pos + length > bytes.length) {
      fail('CORRUPT_IMAGE', `JPEG segment 0x${marker.toString(16)} has an invalid length`);
    }
    const segStart = pos + 2;
    const segEnd = pos + length;

    if (
      (marker >= 0xc0 && marker <= 0xcf) &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      // SOFn frame header.
      if (segEnd - segStart < 6) fail('CORRUPT_IMAGE', 'JPEG SOF segment is too short');
      const precision = bytes[segStart];
      const height = readU16(bytes, segStart + 1);
      const width = readU16(bytes, segStart + 3);
      const componentCount = bytes[segStart + 5];
      if (componentCount < 1 || componentCount > 4) {
        fail('CORRUPT_IMAGE', `JPEG SOF declares ${componentCount} components`);
      }
      if (segEnd - segStart < 6 + componentCount * 3) {
        fail('CORRUPT_IMAGE', 'JPEG SOF component list is truncated');
      }
      assertDimensionLimits(width, height, 'JPEG');
      const components = [];
      let maxH = 1;
      let maxV = 1;
      for (let i = 0; i < componentCount; i += 1) {
        const base = segStart + 6 + i * 3;
        const id = bytes[base];
        const h = bytes[base + 1] >> 4;
        const v = bytes[base + 1] & 0x0f;
        const tq = bytes[base + 2];
        if (h < 1 || h > 4 || v < 1 || v > 4) {
          fail('CORRUPT_IMAGE', `JPEG component ${id} has invalid sampling ${h}x${v}`);
        }
        if (tq > 3) fail('CORRUPT_IMAGE', `JPEG component ${id} has invalid quant table ${tq}`);
        components.push({ id, h, v, tq });
        if (h > maxH) maxH = h;
        if (v > maxV) maxV = v;
      }
      frame.precision = precision;
      frame.frameType = marker;
      frame.width = width;
      frame.height = height;
      frame.components = components;
      frame.maxH = maxH;
      frame.maxV = maxV;
      frame.progressive = marker === 0xc2;

      if (mode === 'probe' && marker === 0xc2) return frame;
      if (mode === 'decode') {
        if (marker === 0xc2) {
          fail(
            'UNSUPPORTED_JPEG_VARIANT',
            'progressive JPEG (SOF2) is not supported',
          );
        }
        if (marker !== 0xc0 && marker !== 0xc1) {
          fail(
            'UNSUPPORTED_JPEG_VARIANT',
            `JPEG frame type 0x${marker.toString(16)} is not supported (only SOF0/SOF1)`,
          );
        }
        if (precision !== 8) {
          fail(
            'UNSUPPORTED_JPEG_VARIANT',
            `JPEG sample precision ${precision} is not supported (only 8-bit)`,
          );
        }
      }
    } else if (marker === 0xc4) {
      let p2 = segStart;
      while (p2 < segEnd) {
        const tc = bytes[p2] >> 4;
        const th = bytes[p2] & 0x0f;
        p2 += 1;
        if (tc > 1 || th > 3) fail('CORRUPT_IMAGE', 'JPEG DHT table selector is invalid');
        if (p2 + 16 > segEnd) fail('CORRUPT_IMAGE', 'JPEG DHT segment is truncated');
        const counts = new Uint8Array(17);
        let total = 0;
        for (let i = 1; i <= 16; i += 1) {
          counts[i] = bytes[p2 + i - 1];
          total += counts[i];
        }
        p2 += 16;
        if (p2 + total > segEnd) fail('CORRUPT_IMAGE', 'JPEG DHT value list is truncated');
        frame.huffTables.set(
          tc * 4 + th,
          buildHuffmanTable(counts, bytes.subarray(p2, p2 + total)),
        );
        p2 += total;
      }
    } else if (marker === 0xdb) {
      let p2 = segStart;
      while (p2 < segEnd) {
        const pq = bytes[p2] >> 4;
        const tq = bytes[p2] & 0x0f;
        p2 += 1;
        if (tq > 3) fail('CORRUPT_IMAGE', 'JPEG DQT table selector is invalid');
        const table = new Int32Array(64);
        if (pq === 0) {
          if (p2 + 64 > segEnd) fail('CORRUPT_IMAGE', 'JPEG DQT segment is truncated');
          for (let i = 0; i < 64; i += 1) table[ZIGZAG[i]] = bytes[p2 + i];
          p2 += 64;
        } else if (pq === 1) {
          if (p2 + 128 > segEnd) fail('CORRUPT_IMAGE', 'JPEG DQT segment is truncated');
          for (let i = 0; i < 64; i += 1) {
            table[ZIGZAG[i]] = readU16(bytes, p2 + i * 2);
          }
          p2 += 128;
        } else {
          fail('CORRUPT_IMAGE', `JPEG DQT precision ${pq} is invalid`);
        }
        frame.quantTables.set(tq, table);
      }
    } else if (marker === 0xdd) {
      if (segEnd - segStart < 2) fail('CORRUPT_IMAGE', 'JPEG DRI segment is too short');
      frame.restartInterval = readU16(bytes, segStart);
    } else if (marker === 0xda) {
      if (frame.components === null) fail('CORRUPT_IMAGE', 'JPEG SOS appears before SOF');
      if (segEnd - segStart < 4) fail('CORRUPT_IMAGE', 'JPEG SOS segment is too short');
      const ns = bytes[segStart];
      if (ns < 1 || ns > 4) fail('CORRUPT_IMAGE', `JPEG SOS declares ${ns} components`);
      if (segEnd - segStart < 1 + ns * 2 + 3) {
        fail('CORRUPT_IMAGE', 'JPEG SOS component list is truncated');
      }
      const scanComponents = [];
      for (let i = 0; i < ns; i += 1) {
        const base = segStart + 1 + i * 2;
        scanComponents.push({
          id: bytes[base],
          dc: bytes[base + 1] >> 4,
          ac: bytes[base + 1] & 0x0f,
        });
      }
      const spectralStart = bytes[segStart + 1 + ns * 2];
      const spectralEnd = bytes[segStart + 2 + ns * 2];
      const ah = bytes[segStart + 3 + ns * 2] >> 4;
      const al = bytes[segStart + 3 + ns * 2] & 0x0f;
      if (ah !== 0 || al !== 0 || spectralStart !== 0 || spectralEnd !== 63) {
        fail(
          'UNSUPPORTED_JPEG_VARIANT',
          'JPEG progressive/refinement scan parameters are not supported',
        );
      }
      if (mode === 'probe') return frame;

      const entropyStart = segEnd;
      const extracted = extractEntropy(bytes, entropyStart);
      frame.scans.push({
        components: scanComponents,
        entropy: extracted.data,
        restarts: extracted.restarts,
      });
      pos = extracted.end;
      continue;
    } else if (marker === 0xee) {
      if (
        segEnd - segStart >= 12 &&
        bytes[segStart] === 0x41 &&
        bytes[segStart + 1] === 0x64 &&
        bytes[segStart + 2] === 0x6f &&
        bytes[segStart + 3] === 0x62 &&
        bytes[segStart + 4] === 0x65
      ) {
        frame.adobeTransform = bytes[segStart + 11];
      }
    } else if (marker === 0xcc) {
      fail('UNSUPPORTED_JPEG_VARIANT', 'JPEG arithmetic coding (DAC) is not supported');
    }
    // APPn (0xe0-0xef), COM (0xfe) and unknown length-prefixed segments are skipped.

    pos = segEnd;
  }

  if (frame.components === null) {
    fail('CORRUPT_IMAGE', 'JPEG is missing an SOF frame header');
  }
  if (mode === 'decode' && frame.scans.length === 0) {
    fail('CORRUPT_IMAGE', 'JPEG is missing an SOS scan header');
  }
  return frame;
}

/**
 * Copy entropy-coded bytes out of the file, removing 0xFF00 stuffing and
 * recording the byte offset of every RSTn restart marker.
 */
function extractEntropy(bytes, start) {
  const data = new Uint8Array(bytes.length - start);
  const restarts = [];
  let n = 0;
  let i = start;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0xff) {
      if (i + 1 >= bytes.length) {
        i = bytes.length;
        break;
      }
      const next = bytes[i + 1];
      if (next === 0x00) {
        data[n] = 0xff;
        n += 1;
        i += 2;
        continue;
      }
      if (next >= 0xd0 && next <= 0xd7) {
        restarts.push(n);
        i += 2;
        continue;
      }
      break; // a real marker terminates the scan
    }
    data[n] = b;
    n += 1;
    i += 1;
  }
  return { data: data.subarray(0, n), restarts, end: i };
}

function decodeJpegBlock(reader, quant, dcTable, acTable, predictor) {
  BLOCK.fill(0);
  const dcBits = decodeHuffmanSymbol(reader, dcTable);
  if (dcBits > 15) fail('CORRUPT_IMAGE', 'JPEG DC magnitude category is invalid');
  const dc = predictor + reader.receiveExtend(dcBits);
  BLOCK[0] = dc * quant[0];
  let k = 1;
  while (k < 64) {
    const symbol = decodeHuffmanSymbol(reader, acTable);
    const size = symbol & 0x0f;
    const run = symbol >> 4;
    if (size === 0) {
      if (run === 15) {
        k += 16;
        continue;
      }
      break; // EOB
    }
    k += run;
    if (k > 63) fail('CORRUPT_IMAGE', 'JPEG AC coefficient index out of range');
    const index = ZIGZAG[k];
    BLOCK[index] = reader.receiveExtend(size) * quant[index];
    k += 1;
  }
  idctBlock();
  return dc;
}

function storeBlock(component, blockX, blockY) {
  const px = blockX * 8;
  const py = blockY * 8;
  const { plane, planeWidth, planeHeight } = component;
  if (px >= planeWidth || py >= planeHeight) return;
  const maxX = Math.min(8, planeWidth - px);
  const maxY = Math.min(8, planeHeight - py);
  for (let y = 0; y < maxY; y += 1) {
    const dst = (py + y) * planeWidth + px;
    const src = y * 8;
    for (let x = 0; x < maxX; x += 1) plane[dst + x] = IDCT_OUT[src + x];
  }
}

function prepareComponentGeometry(frame) {
  const { width, height, maxH, maxV } = frame;
  for (const comp of frame.components) {
    comp.sampleWidth = Math.ceil((width * comp.h) / maxH);
    comp.sampleHeight = Math.ceil((height * comp.v) / maxV);
    comp.blocksPerLine = Math.ceil(comp.sampleWidth / 8);
    comp.blocksPerColumn = Math.ceil(comp.sampleHeight / 8);
    comp.planeWidth = comp.blocksPerLine * 8;
    comp.planeHeight = comp.blocksPerColumn * 8;
    comp.plane = new Uint8Array(comp.planeWidth * comp.planeHeight);
  }
}

function decodeJpegScan(scan, frame, guard) {
  const interleaved = scan.components.length > 1;
  const comps = scan.components.map((sc) => {
    const comp = frame.components.find((c) => c.id === sc.id);
    if (comp === undefined) {
      fail('CORRUPT_IMAGE', `JPEG scan references unknown component id ${sc.id}`);
    }
    const quant = frame.quantTables.get(comp.tq);
    if (quant === undefined) {
      fail('CORRUPT_IMAGE', `JPEG component ${comp.id} has no quantisation table`);
    }
    const dcTable = frame.huffTables.get(sc.dc);
    const acTable = frame.huffTables.get(4 + sc.ac);
    if (dcTable === undefined || acTable === undefined) {
      fail('CORRUPT_IMAGE', 'JPEG scan references a missing Huffman table');
    }
    return { comp, quant, dcTable, acTable, predictor: 0 };
  });

  let mcusPerLine;
  let mcusPerColumn;
  if (interleaved) {
    mcusPerLine = Math.ceil(frame.width / (8 * frame.maxH));
    mcusPerColumn = Math.ceil(frame.height / (8 * frame.maxV));
  } else {
    const comp = comps[0].comp;
    mcusPerLine = comp.blocksPerLine;
    mcusPerColumn = comp.blocksPerColumn;
  }

  const segmentStarts = [0, ...scan.restarts];
  const reader = new BitReader(scan.entropy);
  let segmentIndex = 0;
  let mcuIndex = 0;
  const restartInterval = frame.restartInterval;

  for (let mcuY = 0; mcuY < mcusPerColumn; mcuY += 1) {
    for (let mcuX = 0; mcuX < mcusPerLine; mcuX += 1) {
      if (restartInterval > 0 && mcuIndex > 0 && mcuIndex % restartInterval === 0) {
        segmentIndex += 1;
        if (segmentIndex >= segmentStarts.length) {
          fail('CORRUPT_IMAGE', 'JPEG restart marker is missing from the entropy data');
        }
        reader.seek(segmentStarts[segmentIndex]);
        for (const c of comps) c.predictor = 0;
      }
      for (const c of comps) {
        const blocksH = interleaved ? c.comp.h : 1;
        const blocksV = interleaved ? c.comp.v : 1;
        for (let by = 0; by < blocksV; by += 1) {
          for (let bx = 0; bx < blocksH; bx += 1) {
            c.predictor = decodeJpegBlock(
              reader,
              c.quant,
              c.dcTable,
              c.acTable,
              c.predictor,
            );
            storeBlock(
              c.comp,
              mcuX * blocksH + bx,
              mcuY * blocksV + by,
            );
          }
        }
      }
      mcuIndex += 1;
      guard();
    }
  }
}

/** Convert decoded component planes into 8-bit RGBA. */
function jpegToRgba(frame, guard) {
  const { width, height, components, maxH, maxV } = frame;
  const rgba = new Uint8Array(width * height * 4);
  const count = components.length;
  const isRgb =
    count === 3 &&
    ((components[0].id === 0x52 &&
      components[1].id === 0x47 &&
      components[2].id === 0x42) ||
      // Adobe APP14 transform 0 declares an untransformed RGB JPEG.
      frame.adobeTransform === 0);

  const xOffsets = [];
  const yOffsets = [];
  for (const comp of components) {
    const xs = new Int32Array(width);
    for (let x = 0; x < width; x += 1) {
      xs[x] = Math.min(comp.planeWidth - 1, Math.floor((x * comp.h) / maxH));
    }
    const ys = new Int32Array(height);
    for (let y = 0; y < height; y += 1) {
      ys[y] = Math.min(comp.planeHeight - 1, Math.floor((y * comp.v) / maxV));
    }
    xOffsets.push(xs);
    yOffsets.push(ys);
  }

  for (let y = 0; y < height; y += 1) {
    const rowBase = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const dst = rowBase + x * 4;
      if (count === 1) {
        const comp = components[0];
        const sample = comp.plane[yOffsets[0][y] * comp.planeWidth + xOffsets[0][x]];
        rgba[dst] = sample;
        rgba[dst + 1] = sample;
        rgba[dst + 2] = sample;
        rgba[dst + 3] = 255;
      } else {
        const c0 = components[0];
        const c1 = components[1];
        const c2 = components[2];
        const s0 = c0.plane[yOffsets[0][y] * c0.planeWidth + xOffsets[0][x]];
        const s1 = c1.plane[yOffsets[1][y] * c1.planeWidth + xOffsets[1][x]];
        const s2 = c2.plane[yOffsets[2][y] * c2.planeWidth + xOffsets[2][x]];
        if (isRgb) {
          rgba[dst] = s0;
          rgba[dst + 1] = s1;
          rgba[dst + 2] = s2;
          rgba[dst + 3] = 255;
        } else {
          const cb = s1 - 128;
          const cr = s2 - 128;
          const r = s0 + ((91881 * cr) >> 16);
          const g = s0 - ((22554 * cb + 46802 * cr) >> 16);
          const b = s0 + ((116130 * cb) >> 16);
          rgba[dst] = r < 0 ? 0 : r > 255 ? 255 : r;
          rgba[dst + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
          rgba[dst + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
          rgba[dst + 3] = 255;
        }
      }
    }
    guard();
  }
  return rgba;
}

function decodeJpegFrame(frame, guard) {
  if (frame.components.length !== 1 && frame.components.length !== 3) {
    fail(
      'UNSUPPORTED_JPEG_VARIANT',
      `JPEG with ${frame.components.length} components (CMYK/YCCK) is not supported`,
    );
  }
  prepareComponentGeometry(frame);
  for (const scan of frame.scans) {
    decodeJpegScan(scan, frame, guard);
  }
  return jpegToRgba(frame, guard);
}

// ---------------------------------------------------------------------------
// PNG encoder
// ---------------------------------------------------------------------------

function pngChunk(type, data) {
  const length = data.length;
  const chunk = new Uint8Array(12 + length);
  chunk[0] = (length >>> 24) & 0xff;
  chunk[1] = (length >>> 16) & 0xff;
  chunk[2] = (length >>> 8) & 0xff;
  chunk[3] = length & 0xff;
  for (let i = 0; i < 4; i += 1) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  const crc = crc32(chunk, 4, 8 + length);
  chunk[8 + length] = (crc >>> 24) & 0xff;
  chunk[9 + length] = (crc >>> 16) & 0xff;
  chunk[10 + length] = (crc >>> 8) & 0xff;
  chunk[11 + length] = crc & 0xff;
  return chunk;
}

/**
 * Encode 8-bit RGBA pixels as a real PNG (color type 6, filter 0 per scanline,
 * zlib deflate from node:zlib).
 */
export function encodePng(rgba, width, height) {
  const pixels = asBytes(rgba, 'rgba');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    fail('INVALID_OPTION', `encodePng dimensions must be positive integers, got ${width}x${height}`);
  }
  if (width > IMAGE_LIMITS.side || height > IMAGE_LIMITS.side) {
    fail('IMAGE_TOO_LARGE', `encodePng is ${width}x${height}, side limit is ${IMAGE_LIMITS.side}`);
  }
  if (pixels.length !== width * height * 4) {
    fail(
      'INVALID_OPTION',
      `encodePng expected ${width * height * 4} RGBA bytes, received ${pixels.length}`,
    );
  }

  const rowBytes = width * 4;
  const raw = Buffer.allocUnsafe(height * (rowBytes + 1));
  for (let y = 0; y < height; y += 1) {
    const dst = y * (rowBytes + 1);
    raw[dst] = 0;
    raw.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), dst + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  const ihdr = new Uint8Array(13);
  ihdr[0] = (width >>> 24) & 0xff;
  ihdr[1] = (width >>> 16) & 0xff;
  ihdr[2] = (width >>> 8) & 0xff;
  ihdr[3] = width & 0xff;
  ihdr[4] = (height >>> 24) & 0xff;
  ihdr[5] = (height >>> 16) & 0xff;
  ihdr[6] = (height >>> 8) & 0xff;
  ihdr[7] = height & 0xff;
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: truecolor + alpha
  ihdr[10] = 0; // compression method: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  const ihdrChunk = pngChunk('IHDR', ihdr);
  const idatChunk = pngChunk('IDAT', idat);
  const iendChunk = pngChunk('IEND', new Uint8Array(0));
  const total = 8 + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const out = new Uint8Array(total);
  out.set(PNG_SIGNATURE, 0);
  out.set(ihdrChunk, 8);
  out.set(idatChunk, 8 + ihdrChunk.length);
  out.set(iendChunk, 8 + ihdrChunk.length + idatChunk.length);
  return out;
}

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------

/**
 * Integer box-filter downscale that preserves the aspect ratio and never
 * upscales. Returns raw RGBA plus its dimensions.
 */
function buildThumbnailRgba(rgba, width, height, maxSide, guard) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const thumbWidth = Math.max(1, Math.round(width * scale));
  const thumbHeight = Math.max(1, Math.round(height * scale));
  if (thumbWidth === width && thumbHeight === height) {
    return { rgba: rgba.slice(), width: thumbWidth, height: thumbHeight };
  }

  const out = new Uint8Array(thumbWidth * thumbHeight * 4);
  for (let ty = 0; ty < thumbHeight; ty += 1) {
    const y0 = Math.floor((ty * height) / thumbHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / thumbHeight));
    for (let tx = 0; tx < thumbWidth; tx += 1) {
      const x0 = Math.floor((tx * width) / thumbWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / thumbWidth));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        const base = y * width * 4;
        for (let x = x0; x < x1; x += 1) {
          const src = base + x * 4;
          r += rgba[src];
          g += rgba[src + 1];
          b += rgba[src + 2];
          a += rgba[src + 3];
          count += 1;
        }
      }
      const half = count >> 1;
      const dst = (ty * thumbWidth + tx) * 4;
      out[dst] = Math.floor((r + half) / count);
      out[dst + 1] = Math.floor((g + half) / count);
      out[dst + 2] = Math.floor((b + half) / count);
      out[dst + 3] = Math.floor((a + half) / count);
    }
    guard();
  }
  return { rgba: out, width: thumbWidth, height: thumbHeight };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse only the header/structure of a PNG or JPEG without decoding pixels.
 * @param {Uint8Array|Buffer|ArrayBuffer} bytes image bytes
 * @returns {{format:'png'|'jpeg',width:number,height:number,bitDepth:number,colorType:number,interlace:number,progressive:boolean,bytes:number}}
 */
export function probeImage(bytes) {
  const data = asBytes(bytes, 'bytes');
  assertByteLimit(data);
  const format = detectFormat(data);
  if (format === 'png') {
    const struct = parsePngStructure(data, false, 'probe');
    return {
      format: 'png',
      width: struct.width,
      height: struct.height,
      bitDepth: struct.bitDepth,
      colorType: struct.colorType,
      interlace: struct.interlace,
      progressive: false,
      bytes: data.length,
    };
  }
  if (format === 'jpeg') {
    const frame = parseJpegStructure(data, 'probe');
    return {
      format: 'jpeg',
      width: frame.width,
      height: frame.height,
      bitDepth: frame.precision,
      // For JPEG the color type field reports the component count:
      // 1 = grayscale, 3 = YCbCr/RGB, 4 = CMYK (unsupported for decoding).
      colorType: frame.components.length,
      interlace: 0,
      progressive: frame.progressive,
      bytes: data.length,
    };
  }
  fail('UNSUPPORTED_FORMAT', 'bytes are not a PNG or JPEG image');
  return null; // unreachable
}

/**
 * Decode an image to 8-bit RGBA plus a box-filtered PNG thumbnail.
 *
 * @param {Uint8Array|Buffer|ArrayBuffer} bytes image bytes
 * @param {{maxSide?:number,deadline?:number}} [options]
 *   maxSide  thumbnail longest side, integer 1..2048 (default 256)
 *   deadline Date.now() based millisecond timestamp; decoding aborts with
 *            PREVIEW_TIMEOUT once it passes. Defaults to
 *            Date.now() + IMAGE_LIMITS.decodeMs.
 * @returns {{format:'png'|'jpeg',width:number,height:number,rgba:Uint8Array,thumbnail:{width:number,height:number,png:Uint8Array},pixelDigest:string}}
 */
export function decodeImage(bytes, options = {}) {
  const data = asBytes(bytes, 'bytes');
  const opts = options === null || options === undefined ? {} : options;
  if (typeof opts !== 'object') {
    fail('INVALID_OPTION', 'options must be an object');
  }
  assertByteLimit(data);

  const maxSide = opts.maxSide === undefined ? 256 : opts.maxSide;
  if (
    typeof maxSide !== 'number' ||
    !Number.isInteger(maxSide) ||
    maxSide < 1 ||
    maxSide > 2048
  ) {
    fail('INVALID_OPTION', `options.maxSide must be an integer in 1..2048, got ${String(opts.maxSide)}`);
  }
  let deadline;
  if (opts.deadline === undefined || opts.deadline === null) {
    deadline = Date.now() + IMAGE_LIMITS.decodeMs;
  } else {
    if (typeof opts.deadline !== 'number' || !Number.isFinite(opts.deadline)) {
      fail('INVALID_OPTION', 'options.deadline must be a finite Date.now() timestamp');
    }
    deadline = opts.deadline;
  }
  const guard = createDeadlineGuard(deadline);
  guard();

  const format = detectFormat(data);
  if (format === null) {
    fail('UNSUPPORTED_FORMAT', 'bytes are not a PNG or JPEG image');
  }

  let width;
  let height;
  let rgba;
  if (format === 'png') {
    const struct = parsePngStructure(data, true, 'decode');
    width = struct.width;
    height = struct.height;
    rgba = pngToRgba(struct, guard);
  } else {
    const frame = parseJpegStructure(data, 'decode');
    width = frame.width;
    height = frame.height;
    rgba = decodeJpegFrame(frame, guard);
  }

  const thumbnailRgba = buildThumbnailRgba(rgba, width, height, maxSide, guard);
  const png = encodePng(thumbnailRgba.rgba, thumbnailRgba.width, thumbnailRgba.height);
  const pixelDigest = createHash('sha256').update(rgba).digest('hex');

  return {
    format,
    width,
    height,
    rgba,
    thumbnail: { width: thumbnailRgba.width, height: thumbnailRgba.height, png },
    pixelDigest,
  };
}
