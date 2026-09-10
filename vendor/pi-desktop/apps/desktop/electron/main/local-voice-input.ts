import { spawn } from "node:child_process";
import path from "node:path";
import type { VoiceCapability, VoiceTranscriptionRequest, VoiceTranscriptionResult } from "../../../../packages/shared/src/voice-input";
import { VOICE_MAX_AUDIO_BYTES, normalizeVoiceCapability } from "../../../../packages/shared/src/voice-input";

// Fixed source only. Audio and locale arrive over stdin, never shell interpolation.
export const LOCAL_VOICE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$recognizer = $null
$audio = $null
try {
  Add-Type -AssemblyName System.Speech
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $engines = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers())
  if ($request.mode -eq 'capability') {
    @{ available = ($engines.Count -gt 0); provider = 'windows-local'; locales = @($engines | ForEach-Object { $_.Culture.Name }) } | ConvertTo-Json -Compress
    exit 0
  }
  if ($engines.Count -eq 0) { throw 'No installed local speech recognizer' }
  $selected = $engines | Where-Object { $_.Culture.Name -eq $request.locale } | Select-Object -First 1
  if ($null -eq $selected) { throw 'Requested speech language is not installed' }
  $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($selected)
  $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $bytes = [Convert]::FromBase64String($request.audio)
  $audio = New-Object System.IO.MemoryStream(,$bytes)
  $recognizer.SetInputToWaveStream($audio)
  $texts = New-Object 'System.Collections.Generic.List[string]'
  while ($true) {
    $result = $recognizer.Recognize([TimeSpan]::FromSeconds(30))
    if ($null -eq $result) { break }
    if ($result.Text) { $texts.Add($result.Text) }
    if ($texts.Count -ge 128) { break }
  }
  @{ text = [string]::Join(' ', $texts); locale = $selected.Culture.Name } | ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine('Local speech recognition failed')
  exit 1
} finally {
  if ($null -ne $recognizer) { $recognizer.Dispose() }
  if ($null -ne $audio) { $audio.Dispose() }
}
`;

export function validateVoiceRequest(value: unknown): VoiceTranscriptionRequest {
  if (!value || typeof value !== "object") throw new Error("Invalid voice request");
  const input = value as VoiceTranscriptionRequest;
  if (typeof input.requestId !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(input.requestId)
    || typeof input.contextKey !== "string" || input.contextKey.length < 1 || input.contextKey.length > 4096
    || typeof input.locale !== "string" || !/^[a-zA-Z0-9-]{1,40}$/.test(input.locale)
    || !(input.wav instanceof ArrayBuffer) || input.wav.byteLength < 46 || input.wav.byteLength > VOICE_MAX_AUDIO_BYTES) {
    throw new Error("Invalid voice request");
  }
  // Accept only the canonical, bounded PCM format produced by our capture adapter.
  const wav = Buffer.from(input.wav);
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.readUInt32LE(4) !== wav.length - 8
    || wav.toString("ascii", 8, 16) !== "WAVEfmt " || wav.readUInt32LE(16) !== 16
    || wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1
    || wav.readUInt32LE(24) !== 16000 || wav.readUInt32LE(28) !== 32000
    || wav.readUInt16LE(32) !== 2 || wav.readUInt16LE(34) !== 16
    || wav.toString("ascii", 36, 40) !== "data" || wav.readUInt32LE(40) !== wav.length - 44
    || (wav.length - 44) % 2 !== 0) throw new Error("Invalid voice WAV format");
  return input;
}

type LocalJob = { result: Promise<unknown>; cancel(): void };
export function runLocalVoiceProcess(payload: object, timeoutMs = 45_000): LocalJob {
  const executable = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const child = spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(LOCAL_VOICE_SCRIPT, "utf16le").toString("base64")], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let cancel = () => {};
  const result = new Promise<unknown>((resolve, reject) => {
    let output = "";
    let settled = false;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      child.stdin.destroy();
      if (error) { child.kill(); reject(error); } else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("Local speech recognition timed out")), timeoutMs);
    cancel = () => finish(new Error("Voice input cancelled"));
    child.on("error", () => finish(new Error("Local speech engine unavailable")));
    child.stdin.on("error", () => finish(new Error("Local speech engine unavailable")));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 32_768) finish(new Error("Local speech result too large"));
    });
    // Do not expose engine diagnostics, audio, or transcripts to application logs.
    child.stderr.resume();
    child.on("close", (code) => {
      if (code !== 0) { finish(new Error("Local speech recognition failed")); return; }
      try { finish(undefined, JSON.parse(output.replace(/^\uFEFF/, "").trim())); }
      catch { finish(new Error("Invalid local speech result")); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
  return { result, cancel: () => cancel() };
}

/** Main owns jobs by WebContents ID. No file, network, agent, or secret-store access. */
export class LocalVoiceInputService {
  private jobs = new Map<number, { requestId: string; job: LocalJob }>();
  private capabilityJob?: { job: LocalJob; owners: Set<number>; result: Promise<VoiceCapability> };
  private cachedCapability?: VoiceCapability;
  private disposed = false;
  constructor(private runner = runLocalVoiceProcess, private platform = process.platform) {}

  async capability(ownerId?: number, refresh = false): Promise<VoiceCapability> {
    const unavailable: VoiceCapability = { available: false, provider: "windows-local", locales: [], reason: "engine-unavailable" };
    if (this.disposed) return unavailable;
    if (this.platform !== "win32") return { available: false, provider: "windows-local", locales: [], reason: "platform" };
    if (refresh) this.cachedCapability = undefined;
    if (this.cachedCapability) return this.cachedCapability;
    if (this.capabilityJob) {
      if (ownerId !== undefined) this.capabilityJob.owners.add(ownerId);
      return this.capabilityJob.result;
    }
    const entry = { job: this.runner({ mode: "capability" }, 10_000), owners: new Set(ownerId === undefined ? [] : [ownerId]), result: Promise.resolve(unavailable) };
    this.capabilityJob = entry;
    entry.result = entry.job.result.then((value) => {
      if (this.disposed || this.capabilityJob !== entry) return unavailable;
      const result = value as VoiceCapability;
      const locales = normalizeVoiceCapability({ ...result, provider: "windows-local", available: true }).locales;
      const capability: VoiceCapability = { available: locales.length > 0, provider: "windows-local", locales, ...(locales.length ? {} : { reason: "engine-unavailable" as const }) };
      if (capability.available) this.cachedCapability = capability;
      return capability;
    }).catch(() => unavailable).finally(() => { if (this.capabilityJob === entry) this.capabilityJob = undefined; });
    return entry.result;
  }

  async transcribe(ownerId: number, value: unknown): Promise<VoiceTranscriptionResult> {
    if (this.disposed) throw new Error("Voice input service disposed");
    const input = validateVoiceRequest(value);
    if (this.platform !== "win32") throw new Error("Local speech engine unavailable");
    this.cancel(ownerId);
    const entry = { requestId: input.requestId, job: this.runner({ mode: "transcribe", locale: input.locale, audio: Buffer.from(input.wav).toString("base64") }) };
    this.jobs.set(ownerId, entry);
    try {
      const result = await entry.job.result as { text: string; locale: string };
      if (this.jobs.get(ownerId) !== entry) throw new Error("Voice input cancelled");
      if (typeof result.text !== "string" || result.text.length > 16_384 || typeof result.locale !== "string" || result.locale.toLowerCase() !== input.locale.toLowerCase()) throw new Error("Invalid local speech result");
      return { requestId: input.requestId, contextKey: input.contextKey, text: result.text, locale: result.locale };
    } finally { if (this.jobs.get(ownerId) === entry) this.jobs.delete(ownerId); }
  }

  cancel(ownerId: number, requestId?: string) {
    if (!requestId && this.capabilityJob?.owners.has(ownerId)) {
      const capability = this.capabilityJob;
      this.capabilityJob = undefined; capability.job.cancel();
    }
    const entry = this.jobs.get(ownerId);
    if (!entry || (requestId && entry.requestId !== requestId)) return;
    this.jobs.delete(ownerId); entry.job.cancel();
  }

  dispose() {
    this.disposed = true;
    const capability = this.capabilityJob;
    this.capabilityJob = undefined; capability?.job.cancel();
    this.cachedCapability = undefined;
    for (const ownerId of this.jobs.keys()) this.cancel(ownerId);
  }
}
