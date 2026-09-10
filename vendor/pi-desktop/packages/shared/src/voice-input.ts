/** Local-only, explicit push-to-talk transport. Audio is never a chat attachment. */
export const VOICE_INPUT_CHANNELS = {
  capability: "pi-desktop/voice/capability",
  arm: "pi-desktop/voice/arm",
  transcribe: "pi-desktop/voice/transcribe",
  cancel: "pi-desktop/voice/cancel",
} as const;

export const VOICE_MAX_DURATION_MS = 30_000;
export const VOICE_SAMPLE_RATE = 16_000;
export const VOICE_MAX_AUDIO_BYTES = 44 + VOICE_SAMPLE_RATE * 2 * 30;

export type VoiceCapability = {
  available: boolean;
  provider: "windows-local";
  locales: string[];
  reason?: "platform" | "engine-unavailable";
};
export function normalizeVoiceCapability(value: unknown): VoiceCapability {
  const input = value && typeof value === "object" ? value as Partial<VoiceCapability> : {};
  const locales = Array.isArray(input.locales) ? input.locales.filter((locale) => typeof locale === "string" && /^[a-zA-Z0-9-]{1,40}$/.test(locale)) : [];
  return { provider: "windows-local", available: input.provider === "windows-local" && input.available === true && locales.length > 0, locales,
    ...(input.reason === "platform" || input.reason === "engine-unavailable" ? { reason: input.reason } : {}) };
}
export type VoiceTranscriptionRequest = {
  requestId: string;
  contextKey: string;
  locale: string;
  wav: ArrayBuffer;
};
export type VoiceTranscriptionResult = {
  requestId: string;
  contextKey: string;
  text: string;
  locale: string;
};
