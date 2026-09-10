export type VoicePhase = "idle" | "starting" | "recording" | "transcribing" | "error";
export type VoiceError = "permission" | "microphone" | "unavailable" | "empty" | "transcription";
export type VoiceState = { phase: VoicePhase; error?: VoiceError; locale?: string };
export type VoiceCapture = { finish(): Promise<ArrayBuffer>; cancel(): void };
type VoiceRun = { id: string; context: string; locale: string; abort: AbortController; capture?: VoiceCapture; phase: VoicePhase; timer?: ReturnType<typeof setTimeout> };
export type VoiceAdapter = {
  arm(requestId: string, contextKey: string): Promise<void>;
  capture(signal: AbortSignal, onLimit: () => void): Promise<VoiceCapture>;
  transcribe(input: { requestId: string; contextKey: string; locale: string; wav: ArrayBuffer }): Promise<{ requestId: string; contextKey: string; text: string; locale: string }>;
  cancel(requestId: string): Promise<void>;
};

/** Owns one gesture; releasing during permission acquisition cancels that gesture. */
export class VoiceInputController {
  private run?: VoiceRun;
  private adapter: VoiceAdapter;
  private state: (state: VoiceState) => void;
  private transcript: (text: string) => void;
  private maxDuration: number;
  constructor(
    adapter: VoiceAdapter,
    state: (state: VoiceState) => void,
    transcript: (text: string) => void,
    maxDuration = 30_000,
  ) { this.adapter = adapter; this.state = state; this.transcript = transcript; this.maxDuration = maxDuration; }
  get active(): boolean { return this.run !== undefined; }

  async start(context: string, locale: string) {
    if (this.run) return;
    const run: VoiceRun = { id: crypto.randomUUID(), context, locale, abort: new AbortController(), phase: "starting" };
    this.run = run;
    this.state({ phase: "starting" });
    // Also bounds an unanswered microphone permission prompt.
    run.timer = setTimeout(() => void this.release(locale), this.maxDuration);
    try {
      await this.adapter.arm(run.id, context);
      if (this.run !== run) return;
      const capture = await this.adapter.capture(run.abort.signal, () => void this.release(locale));
      if (this.run !== run) { capture.cancel(); return; }
      run.capture = capture;
      run.phase = "recording";
      this.state({ phase: "recording" });
    } catch (error) {
      if (this.run !== run) return;
      this.cancel();
      const name = error instanceof Error ? error.name : "";
      this.state({ phase: "error", error: name === "NotAllowedError" || name === "SecurityError" ? "permission" : name === "VoiceUnavailableError" ? "unavailable" : "microphone" });
    }
  }

  async release(_locale?: string) {
    const run = this.run;
    if (!run || run.phase === "transcribing") return;
    if (!run.capture) { this.cancel(); return; }
    clearTimeout(run.timer);
    run.phase = "transcribing";
    this.state({ phase: "transcribing" });
    try {
      const wav = await run.capture.finish();
      run.capture = undefined;
      if (this.run !== run) return;
      const result = await this.adapter.transcribe({ requestId: run.id, contextKey: run.context, locale: run.locale, wav });
      if (this.run !== run) return;
      if (result.requestId !== run.id || result.contextKey !== run.context || result.locale?.toLowerCase() !== run.locale.toLowerCase()) throw new Error("Stale voice result");
      this.run = undefined;
      const text = result.text.trim();
      this.state(text ? { phase: "idle", locale: result.locale } : { phase: "error", error: "empty" });
      if (text) this.transcript(text);
    } catch {
      if (this.run !== run) return;
      this.cancel();
      this.state({ phase: "error", error: "transcription" });
    }
  }

  cancel() {
    const run = this.run;
    this.run = undefined;
    if (run) {
      clearTimeout(run.timer);
      run.abort.abort();
      run.capture?.cancel();
      void this.adapter.cancel(run.id).catch(() => {});
    }
    this.state({ phase: "idle" });
  }
}
