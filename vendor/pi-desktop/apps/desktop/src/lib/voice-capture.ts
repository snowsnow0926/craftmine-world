import workletUrl from "./voice-capture-worklet.js?url&no-inline";
import { encodeVoiceWav, MAX_VOICE_SAMPLES } from "./voice-pcm";
import type { VoiceCapture } from "./voice-input-controller";

export async function captureVoice(signal: AbortSignal, onLimit: () => void): Promise<VoiceCapture> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone unavailable");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
  if (signal.aborted) { stream.getTracks().forEach((track) => track.stop()); throw new DOMException("Cancelled", "AbortError"); }
  let context: AudioContext | undefined;
  let node: AudioWorkletNode | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let chunks: Float32Array[] = [];
  let count = 0;
  let closed = false;
  let finishResolve: (() => void) | undefined;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", cleanup);
    stream.getTracks().forEach((track) => track.stop());
    source?.disconnect(); node?.disconnect();
    if (node) node.port.onmessage = null;
    void context?.close().catch(() => {});
    finishResolve?.();
  };
  signal.addEventListener("abort", cleanup, { once: true });
  try {
    context = new AudioContext({ sampleRate: 16_000 });
    if (context.sampleRate !== 16_000) throw new Error("Unsupported capture sample rate");
    await context.audioWorklet.addModule(workletUrl);
    if (closed) throw new DOMException("Cancelled", "AbortError");
    node = new AudioWorkletNode(context, "craftmine-voice-capture");
    node.port.onmessage = ({ data }) => {
      if (closed) return;
      if (data.samples instanceof Float32Array) {
        const remaining = MAX_VOICE_SAMPLES - count;
        const chunk = data.samples.slice(0, remaining);
        chunks.push(chunk); count += chunk.length;
        if (data.samples.length > remaining) onLimit();
      }
      if (data.limit) { finishResolve?.(); onLimit(); }
      if (data.done) finishResolve?.();
    };
    source = context.createMediaStreamSource(stream);
    source.connect(node); node.connect(context.destination);
    await context.resume();
    if (closed) throw new DOMException("Cancelled", "AbortError");
    return {
      async finish() {
        if (closed) throw new Error("Voice capture closed");
        stream.getTracks().forEach((track) => track.stop());
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 250);
          finishResolve = () => { clearTimeout(timer); resolve(); };
          node!.port.postMessage("finish");
        });
        cleanup();
        try { return encodeVoiceWav(chunks); } finally { chunks = []; }
      },
      cancel() { cleanup(); chunks = []; },
    };
  } catch (error) { cleanup(); chunks = []; throw error; }
}
