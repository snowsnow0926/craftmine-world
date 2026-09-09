/**
 * Craftmine World asset library - audio probe / decode (pure Node ESM).
 *
 * Scope:
 *  - Container + header inspection for RIFF/WAVE and Ogg (Vorbis / Opus).
 *  - Real PCM decoding for uncompressed WAVE data: 8/16/24/32-bit integer PCM,
 *    32-bit IEEE float, multi-channel, WAVE_FORMAT_EXTENSIBLE.
 *  - Vorbis / Opus payloads are NOT decoded to PCM. They are reported honestly
 *    with `pcmDecoded:false` and `reason:'ogg-pcm-decode-not-implemented'`;
 *    peak/rms/signalDigest stay null. No samples are ever fabricated.
 *
 * Constraints: no DOM, no AudioContext, no playback, no third-party deps.
 * Only `node:crypto` is used (SHA-256 of decoded PCM).
 */

import { createHash } from 'node:crypto';

const CODE_CORRUPT = 'CORRUPT_AUDIO';
const CODE_UNSUPPORTED = 'UNSUPPORTED_FORMAT';
const CODE_TOO_LARGE = 'AUDIO_TOO_LARGE';
const CODE_TIMEOUT = 'PREVIEW_TIMEOUT';

const MAX_SAMPLE_RATE = 768000;
const OGG_GRANULE_NONE = 0xFFFFFFFFFFFFFFFFn;
const OGG_PACKET_SEGMENT = 255;
const DEADLINE_CHECK_INTERVAL_FRAMES = 0x10000;

/**
 * KSDATAFORMAT GUID data2..data4 bytes: {xxxxxxxx-0000-0010-8000-00AA00389B71}.
 * Checked at fmt+28 (the first 4 GUID bytes carry the actual format code).
 */
const KSDATAFORMAT_GUID_TAIL = Object.freeze([
  0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
]);

/** Error type used for every audio preview failure. */
export class AssetPreviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AssetPreviewError';
    this.code = code;
  }
}

/** Hard limits applied by probe/decode. */
export const AUDIO_LIMITS = {
  bytes: 32 * 1024 * 1024,
  frames: 48000 * 600,
  channels: 8,
};

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function fail(code, message) {
  throw new AssetPreviewError(code, message);
}

function corrupt(message) {
  return fail(CODE_CORRUPT, message);
}

function unsupported(message) {
  return fail(CODE_UNSUPPORTED, message);
}

function tooLarge(message) {
  return fail(CODE_TOO_LARGE, message);
}

function timeout(message) {
  return fail(CODE_TIMEOUT, message);
}

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return corrupt('audio bytes must be a Uint8Array, Buffer, ArrayBuffer or typed array view');
}

function ascii(bytes, offset, length) {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

function u16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes, offset) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function framesToMs(frames, sampleRate) {
  return (frames * 1000) / sampleRate;
}

function normalizeDeadline(options) {
  const value = options && options.deadline;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeMaxFrames(options) {
  const value = options && options.maxFrames;
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : undefined;
}

function checkDeadline(deadline) {
  if (deadline !== undefined && Date.now() > deadline) {
    timeout('audio preview deadline exceeded');
  }
}

function enforceFrameLimits(frames, maxFrames) {
  if (frames > AUDIO_LIMITS.frames) {
    tooLarge(`frame count ${frames} exceeds limit ${AUDIO_LIMITS.frames}`);
  }
  if (maxFrames !== undefined && frames > maxFrames) {
    tooLarge(`frame count ${frames} exceeds maxFrames ${maxFrames}`);
  }
}

function detectContainer(bytes) {
  if (bytes.length < 4) return null;
  const magic = ascii(bytes, 0, 4);
  if (magic === 'RIFF') return 'wav';
  if (magic === 'OggS') return 'ogg';
  return null;
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Inspect an audio container without decoding samples.
 *
 * @param {Uint8Array|ArrayBuffer} bytes
 * @returns {{format:'wav'|'ogg', codec:string, sampleRate:number, channels:number,
 *            durationMs:number, bitsPerSample:number|null, bytes:number}}
 */
export function probeAudio(bytes) {
  const data = toBytes(bytes);
  if (data.length > AUDIO_LIMITS.bytes) {
    tooLarge(`audio size ${data.length} exceeds limit ${AUDIO_LIMITS.bytes}`);
  }
  const container = detectContainer(data);
  if (container === 'wav') {
    const info = parseWav(data, undefined);
    return {
      format: 'wav',
      codec: info.codec,
      sampleRate: info.sampleRate,
      channels: info.channels,
      durationMs: framesToMs(info.frames, info.sampleRate),
      bitsPerSample: info.bitsPerSample,
      bytes: data.length,
    };
  }
  if (container === 'ogg') {
    const info = parseOgg(data, undefined);
    return {
      format: 'ogg',
      codec: info.codec,
      sampleRate: info.sampleRate,
      channels: info.channels,
      durationMs: framesToMs(info.frames, info.sampleRate),
      bitsPerSample: null,
      bytes: data.length,
    };
  }
  return unsupported('unknown audio container (expected RIFF/WAVE or Ogg)');
}

/**
 * Decode audio (PCM for WAVE) and compute offline signal statistics.
 *
 * @param {Uint8Array|ArrayBuffer} bytes
 * @param {{deadline?:number, maxFrames?:number}} [options]
 * @returns {{format:string, codec:string, sampleRate:number, channels:number,
 *            frames:number, durationMs:number, pcmDecoded:boolean,
 *            peak:number|null, rms:number|null, signalDigest:string|null, reason?:string}}
 */
export function decodeAudio(bytes, options = {}) {
  const data = toBytes(bytes);
  const deadline = normalizeDeadline(options);
  const maxFrames = normalizeMaxFrames(options);

  if (data.length > AUDIO_LIMITS.bytes) {
    tooLarge(`audio size ${data.length} exceeds limit ${AUDIO_LIMITS.bytes}`);
  }
  checkDeadline(deadline);

  const container = detectContainer(data);
  if (container === 'wav') {
    const info = parseWav(data, deadline);
    enforceFrameLimits(info.frames, maxFrames);
    const stats = decodeWavPcm(data, info, deadline);
    return {
      format: 'wav',
      codec: info.codec,
      sampleRate: info.sampleRate,
      channels: info.channels,
      frames: info.frames,
      durationMs: framesToMs(info.frames, info.sampleRate),
      pcmDecoded: true,
      peak: stats.peak,
      rms: stats.rms,
      signalDigest: stats.signalDigest,
    };
  }
  if (container === 'ogg') {
    const info = parseOgg(data, deadline);
    enforceFrameLimits(info.frames, maxFrames);
    // Honest limitation marker: container metadata only, no PCM reconstruction.
    return {
      format: 'ogg',
      codec: info.codec,
      sampleRate: info.sampleRate,
      channels: info.channels,
      frames: info.frames,
      durationMs: framesToMs(info.frames, info.sampleRate),
      pcmDecoded: false,
      peak: null,
      rms: null,
      signalDigest: null,
      reason: 'ogg-pcm-decode-not-implemented',
    };
  }
  return unsupported('unknown audio container (expected RIFF/WAVE or Ogg)');
}

/* ------------------------------------------------------------------ */
/* WAVE (RIFF)                                                         */
/* ------------------------------------------------------------------ */

function parseWav(bytes, deadline) {
  const len = bytes.length;
  if (len < 12) corrupt('RIFF header truncated');
  if (ascii(bytes, 0, 4) !== 'RIFF') corrupt('missing RIFF signature');
  const riffSize = u32(bytes, 4);
  if (ascii(bytes, 8, 4) !== 'WAVE') corrupt('missing WAVE form type');
  if (riffSize + 8 > len) corrupt(`RIFF size ${riffSize} exceeds buffer payload ${len - 8}`);

  let fmt = null;
  let data = null;
  let offset = 12;
  while (offset + 8 <= len) {
    checkDeadline(deadline);
    const id = ascii(bytes, offset, 4);
    const size = u32(bytes, offset + 4);
    const start = offset + 8;
    if (start + size > len) {
      corrupt(`chunk '${id}' size ${size} exceeds buffer at offset ${start}`);
    }
    if (id === 'fmt ') {
      if (fmt) corrupt('duplicate fmt chunk');
      fmt = parseWavFmt(bytes, start, size);
    } else if (id === 'data') {
      if (data) corrupt('duplicate data chunk');
      data = { start, size };
    }
    offset = start + size + (size & 1); // chunks are word aligned
  }

  if (!fmt) corrupt('missing fmt chunk');
  if (!data) corrupt('missing data chunk');
  const frames = Math.floor(data.size / fmt.blockAlign);
  return { ...fmt, dataStart: data.start, dataSize: data.size, frames };
}

function parseWavFmt(bytes, start, size) {
  if (size < 16) corrupt('fmt chunk truncated');
  let formatCode = u16(bytes, start);
  const channels = u16(bytes, start + 2);
  const sampleRate = u32(bytes, start + 4);
  const blockAlign = u16(bytes, start + 12);
  const bitsPerSample = u16(bytes, start + 14);

  if (formatCode === 0xfffe) {
    // WAVE_FORMAT_EXTENSIBLE: real format code lives in the sub-format GUID.
    if (size < 40) corrupt('extensible fmt chunk truncated');
    for (let i = 0; i < KSDATAFORMAT_GUID_TAIL.length; i++) {
      if (bytes[start + 28 + i] !== KSDATAFORMAT_GUID_TAIL[i]) {
        unsupported('unknown WAVE_FORMAT_EXTENSIBLE sub-format GUID');
      }
    }
    formatCode = u16(bytes, start + 24);
  }

  if (channels < 1) corrupt('channel count must be >= 1');
  if (channels > AUDIO_LIMITS.channels) {
    tooLarge(`channel count ${channels} exceeds limit ${AUDIO_LIMITS.channels}`);
  }
  if (sampleRate < 1 || sampleRate > MAX_SAMPLE_RATE) {
    corrupt(`invalid sample rate ${sampleRate}`);
  }
  const bytesPerSample = (bitsPerSample + 7) >> 3;
  if (bytesPerSample === 0) corrupt('invalid bits per sample');
  if (blockAlign !== channels * bytesPerSample) {
    corrupt(`block align ${blockAlign} does not match ${channels} channels x ${bytesPerSample} bytes`);
  }

  return {
    formatCode,
    codec: wavCodec(formatCode, bitsPerSample),
    channels,
    sampleRate,
    bitsPerSample,
    blockAlign,
  };
}

function wavCodec(formatCode, bitsPerSample) {
  if (formatCode === 1) {
    if (bitsPerSample === 8) return 'pcm-u8';
    if (bitsPerSample === 16) return 'pcm-s16le';
    if (bitsPerSample === 24) return 'pcm-s24le';
    if (bitsPerSample === 32) return 'pcm-s32le';
    return unsupported(`unsupported PCM bit depth ${bitsPerSample}`);
  }
  if (formatCode === 3) {
    if (bitsPerSample === 32) return 'pcm-f32le';
    return unsupported(`unsupported IEEE float bit depth ${bitsPerSample}`);
  }
  return unsupported(`unsupported WAVE format code 0x${formatCode.toString(16)}`);
}

/**
 * Decode WAVE PCM to interleaved signed 16-bit little-endian samples.
 * Returns normalized peak/rms in 0..1 and a SHA-256 digest of the PCM.
 */
function decodeWavPcm(bytes, info, deadline) {
  const { codec, channels, frames, dataStart } = info;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bytesPerSample = (info.bitsPerSample + 7) >> 3;
  const totalSamples = frames * channels;
  const pcm = Buffer.allocUnsafe(totalSamples * 2);

  let source = dataStart;
  let target = 0;
  let peak = 0;
  let sumSquares = 0;
  let count = 0;

  for (let frame = 0; frame < frames; frame++) {
    if ((frame & (DEADLINE_CHECK_INTERVAL_FRAMES - 1)) === 0) checkDeadline(deadline);
    for (let channel = 0; channel < channels; channel++) {
      let normalized;
      let int16;
      if (codec === 'pcm-u8') {
        const raw = bytes[source];
        normalized = (raw - 128) / 128;
        int16 = (raw - 128) << 8;
      } else if (codec === 'pcm-s16le') {
        const raw = view.getInt16(source, true);
        normalized = raw / 32768;
        int16 = raw;
      } else if (codec === 'pcm-s24le') {
        const raw = readInt24(view, source);
        normalized = raw / 8388608;
        int16 = raw >> 8;
      } else if (codec === 'pcm-s32le') {
        const raw = view.getInt32(source, true);
        normalized = raw / 2147483648;
        int16 = raw >> 16;
      } else {
        // pcm-f32le
        let raw = view.getFloat32(source, true);
        if (!Number.isFinite(raw)) raw = 0;
        normalized = raw < -1 ? -1 : raw > 1 ? 1 : raw;
        int16 = Math.max(-32768, Math.min(32767, Math.round(normalized * 32768)));
      }
      const magnitude = normalized < 0 ? -normalized : normalized;
      if (magnitude > peak) peak = magnitude;
      sumSquares += normalized * normalized;
      count++;
      pcm.writeInt16LE(int16, target);
      target += 2;
      source += bytesPerSample;
    }
  }

  const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
  const signalDigest = createHash('sha256').update(pcm).digest('hex');
  return { peak, rms, signalDigest };
}

function readInt24(view, offset) {
  const value =
    view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
  return value & 0x800000 ? value - 0x1000000 : value;
}

/* ------------------------------------------------------------------ */
/* Ogg (Vorbis / Opus) - container metadata only                       */
/* ------------------------------------------------------------------ */

/** Ogg CRC-32: poly 0x04c11db7, init 0, no reflection, no final xor. */
const OGG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let remainder = i << 24;
    for (let bit = 0; bit < 8; bit++) {
      remainder = remainder & 0x80000000 ? (remainder << 1) ^ 0x04c11db7 : remainder << 1;
    }
    table[i] = remainder >>> 0;
  }
  return table;
})();

function oggCrc32(bytes, start, end) {
  let crc = 0;
  for (let i = start; i < end; i++) {
    // The stored checksum field itself is treated as zero.
    const byte = i >= start + 22 && i < start + 26 ? 0 : bytes[i];
    crc = ((crc << 8) ^ OGG_CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  }
  return crc >>> 0;
}

function concatParts(parts, totalLength) {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function parseOgg(bytes, deadline) {
  const len = bytes.length;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let pages = 0;
  let sawFirstPacket = false;
  let firstPacket = null;
  let packetParts = [];
  let packetLength = 0;
  let lastGranule = null;

  while (offset < len) {
    checkDeadline(deadline);
    if (len - offset < 27) corrupt('ogg page header truncated');
    if (ascii(bytes, offset, 4) !== 'OggS') corrupt('missing OggS capture pattern');
    const streamVersion = bytes[offset + 4];
    if (streamVersion !== 0) unsupported(`unsupported ogg stream structure version ${streamVersion}`);

    const granule = view.getBigUint64(offset + 6, true);
    const segmentCount = bytes[offset + 26];
    const tableStart = offset + 27;
    if (tableStart + segmentCount > len) corrupt('ogg segment table truncated');

    let payloadSize = 0;
    for (let i = 0; i < segmentCount; i++) payloadSize += bytes[tableStart + i];
    const pageEnd = tableStart + segmentCount + payloadSize;
    if (pageEnd > len) corrupt('ogg page payload truncated');

    const storedCrc = view.getUint32(offset + 22, true);
    if (storedCrc !== oggCrc32(bytes, offset, pageEnd)) corrupt('ogg page crc mismatch');

    let cursor = tableStart + segmentCount;
    for (let i = 0; i < segmentCount; i++) {
      const segment = bytes[tableStart + i];
      packetParts.push(bytes.subarray(cursor, cursor + segment));
      packetLength += segment;
      cursor += segment;
      if (segment < OGG_PACKET_SEGMENT) {
        if (!sawFirstPacket) {
          sawFirstPacket = true;
          firstPacket = concatParts(packetParts, packetLength);
        }
        packetParts = [];
        packetLength = 0;
      }
    }

    if (granule !== OGG_GRANULE_NONE) lastGranule = granule;
    pages++;
    offset = pageEnd;
  }

  if (pages === 0) corrupt('empty ogg stream');
  if (!sawFirstPacket) corrupt('no complete ogg packet found');

  const ident = identifyOggCodec(firstPacket);
  const frames = lastGranule === null ? 0 : Number(lastGranule);
  if (frames > AUDIO_LIMITS.frames) {
    tooLarge(`frame count ${frames} exceeds limit ${AUDIO_LIMITS.frames}`);
  }
  return { codec: ident.codec, sampleRate: ident.sampleRate, channels: ident.channels, frames, pages };
}

function identifyOggCodec(packet) {
  if (packet.length >= 30 && packet[0] === 0x01 && ascii(packet, 1, 6) === 'vorbis') {
    // Vorbis identification header: version(4) channels(1) sampleRate(4) ...
    const channels = packet[11];
    const sampleRate = u32(packet, 12);
    if (channels < 1) corrupt('vorbis channel count must be >= 1');
    if (channels > AUDIO_LIMITS.channels) {
      tooLarge(`channel count ${channels} exceeds limit ${AUDIO_LIMITS.channels}`);
    }
    if (sampleRate < 1 || sampleRate > MAX_SAMPLE_RATE) {
      corrupt(`invalid vorbis sample rate ${sampleRate}`);
    }
    return { codec: 'vorbis', channels, sampleRate };
  }
  if (packet.length >= 19 && ascii(packet, 0, 8) === 'OpusHead') {
    // Opus granule positions are always counted at 48 kHz.
    const channels = packet[9];
    if (channels < 1) corrupt('opus channel count must be >= 1');
    if (channels > AUDIO_LIMITS.channels) {
      tooLarge(`channel count ${channels} exceeds limit ${AUDIO_LIMITS.channels}`);
    }
    return { codec: 'opus', channels, sampleRate: 48000 };
  }
  return unsupported('unsupported ogg codec (expected Vorbis or Opus)');
}
