/** Recognition contributes plain draft text; submitting remains an explicit action. */
export function appendVoiceTranscript(draft: string, transcript: string): string {
  const text = transcript.trim();
  if (!text) return draft;
  return draft + (draft && !/\s$/.test(draft) ? "\n" : "") + text;
}
