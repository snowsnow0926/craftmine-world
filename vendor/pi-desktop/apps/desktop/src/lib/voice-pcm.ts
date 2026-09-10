const RATE = 16_000;
export const MAX_VOICE_SAMPLES = RATE * 30;

/** Deterministic mono PCM16 WAV; bounds apply before allocation and across chunks. */
export function encodeVoiceWav(chunks: Float32Array[]): ArrayBuffer {
  const count = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (count < 1 || count > MAX_VOICE_SAMPLES) throw new Error("Voice audio size invalid");
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const label = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  label(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); label(8, "WAVE");
  label(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, "data"); view.setUint32(40, count * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const sample of chunk) {
    const value = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
    view.setInt16(offset, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    offset += 2;
  }
  return buffer;
}
