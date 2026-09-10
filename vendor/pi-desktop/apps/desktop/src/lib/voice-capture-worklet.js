/* Runs only after the user explicitly starts microphone capture. */
class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = 0;
    this.buffer = new Float32Array(2048);
    this.used = 0;
    this.port.onmessage = (event) => {
      if (event.data === "finish") {
        this.flush();
        this.port.postMessage({ done: true });
        this.finished = true;
      }
    };
  }
  flush() {
    if (this.used) this.port.postMessage({ samples: this.buffer.slice(0, this.used) });
    this.used = 0;
  }
  process(inputs) {
    if (this.finished) return false;
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      if (this.samples >= 480000) {
        this.flush(); this.port.postMessage({ limit: true }); this.finished = true; return false;
      }
      this.buffer[this.used++] = sample;
      this.samples++;
      if (this.used === this.buffer.length) this.flush();
    }
    return true;
  }
}
registerProcessor("craftmine-voice-capture", VoiceCaptureProcessor);
