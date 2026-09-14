import { describe, expect, it } from "vitest";
import { deepSeekKeepAliveFetch } from "./deepseek-keep-alive.js";

const official = "https://api.deepseek.com/chat/completions";
async function run(chunks: string[], options: { url?: string; status?: number; type?: string; waiting?: boolean; aborted?: boolean } = {}) {
  const abort = new AbortController(); if (options.aborted) abort.abort();
  const encoder = new TextEncoder(), observations: Array<{ bytes: number; keepAlive: boolean }> = [];
  const original = new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } }),
    { status: options.status ?? 200, headers: { "content-type": options.type ?? "text/event-stream; charset=utf-8", "x-fixture": "unchanged" } });
  const wrapped = deepSeekKeepAliveFetch(async () => original, abort.signal, () => options.waiting ?? true,
    (bytes, keepAlive) => observations.push({ bytes, keepAlive }));
  const response = await wrapped(options.url ?? official);
  expect(await response.text()).toBe(chunks.join("")); expect(response.headers.get("x-fixture")).toBe("unchanged");
  return { observations, identical: response === original };
}
describe("bounded DeepSeek SSE keep-alive observation", () => {
  it("recognizes complete comments across arbitrary chunks and CR/LF without changing any byte", async () => {
    const { observations } = await run([": kee", "p-alive\r", "\n:keep-alive\n", "\n: keep-alive\r"]);
    expect(observations.filter(item => item.keepAlive)).toHaveLength(3);
  });
  it("does not treat data, empty lines, unknown comments, partial or oversized lines as keep-alive", async () => {
    const { observations } = await run(['data: {"content":": keep-alive"}\n\n', "\n: hello\n", "x".repeat(100000), ": keep-alive\n", ": keep-alive"]);
    expect(observations.some(item => item.keepAlive)).toBe(false);
  });
  it("retains byte counts but ignores comments after semantic generation starts", async () => {
    const { observations } = await run([": keep-alive\n\n"], { waiting: false });
    expect(observations).toEqual([{ bytes: 14, keepAlive: false }]);
  });
  it("does not wrap other endpoints, error responses, non-SSE responses or an aborted request", async () => {
    for (const options of [{ url: "https://api.deepseek.com.evil.test/chat/completions" }, { url: official + "?extra=1" },
      { url: "https://api.deepseek.com/responses" }, { status: 503 }, { type: "application/json" }, { aborted: true }]) {
      const { observations, identical } = await run([": keep-alive\n\n"], options);
      expect(observations).toEqual([]); expect(identical).toBe(true);
    }
  });
  it("preserves consumer cancellation and ignores later observations after abort", async () => {
    const abort = new AbortController(); let cancelled = false, observed = 0;
    const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new TextEncoder().encode(": keep-alive\n\n")); }, cancel() { cancelled = true; } }),
      { headers: { "content-type": "text/event-stream" } });
    const wrapped = await deepSeekKeepAliveFetch(async () => response, abort.signal, () => true, () => observed++)(official);
    const reader = wrapped.body!.getReader(); await reader.read(); const before = observed; abort.abort(); await reader.read(); await reader.cancel();
    await Promise.resolve(); expect(observed).toBe(before); expect(cancelled).toBe(true);
  });
});
