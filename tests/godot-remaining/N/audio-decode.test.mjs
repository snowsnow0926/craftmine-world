/**
 * Craftmine World AL2 audio-decode tests.
 *
 * Pure offline verification: hand-built WAV / Ogg byte buffers, no playback,
 * no DOM, no AudioContext, no input simulation, no temp files.
 *
 * Run: node --test tests/godot-remaining/N/audio-decode.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  AssetPreviewError,
  AUDIO_LIMITS,
  probeAudio,
  decodeAudio,
} from '../../../vendor/pi-desktop/apps/desktop/electron/craftmine-assets/decode/audio-decode.mjs';

/* ------------------------------------------------------------------ */
/* fixtures (hand-built bytes)                                         */
/* ------------------------------------------------------------------ */

function buildWav({
  sampleRate,
  channels = 1,
  bitsPerSample,
  formatCode = 1,
  extensible = false,
  values,
}) {
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = values.length * bytesPerSample;
  const pad = dataSize & 1;
  const fmtSize = extensible ? 40 : 16;
  const riffSize = 4 + (8 + fmtSize) + (8 + dataSize + pad);
  const buf = Buffer.alloc(12 + 8 + fmtSize + 8 + dataSize + pad);

  buf.write('RIFF', 0, 'latin1');
  buf.writeUInt32LE(riffSize, 4);
  buf.write('WAVE', 8, 'latin1');
  buf.write('fmt ', 12, 'latin1');
  buf.writeUInt32LE(fmtSize, 16);
  buf.writeUInt16LE(extensible ? 0xfffe : formatCode, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buf.writeUInt16LE(channels * bytesPerSample, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  if (extensible) {
    buf.writeUInt16LE(22, 36); // cbSize
    buf.writeUInt16LE(bitsPerSample, 38); // valid bits
    buf.writeUInt32LE(((1 << channels) - 1) >>> 0, 40); // channel mask
    buf.writeUInt32LE(formatCode, 44); // GUID data1 = real format code
    buf.writeUInt16LE(0x0000, 48); // GUID data2
    buf.writeUInt16LE(0x0010, 50); // GUID data3
    const tail = [0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];
    for (let i = 0; i < tail.length; i++) buf[52 + i] = tail[i]; // GUID data4
  }

  const dataChunkOffset = 12 + 8 + fmtSize;
  buf.write('data', dataChunkOffset, 'latin1');
  buf.writeUInt32LE(dataSize, dataChunkOffset + 4);

  let offset = dataChunkOffset + 8;
  for (const value of values) {
    if (formatCode === 3) buf.writeFloatLE(value, offset);
    else if (bitsPerSample === 8) buf.writeUInt8(value, offset);
    else if (bitsPerSample === 16) buf.writeInt16LE(value, offset);
    else if (bitsPerSample === 24) buf.writeIntLE(value, offset, 3);
    else buf.writeInt32LE(value, offset);
    offset += bytesPerSample;
  }
  return buf;
}

/** Independent (bitwise) Ogg CRC-32 so the module's table version is cross-checked. */
function refOggCrc(page) {
  let crc = 0;
  for (let i = 0; i < page.length; i++) {
    const byte = i >= 22 && i < 26 ? 0 : page[i];
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x80000000 ? ((crc << 1) ^ 0x04c11db7) : crc << 1;
    }
    crc >>>= 0;
  }
  return crc >>> 0;
}

function buildOggPage({ headerType = 0, granule = 0n, serial = 0x12345678, sequence = 0, packets }) {
  const segments = [];
  const parts = [];
  for (const packet of packets) {
    const full = Math.floor(packet.length / 255);
    for (let i = 0; i < full; i++) segments.push(255);
    segments.push(packet.length % 255);
    parts.push(Buffer.from(packet));
  }
  assert.ok(segments.length <= 255, 'test page fits in one segment table');

  const payload = Buffer.concat(parts);
  const page = Buffer.alloc(27 + segments.length + payload.length);
  page.write('OggS', 0, 'latin1');
  page[4] = 0;
  page[5] = headerType;
  page.writeBigUInt64LE(BigInt(granule), 6);
  page.writeUInt32LE(serial >>> 0, 14);
  page.writeUInt32LE(sequence >>> 0, 18);
  page.writeUInt32LE(0, 22);
  page[26] = segments.length;
  for (let i = 0; i < segments.length; i++) page[27 + i] = segments[i];
  payload.copy(page, 27 + segments.length);
  page.writeUInt32LE(refOggCrc(page), 22);
  return page;
}

function vorbisIdentPacket({ sampleRate, channels }) {
  const packet = Buffer.alloc(30);
  packet[0] = 0x01;
  packet.write('vorbis', 1, 'latin1');
  packet.writeUInt32LE(0, 7); // vorbis version
  packet[11] = channels;
  packet.writeUInt32LE(sampleRate, 12);
  packet.writeInt32LE(0, 16); // bitrate max
  packet.writeInt32LE(0, 20); // bitrate nominal
  packet.writeInt32LE(0, 24); // bitrate min
  packet[28] = 0x88; // block sizes
  packet[29] = 0x01; // framing bit
  return packet;
}

function opusHeadPacket({ channels, inputSampleRate = 48000, preSkip = 312 }) {
  const packet = Buffer.alloc(19);
  packet.write('OpusHead', 0, 'latin1');
  packet[8] = 1; // version
  packet[9] = channels;
  packet.writeUInt16LE(preSkip, 10);
  packet.writeUInt32LE(inputSampleRate, 12);
  packet.writeInt16LE(0, 16); // output gain
  packet[18] = 0; // channel mapping family
  return packet;
}

/* expected stats computed independently from the raw sample array */

function expectedNormalized(value, formatCode, bitsPerSample) {
  if (formatCode === 3) return Math.max(-1, Math.min(1, value));
  if (bitsPerSample === 8) return (value - 128) / 128;
  if (bitsPerSample === 16) return value / 32768;
  if (bitsPerSample === 24) return value / 8388608;
  return value / 2147483648;
}

function expectedStats(values, formatCode, bitsPerSample) {
  let peak = 0;
  let sumSquares = 0;
  for (const value of values) {
    const normalized = expectedNormalized(value, formatCode, bitsPerSample);
    peak = Math.max(peak, Math.abs(normalized));
    sumSquares += normalized * normalized;
  }
  return { peak, rms: Math.sqrt(sumSquares / values.length) };
}

function expectedInt16(value, formatCode, bitsPerSample) {
  if (formatCode === 3) {
    const clamped = Math.max(-1, Math.min(1, value));
    return Math.max(-32768, Math.min(32767, Math.round(clamped * 32768)));
  }
  if (bitsPerSample === 8) return (value - 128) << 8;
  if (bitsPerSample === 16) return value;
  if (bitsPerSample === 24) return value >> 8;
  return value >> 16;
}

function expectedDigest(values, formatCode, bitsPerSample) {
  const pcm = Buffer.alloc(values.length * 2);
  for (let i = 0; i < values.length; i++) {
    pcm.writeInt16LE(expectedInt16(values[i], formatCode, bitsPerSample), i * 2);
  }
  return createHash('sha256').update(pcm).digest('hex');
}

function sineValues({ frames, channels = 1, bitsPerSample, formatCode = 1, frequency, sampleRate, amplitude }) {
  const fullScale = formatCode === 3 ? 1 : 2 ** (bitsPerSample - 1);
  const values = [];
  for (let frame = 0; frame < frames; frame++) {
    const phase = (2 * Math.PI * frequency * frame) / sampleRate;
    for (let channel = 0; channel < channels; channel++) {
      const gain = channel === 0 ? 1 : 0.5;
      const sample = amplitude * fullScale * gain * Math.sin(phase);
      // Integer PCM is quantized; float PCM keeps full precision.
      values.push(formatCode === 3 ? sample : Math.round(sample));
    }
  }
  return values;
}

function report(name, detail) {
  console.log(`[case] ${name} -> ${JSON.stringify(detail)}`);
}

function assertAudioError(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof AssetPreviewError, `expected AssetPreviewError, got ${error}`);
    assert.equal(error.name, 'AssetPreviewError');
    assert.equal(error.code, code);
    assert.equal(typeof error.message, 'string');
    assert.ok(error.message.length > 0, 'error message must not be empty');
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* API surface                                                         */
/* ------------------------------------------------------------------ */

test('AUDIO_LIMITS exposes the documented hard limits', () => {
  assert.deepEqual(AUDIO_LIMITS, {
    bytes: 32 * 1024 * 1024,
    frames: 48000 * 600,
    channels: 8,
  });
  report('AUDIO_LIMITS', AUDIO_LIMITS);
});

/* ------------------------------------------------------------------ */
/* WAV: real PCM decode                                                */
/* ------------------------------------------------------------------ */

test('WAV 16-bit mono sine: probe + decode peak/rms/digest', () => {
  const values = sineValues({
    frames: 800,
    bitsPerSample: 16,
    sampleRate: 8000,
    frequency: 2000,
    amplitude: 0.5,
  });
  const wav = buildWav({ sampleRate: 8000, bitsPerSample: 16, values });

  const probe = probeAudio(wav);
  assert.equal(probe.format, 'wav');
  assert.equal(probe.codec, 'pcm-s16le');
  assert.equal(probe.sampleRate, 8000);
  assert.equal(probe.channels, 1);
  assert.equal(probe.bitsPerSample, 16);
  assert.equal(probe.bytes, wav.length);
  assert.ok(Math.abs(probe.durationMs - 100) < 1e-6, `durationMs ${probe.durationMs}`);

  const decoded = decodeAudio(wav);
  const expected = expectedStats(values, 1, 16);
  assert.equal(decoded.pcmDecoded, true);
  assert.equal(decoded.frames, 800);
  assert.equal(decoded.channels, 1);
  assert.equal(decoded.sampleRate, 8000);
  assert.ok(Math.abs(decoded.durationMs - 100) < 1e-6);
  assert.ok(Math.abs(decoded.peak - expected.peak) < 1e-3, `peak ${decoded.peak} vs ${expected.peak}`);
  assert.ok(Math.abs(decoded.rms - expected.rms) < 1e-3, `rms ${decoded.rms} vs ${expected.rms}`);
  assert.ok(Math.abs(decoded.peak - 0.5) < 1e-3, `analytic peak ${decoded.peak}`);
  assert.ok(Math.abs(decoded.rms - 0.5 * Math.SQRT1_2) < 1e-3, `analytic rms ${decoded.rms}`);
  assert.equal(decoded.signalDigest, expectedDigest(values, 1, 16));
  assert.equal(decoded.reason, undefined);

  report('wav16-mono', {
    probe,
    frames: decoded.frames,
    peak: decoded.peak,
    rms: decoded.rms,
    signalDigest: decoded.signalDigest,
  });
});

test('WAV 8-bit unsigned mono: decode peak/rms/digest', () => {
  const values = sineValues({
    frames: 400,
    bitsPerSample: 8,
    sampleRate: 4000,
    frequency: 500,
    amplitude: 0.5,
  }).map((v) => v + 128);
  const wav = buildWav({ sampleRate: 4000, bitsPerSample: 8, values });

  const probe = probeAudio(wav);
  assert.equal(probe.codec, 'pcm-u8');
  assert.equal(probe.bitsPerSample, 8);
  assert.equal(probe.sampleRate, 4000);

  const decoded = decodeAudio(wav);
  const expected = expectedStats(values, 1, 8);
  assert.equal(decoded.pcmDecoded, true);
  assert.equal(decoded.frames, 400);
  assert.ok(Math.abs(decoded.durationMs - 100) < 1e-6);
  assert.ok(Math.abs(decoded.peak - expected.peak) < 1e-3, `peak ${decoded.peak} vs ${expected.peak}`);
  assert.ok(Math.abs(decoded.rms - expected.rms) < 1e-3, `rms ${decoded.rms} vs ${expected.rms}`);
  assert.ok(Math.abs(decoded.peak - 0.5) < 1e-3, `analytic peak ${decoded.peak}`);
  assert.equal(decoded.signalDigest, expectedDigest(values, 1, 8));

  report('wav8-mono', { codec: probe.codec, peak: decoded.peak, rms: decoded.rms });
});

test('WAV 24-bit mono: decode peak/rms/digest', () => {
  const values = sineValues({
    frames: 800,
    bitsPerSample: 24,
    sampleRate: 8000,
    frequency: 2000,
    amplitude: 0.5,
  });
  const wav = buildWav({ sampleRate: 8000, bitsPerSample: 24, values });

  const probe = probeAudio(wav);
  assert.equal(probe.codec, 'pcm-s24le');
  assert.equal(probe.bitsPerSample, 24);

  const decoded = decodeAudio(wav);
  const expected = expectedStats(values, 1, 24);
  assert.equal(decoded.pcmDecoded, true);
  assert.equal(decoded.frames, 800);
  assert.ok(Math.abs(decoded.peak - expected.peak) < 1e-3, `peak ${decoded.peak} vs ${expected.peak}`);
  assert.ok(Math.abs(decoded.rms - expected.rms) < 1e-3, `rms ${decoded.rms} vs ${expected.rms}`);
  assert.ok(Math.abs(decoded.peak - 0.5) < 1e-3, `analytic peak ${decoded.peak}`);
  assert.equal(decoded.signalDigest, expectedDigest(values, 1, 24));

  report('wav24-mono', { codec: probe.codec, peak: decoded.peak, rms: decoded.rms });
});

test('WAV 32-bit float mono: decode peak/rms/digest', () => {
  const values = sineValues({
    frames: 160,
    bitsPerSample: 32,
    formatCode: 3,
    sampleRate: 16000,
    frequency: 4000,
    amplitude: 0.25,
  });
  const wav = buildWav({ sampleRate: 16000, bitsPerSample: 32, formatCode: 3, values });

  const probe = probeAudio(wav);
  assert.equal(probe.codec, 'pcm-f32le');
  assert.equal(probe.bitsPerSample, 32);

  const decoded = decodeAudio(wav);
  const expected = expectedStats(values, 3, 32);
  assert.equal(decoded.pcmDecoded, true);
  assert.equal(decoded.frames, 160);
  assert.ok(Math.abs(decoded.peak - expected.peak) < 1e-3, `peak ${decoded.peak} vs ${expected.peak}`);
  assert.ok(Math.abs(decoded.rms - expected.rms) < 1e-3, `rms ${decoded.rms} vs ${expected.rms}`);
  assert.ok(Math.abs(decoded.peak - 0.25) < 1e-3, `analytic peak ${decoded.peak}`);
  assert.equal(decoded.signalDigest, expectedDigest(values, 3, 32));

  report('wav32f-mono', { codec: probe.codec, peak: decoded.peak, rms: decoded.rms });
});

test('WAV 16-bit stereo: interleaved frames + per-channel gain', () => {
  const values = sineValues({
    frames: 441,
    channels: 2,
    bitsPerSample: 16,
    sampleRate: 44100,
    frequency: 11025,
    amplitude: 0.5,
  });
  const wav = buildWav({ sampleRate: 44100, channels: 2, bitsPerSample: 16, values });

  const probe = probeAudio(wav);
  assert.equal(probe.channels, 2);
  assert.equal(probe.sampleRate, 44100);

  const decoded = decodeAudio(wav);
  const expected = expectedStats(values, 1, 16);
  assert.equal(decoded.pcmDecoded, true);
  assert.equal(decoded.channels, 2);
  assert.equal(decoded.frames, 441);
  assert.ok(Math.abs(decoded.durationMs - 10) < 1e-6, `durationMs ${decoded.durationMs}`);
  assert.ok(Math.abs(decoded.peak - expected.peak) < 1e-3, `peak ${decoded.peak} vs ${expected.peak}`);
  assert.ok(Math.abs(decoded.rms - expected.rms) < 1e-3, `rms ${decoded.rms} vs ${expected.rms}`);
  assert.ok(Math.abs(decoded.peak - 0.5) < 1e-3, `left channel peak ${decoded.peak}`);
  assert.equal(decoded.signalDigest, expectedDigest(values, 1, 16));

  report('wav16-stereo', {
    frames: decoded.frames,
    durationMs: decoded.durationMs,
    peak: decoded.peak,
    rms: decoded.rms,
  });
});

test('WAV WAVE_FORMAT_EXTENSIBLE 16-bit PCM decodes like plain PCM', () => {
  const values = sineValues({
    frames: 200,
    bitsPerSample: 16,
    sampleRate: 8000,
    frequency: 2000,
    amplitude: 0.5,
  });
  const wav = buildWav({
    sampleRate: 8000,
    bitsPerSample: 16,
    formatCode: 1,
    extensible: true,
    values,
  });

  const probe = probeAudio(wav);
  assert.equal(probe.codec, 'pcm-s16le');
  assert.equal(probe.channels, 1);

  const decoded = decodeAudio(wav);
  assert.equal(decoded.pcmDecoded, true);
  assert.equal(decoded.frames, 200);
  assert.equal(decoded.signalDigest, expectedDigest(values, 1, 16));
  assert.ok(Math.abs(decoded.peak - 0.5) < 1e-3);

  report('wav-extensible16', { codec: probe.codec, peak: decoded.peak });
});

/* ------------------------------------------------------------------ */
/* Ogg: container metadata only, honest "not implemented" marker       */
/* ------------------------------------------------------------------ */

test('Ogg Vorbis: container parse + granule duration + honest pcmDecoded:false', () => {
  const ident = vorbisIdentPacket({ sampleRate: 8000, channels: 2 });
  const pages = [
    buildOggPage({ headerType: 0x02, granule: 0n, sequence: 0, packets: [ident] }),
    buildOggPage({
      headerType: 0x04,
      granule: 8000n,
      sequence: 1,
      packets: [Buffer.from('\x03vorbis comment payload', 'latin1')],
    }),
  ];
  const ogg = Buffer.concat(pages);

  const probe = probeAudio(ogg);
  assert.equal(probe.format, 'ogg');
  assert.equal(probe.codec, 'vorbis');
  assert.equal(probe.sampleRate, 8000);
  assert.equal(probe.channels, 2);
  assert.equal(probe.bitsPerSample, null);
  assert.equal(probe.bytes, ogg.length);
  assert.ok(Math.abs(probe.durationMs - 1000) < 1e-6, `durationMs ${probe.durationMs}`);

  const decoded = decodeAudio(ogg);
  assert.equal(decoded.format, 'ogg');
  assert.equal(decoded.codec, 'vorbis');
  assert.equal(decoded.sampleRate, 8000);
  assert.equal(decoded.channels, 2);
  assert.equal(decoded.frames, 8000);
  assert.ok(Math.abs(decoded.durationMs - 1000) < 1e-6);
  assert.equal(decoded.pcmDecoded, false);
  assert.equal(decoded.peak, null);
  assert.equal(decoded.rms, null);
  assert.equal(decoded.signalDigest, null);
  assert.equal(decoded.reason, 'ogg-pcm-decode-not-implemented');

  report('ogg-vorbis', { probe, decoded });
});

test('Ogg Opus: container parse + 48 kHz granule duration + honest pcmDecoded:false', () => {
  const head = opusHeadPacket({ channels: 1, inputSampleRate: 44100, preSkip: 312 });
  const pages = [
    buildOggPage({ headerType: 0x02, granule: 0n, sequence: 0, packets: [head] }),
    buildOggPage({
      headerType: 0x04,
      granule: 96000n,
      sequence: 1,
      packets: [Buffer.from('OpusTags', 'latin1')],
    }),
  ];
  const ogg = Buffer.concat(pages);

  const probe = probeAudio(ogg);
  assert.equal(probe.format, 'ogg');
  assert.equal(probe.codec, 'opus');
  assert.equal(probe.sampleRate, 48000);
  assert.equal(probe.channels, 1);
  assert.equal(probe.bitsPerSample, null);
  assert.ok(Math.abs(probe.durationMs - 2000) < 1e-6, `durationMs ${probe.durationMs}`);

  const decoded = decodeAudio(ogg);
  assert.equal(decoded.codec, 'opus');
  assert.equal(decoded.frames, 96000);
  assert.ok(Math.abs(decoded.durationMs - 2000) < 1e-6);
  assert.equal(decoded.pcmDecoded, false);
  assert.equal(decoded.peak, null);
  assert.equal(decoded.rms, null);
  assert.equal(decoded.signalDigest, null);
  assert.equal(decoded.reason, 'ogg-pcm-decode-not-implemented');

  report('ogg-opus', { probe, decoded });
});

/* ------------------------------------------------------------------ */
/* malformed inputs                                                    */
/* ------------------------------------------------------------------ */

test('bad input: non-RIFF / non-Ogg header -> UNSUPPORTED_FORMAT', () => {
  const junk = Buffer.from('NOT-A-WAVE-OR-OGG-FILE-AT-ALL', 'latin1');
  assertAudioError(() => probeAudio(junk), 'UNSUPPORTED_FORMAT');
  assertAudioError(() => decodeAudio(junk), 'UNSUPPORTED_FORMAT');
  report('bad-non-container', { bytes: junk.length, code: 'UNSUPPORTED_FORMAT' });
});

test('bad input: truncated RIFF header -> CORRUPT_AUDIO', () => {
  const values = sineValues({ frames: 32, bitsPerSample: 16, sampleRate: 8000, frequency: 1000, amplitude: 0.5 });
  const wav = buildWav({ sampleRate: 8000, bitsPerSample: 16, values });
  const truncated = wav.subarray(0, 8);
  assertAudioError(() => probeAudio(truncated), 'CORRUPT_AUDIO');
  assertAudioError(() => decodeAudio(truncated), 'CORRUPT_AUDIO');
  report('bad-truncated-riff', { bytes: truncated.length, code: 'CORRUPT_AUDIO' });
});

test('bad input: WAV chunk length out of bounds -> CORRUPT_AUDIO', () => {
  const values = sineValues({ frames: 32, bitsPerSample: 16, sampleRate: 8000, frequency: 1000, amplitude: 0.5 });
  const wav = buildWav({ sampleRate: 8000, bitsPerSample: 16, values });
  const brokenFmt = Buffer.from(wav);
  brokenFmt.writeUInt32LE(0x00ffffff, 16); // fmt chunk size beyond EOF
  assertAudioError(() => probeAudio(brokenFmt), 'CORRUPT_AUDIO');

  const brokenData = wav.subarray(0, wav.length - 8); // RIFF size still claims full length
  assertAudioError(() => probeAudio(brokenData), 'CORRUPT_AUDIO');
  report('bad-wav-chunk-bounds', { fmtBytes: brokenFmt.length, dataBytes: brokenData.length, code: 'CORRUPT_AUDIO' });
});

test('bad input: unsupported WAVE codec / bit depth -> UNSUPPORTED_FORMAT', () => {
  const alaw = buildWav({
    sampleRate: 8000,
    bitsPerSample: 8,
    formatCode: 6, // A-law
    values: new Array(16).fill(128),
  });
  assertAudioError(() => probeAudio(alaw), 'UNSUPPORTED_FORMAT');

  const badFloat = buildWav({
    sampleRate: 8000,
    bitsPerSample: 64,
    formatCode: 3,
    values: new Array(8).fill(0),
  });
  assertAudioError(() => probeAudio(badFloat), 'UNSUPPORTED_FORMAT');
  report('bad-wav-codec', { code: 'UNSUPPORTED_FORMAT' });
});

test('bad input: Ogg page CRC mismatch -> CORRUPT_AUDIO', () => {
  const ident = vorbisIdentPacket({ sampleRate: 8000, channels: 1 });
  const page = buildOggPage({ headerType: 0x02, granule: 0n, packets: [ident] });
  const corrupted = Buffer.from(page);
  corrupted[27 + 10] ^= 0xff; // flip a payload byte, keep stored CRC
  assertAudioError(() => probeAudio(corrupted), 'CORRUPT_AUDIO');
  assertAudioError(() => decodeAudio(corrupted), 'CORRUPT_AUDIO');
  report('bad-ogg-crc', { bytes: corrupted.length, code: 'CORRUPT_AUDIO' });
});

test('bad input: truncated Ogg page -> CORRUPT_AUDIO', () => {
  const ident = vorbisIdentPacket({ sampleRate: 8000, channels: 1 });
  const page = buildOggPage({ headerType: 0x02, granule: 0n, packets: [ident] });
  const truncated = page.subarray(0, page.length - 5);
  assertAudioError(() => probeAudio(truncated), 'CORRUPT_AUDIO');
  report('bad-ogg-truncated', { bytes: truncated.length, code: 'CORRUPT_AUDIO' });
});

test('bad input: Ogg without a complete packet -> CORRUPT_AUDIO', () => {
  const page = buildOggPage({ headerType: 0x02, granule: 0n, packets: [] });
  assertAudioError(() => probeAudio(page), 'CORRUPT_AUDIO');
  report('bad-ogg-no-packet', { bytes: page.length, code: 'CORRUPT_AUDIO' });
});

test('bad input: unknown Ogg codec -> UNSUPPORTED_FORMAT', () => {
  const page = buildOggPage({
    headerType: 0x02,
    granule: 0n,
    packets: [Buffer.from('Speex   fake identification header', 'latin1')],
  });
  assertAudioError(() => probeAudio(page), 'UNSUPPORTED_FORMAT');
  report('bad-ogg-codec', { code: 'UNSUPPORTED_FORMAT' });
});

/* ------------------------------------------------------------------ */
/* limit paths                                                         */
/* ------------------------------------------------------------------ */

test('limits: channel count over AUDIO_LIMITS.channels -> AUDIO_TOO_LARGE', () => {
  const wav = buildWav({
    sampleRate: 8000,
    channels: 9,
    bitsPerSample: 16,
    values: new Array(9 * 4).fill(0),
  });
  assertAudioError(() => probeAudio(wav), 'AUDIO_TOO_LARGE');
  report('limit-channels', { channels: 9, code: 'AUDIO_TOO_LARGE' });
});

test('limits: byte size over AUDIO_LIMITS.bytes -> AUDIO_TOO_LARGE', () => {
  const oversized = Buffer.alloc(AUDIO_LIMITS.bytes + 1);
  assertAudioError(() => probeAudio(oversized), 'AUDIO_TOO_LARGE');
  assertAudioError(() => decodeAudio(oversized), 'AUDIO_TOO_LARGE');
  report('limit-bytes', { bytes: oversized.length, code: 'AUDIO_TOO_LARGE' });
});

test('limits: options.maxFrames exceeded -> AUDIO_TOO_LARGE', () => {
  const values = sineValues({ frames: 800, bitsPerSample: 16, sampleRate: 8000, frequency: 2000, amplitude: 0.5 });
  const wav = buildWav({ sampleRate: 8000, bitsPerSample: 16, values });
  assertAudioError(() => decodeAudio(wav, { maxFrames: 799 }), 'AUDIO_TOO_LARGE');
  const ok = decodeAudio(wav, { maxFrames: 800 });
  assert.equal(ok.frames, 800);
  report('limit-max-frames', { maxFrames: 799, code: 'AUDIO_TOO_LARGE', allowedFrames: ok.frames });
});

test('limits: options.deadline exceeded -> PREVIEW_TIMEOUT', () => {
  const values = sineValues({ frames: 800, bitsPerSample: 16, sampleRate: 8000, frequency: 2000, amplitude: 0.5 });
  const wav = buildWav({ sampleRate: 8000, bitsPerSample: 16, values });
  assertAudioError(() => decodeAudio(wav, { deadline: Date.now() - 1 }), 'PREVIEW_TIMEOUT');
  report('limit-deadline', { deadline: 'now-1', code: 'PREVIEW_TIMEOUT' });
});

test('limits: Ogg frame count respects maxFrames', () => {
  const head = opusHeadPacket({ channels: 1 });
  const ogg = Buffer.concat([
    buildOggPage({ headerType: 0x02, granule: 0n, sequence: 0, packets: [head] }),
    buildOggPage({ headerType: 0x04, granule: 96000n, sequence: 1, packets: [Buffer.from('OpusTags')] }),
  ]);
  assertAudioError(() => decodeAudio(ogg, { maxFrames: 95999 }), 'AUDIO_TOO_LARGE');
  assertAudioError(() => decodeAudio(ogg, { deadline: Date.now() - 1 }), 'PREVIEW_TIMEOUT');
  report('limit-ogg-frames', { maxFrames: 95999, code: 'AUDIO_TOO_LARGE' });
});
