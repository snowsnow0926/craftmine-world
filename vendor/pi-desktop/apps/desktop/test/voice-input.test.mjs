import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { VoiceInputController } from "../src/lib/voice-input-controller.ts";
import { encodeVoiceWav, MAX_VOICE_SAMPLES } from "../src/lib/voice-pcm.ts";
import { normalizeVoiceCapability, resolveVoiceLocale } from "../../../packages/shared/src/voice-input.ts";

const bundled = await build({ entryPoints: [new URL("../electron/main/local-voice-input.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")], bundle: true, write: false, platform: "node", format: "esm" });
const { validateVoiceRequest, LocalVoiceInputService, runLocalVoiceProcess } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const wav = () => encodeVoiceWav([new Float32Array(1600)]);
const request = () => ({ requestId: "fixture-1", contextKey: "session:world", locale: "zh-CN", wav: wav() });
function fixture(overrides = {}) {
  const states = [], texts = [], cancelled = [];
  let capturesCancelled = 0;
  const adapter = {
    arm: async () => {}, capture: async () => ({ finish: async () => wav(), cancel: () => capturesCancelled++ }),
    transcribe: async (input) => ({ ...input, text: "Fixture transcript" }),
    cancel: async (id) => { cancelled.push(id); }, ...overrides,
  };
  const controller = new VoiceInputController(adapter, (value) => states.push(value), (text) => texts.push(text));
  return { controller, states, texts, cancelled, capturesCancelled: () => capturesCancelled };
}

test("fake provider transcript is returned only after release for draft correction", async () => {
  const f = fixture(); await f.controller.start("session:world", "zh-CN");
  assert.deepEqual(f.texts, []); assert.equal(f.states.at(-1).phase, "recording");
  await f.controller.release("zh-CN"); assert.deepEqual(f.texts, ["Fixture transcript"]);
  assert.deepEqual(f.states.map((s) => s.phase), ["starting", "recording", "transcribing", "idle"]);
});
test("release while microphone permission is pending stops the late fake stream", async () => {
  const pending = deferred(); let cancelled = 0;
  const f = fixture({ capture: () => pending.promise });
  const start = f.controller.start("session:world", "zh-CN"); await Promise.resolve();
  await f.controller.release("zh-CN"); pending.resolve({ cancel: () => cancelled++, finish: async () => wav() }); await start;
  assert.equal(cancelled, 1); assert.deepEqual(f.texts, []); assert.equal(f.states.at(-1).phase, "idle");
});
test("permission denied and absent microphone have distinct states", async () => {
  for (const [name, expected] of [["NotAllowedError", "permission"], ["NotFoundError", "microphone"]]) {
    const f = fixture({ capture: async () => { throw Object.assign(new Error("fixture"), { name }); } });
    await f.controller.start("session:world", "en"); assert.deepEqual(f.states.at(-1), { phase: "error", error: expected });
  }
});
test("cancel, blur, world/session replacement and late fake provider results never append", async () => {
  const pending = deferred(); const f = fixture({ transcribe: () => pending.promise });
  await f.controller.start("session:world-a", "zh-CN"); const release = f.controller.release("zh-CN"); await Promise.resolve();
  f.controller.cancel(); pending.resolve({ requestId: "old", contextKey: "session:world-a", text: "Must be discarded" }); await release;
  assert.deepEqual(f.texts, []); assert.equal(f.states.at(-1).phase, "idle"); assert.equal(f.cancelled.length, 1);
  await f.controller.start("other-session:world-b", "zh-CN"); f.controller.cancel(); assert.equal(f.capturesCancelled(), 1);
});
test("mismatched context response fails without entering the draft", async () => {
  const f = fixture({ transcribe: async (input) => ({ ...input, contextKey: "wrong-world", text: "Wrong world" }) });
  await f.controller.start("world", "en"); await f.controller.release("en");
  assert.deepEqual(f.texts, []); assert.equal(f.states.at(-1).error, "transcription");
});
test("wall-clock timeout releases a fake recording", async () => {
  const f = fixture();
  const controller = new VoiceInputController({
    arm: async () => {}, capture: async () => ({ finish: async () => wav(), cancel() {} }),
    transcribe: async (input) => ({ ...input, text: "Timed fixture" }), cancel: async () => {},
  }, (state) => f.states.push(state), (text) => f.texts.push(text), 5);
  await controller.start("world", "en");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(f.texts, ["Timed fixture"]);
  assert.equal(f.states.at(-1).phase, "idle");
});
test("worklet emits at most 480000 synthetic samples and flushes partial chunks on release", async () => {
  const source = await readFile(new URL("../src/lib/voice-capture-worklet.js", import.meta.url), "utf8");
  let Processor;
  const messages = [];
  vm.runInNewContext(source, { Float32Array, AudioWorkletProcessor: class { port = { postMessage: (value) => messages.push(value) }; }, registerProcessor: (_name, value) => { Processor = value; } });
  const processor = new Processor();
  for (let index = 0; index < 4000; index++) if (!processor.process([[new Float32Array(128)]])) break;
  assert.equal(messages.reduce((sum, message) => sum + (message.samples?.length ?? 0), 0), MAX_VOICE_SAMPLES);
  assert.equal(messages.filter((message) => message.limit).length, 1);
  messages.length = 0;
  const short = new Processor(); short.process([[new Float32Array(128)]]); short.port.onmessage({ data: "finish" });
  assert.equal(messages[0].samples.length, 128); assert.equal(messages[1].done, true);
});
test("sample limit produces bounded PCM WAV and rejects empty/oversize allocation", () => {
  assert.equal(encodeVoiceWav([new Float32Array(MAX_VOICE_SAMPLES)]).byteLength, 960044);
  assert.throws(() => encodeVoiceWav([])); assert.throws(() => encodeVoiceWav([new Float32Array(MAX_VOICE_SAMPLES + 1)]));
  assert.equal(validateVoiceRequest(request()).wav.byteLength, 3244);
  for (const offset of [0, 4, 8, 12, 16, 20, 22, 24, 28, 32, 34, 36, 40]) {
    const input = request(); new Uint8Array(input.wav)[offset] ^= 1; assert.throws(() => validateVoiceRequest(input));
  }
  assert.throws(() => validateVoiceRequest({ ...request(), wav: new Uint8Array(12) }));
});
test("main cancellation is owner/request scoped and rejects late results", async () => {
  const pending = deferred(); let killed = 0;
  const service = new LocalVoiceInputService(() => ({ result: pending.promise, cancel() { killed++; } }), "win32");
  const result = service.transcribe(1, request());
  service.cancel(2); service.cancel(1, "different-id"); assert.equal(killed, 0);
  service.cancel(1, "fixture-1"); assert.equal(killed, 1);
  pending.resolve({ text: "late", locale: "zh-CN" }); await assert.rejects(result, /cancelled/);
});
test("unsupported platform and missing recognizer report capability without capture", async () => {
  const service = new LocalVoiceInputService(() => ({ result: Promise.reject(new Error("missing")), cancel() {} }), "win32");
  assert.equal((await service.capability()).reason, "engine-unavailable");
  assert.equal((await new LocalVoiceInputService(undefined, "linux").capability()).reason, "platform");
});
test("capability lookup shares one owned process, caches success, and disposal stops future work", async () => {
  const pending = deferred(); let starts = 0, killed = 0;
  const service = new LocalVoiceInputService(() => { starts++; return { result: pending.promise, cancel() { killed++; } }; }, "win32");
  const first = service.capability(1), second = service.capability(1);
  assert.equal(starts, 1); pending.resolve({ locales: ["zh-CN"] });
  assert.equal((await first).available, true); assert.equal((await second).available, true);
  assert.equal((await service.capability(1)).available, true); assert.equal(starts, 1);
  service.dispose(); assert.equal((await service.capability(1)).available, false);
  await assert.rejects(service.transcribe(1, request()), /disposed/); assert.equal(starts, 1); assert.equal(killed, 0);
});
test("window cancellation and disposal kill capability jobs and reject late enumeration results", async () => {
  for (const mode of ["window", "dispose"]) {
    const pending = deferred(); let killed = 0;
    const service = new LocalVoiceInputService(() => ({ result: pending.promise, cancel() { killed++; } }), "win32");
    const result = service.capability(7);
    service.cancel(8); service.cancel(7, "capture-gesture"); assert.equal(killed, 0);
    if (mode === "window") service.cancel(7); else service.dispose();
    assert.equal(killed, 1); pending.resolve({ locales: ["zh-CN"] });
    assert.equal((await result).available, false);
  }
});
test("malformed capability success data becomes disabled UI with a safe locale array", () => {
  for (const value of [undefined, null, { ok: true }, { available: true }, { available: true, provider: "windows-local", locales: "zh-CN" }]) {
    const result = normalizeVoiceCapability(value); assert.equal(result.available, false); assert.deepEqual(result.locales, []);
  }
  assert.equal(normalizeVoiceCapability({ available: true, provider: "windows-local", locales: ["zh-CN"] }).available, true);
});
test("Windows local engine can enumerate and process synthetic silence without microphone capture", { skip: process.platform !== "win32" }, async () => {
  const capability = await new LocalVoiceInputService().capability();
  assert.ok(Array.isArray(capability.locales));
  if (!capability.available) return;
  const result = await runLocalVoiceProcess({ mode: "transcribe", locale: capability.locales[0], audio: Buffer.from(wav()).toString("base64") }).result;
  assert.equal(result.text, ""); assert.equal(result.locale, capability.locales[0]);
});
test("cancel terminates a real hidden capability process without opening microphone", { skip: process.platform !== "win32" }, async () => {
  const job = runLocalVoiceProcess({ mode: "capability" });
  const rejection = assert.rejects(job.result, /cancelled/);
  job.cancel(); await rejection;
});

test("Chinese aliases select the declared script region and never a different installed language", () => {
  assert.equal(resolveVoiceLocale("zh", ["en-US", "zh-CN"]), "zh-CN");
  assert.equal(resolveVoiceLocale("zh-Hans", ["zh-TW", "zh-CN"]), "zh-CN");
  assert.equal(resolveVoiceLocale("zh-Hant", ["zh-CN", "zh-TW"]), "zh-TW");
  for (const requested of ["zh", "zh-CN", "zh-Hans", "zh-Hant", "zh-HK"]) assert.equal(resolveVoiceLocale(requested, ["en-US"]), null);
  assert.equal(resolveVoiceLocale("zh-CN", ["zh-TW"]), null);
  assert.equal(resolveVoiceLocale("ZH-cn", ["zh-CN"]), "zh-CN");
  assert.equal(resolveVoiceLocale("en-US", ["en-GB"]), null);
});

test("recheck enumerates newly installed languages instead of returning cached success", async () => {
  let count = 0;
  const service = new LocalVoiceInputService(() => ({ result: Promise.resolve({locales: ++count === 1 ? ["en-US"] : ["en-US", "zh-CN"]}), cancel() {} }), "win32");
  assert.deepEqual((await service.capability(1)).locales, ["en-US"]);
  assert.deepEqual((await service.capability(1)).locales, ["en-US"]);
  assert.deepEqual((await service.capability(1, true)).locales, ["en-US", "zh-CN"]);
  assert.equal(count, 2);
});

test("recording freezes its language before a UI locale change and reports the actual result locale", async () => {
  let requested;
  const f = fixture({ transcribe: async input => { requested = input.locale; return {...input, text: "中文草稿"}; } });
  await f.controller.start("world", "zh-CN"); await f.controller.release("en-US");
  assert.equal(requested, "zh-CN"); assert.deepEqual(f.texts, ["中文草稿"]);
  assert.deepEqual(f.states.at(-1), {phase: "idle", locale: "zh-CN"});
});

test("wrong-language provider results never enter the draft and main rejects them too", async () => {
  const f = fixture({transcribe: async input => ({...input, locale: "en-US", text: "wrong language"})});
  await f.controller.start("world", "zh-CN"); await f.controller.release();
  assert.deepEqual(f.texts, []); assert.equal(f.states.at(-1).error, "transcription");
  const service = new LocalVoiceInputService(() => ({result: Promise.resolve({text: "wrong", locale: "en-US"}), cancel() {}}), "win32");
  await assert.rejects(service.transcribe(1, request()), /Invalid local speech result/);
});

test("real Windows provider rejects a missing language without using a fallback or a microphone", {skip: process.platform !== "win32"}, async () => {
  await assert.rejects(runLocalVoiceProcess({mode: "transcribe", locale: "zz-ZZ", audio: Buffer.from(wav()).toString("base64")}).result, /failed/);
});
