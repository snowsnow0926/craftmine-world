/** Observe the documented pre-inference SSE comment without buffering or
 * changing provider bytes. No content/header values leave this helper. */
export function deepSeekKeepAliveFetch(base: typeof fetch, signal: AbortSignal,
  waiting: () => boolean, activity: (bytes: number, keepAlive: boolean) => void, observed: () => void = () => {}): typeof fetch {
  return async (input, init) => {
    const response = await base(input, init);
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (signal.aborted || url.origin !== "https://api.deepseek.com" || url.username || url.password || url.search || url.hash
      || !/^\/(?:v1\/)?chat\/completions$/.test(url.pathname) || response.redirected || response.status !== 200
      || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/event-stream" || !response.body) return response;
    observed();
    let line = "", discarded = false;
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (!signal.aborted) {
          activity(chunk.byteLength, false);
          if (waiting()) for (const byte of chunk) {
            if (byte === 10 || byte === 13) {
              if (!discarded && (line === ": keep-alive" || line === ":keep-alive")) activity(0, true);
              line = ""; discarded = false;
            } else if (!discarded) {
              if (line.length < 12) line += String.fromCharCode(byte);
              else { line = ""; discarded = true; }
            }
          }
          else { line = ""; discarded = false; }
        }
        controller.enqueue(chunk);
      },
    }));
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}
