# DeepSeek pre-inference liveness

The Craftmine PI request boundary uses a 120-second inactivity watchdog, not a total generation deadline. Actual advancing text, reasoning and tool-call content resets that watchdog. Empty or replayed semantic events do not.

For the trusted pinned OpenAI completions transport using the official HTTPS api.deepseek.com endpoint and deepseek-flash model, also recognize DeepSeek's documented SSE keep-alive comments before the first semantic output. A complete standard comment resets the same watchdog. It does not create an assistant event, mark generation started, add tokens, or affect TPS. After semantic generation begins, comments no longer reset the watchdog.

The observer accepts only status 200 text/event-stream responses on the exact chat/completions endpoint, without redirects, URL credentials or extra query parameters. It forwards original bytes with backpressure and cancellation, keeps at most a twelve-character candidate line plus a discard flag, and ignores incomplete, oversized and unrelated lines. No body or header content enters diagnostics. Other providers, untrusted transport overrides, Codex and ordinary non-Craftmine chat retain their existing behavior.

Keep immediate player cancellation, one physical request, durable reservation and unknown-usage settlement. Do not add an overall request/task deadline or automatic retry. If valid keep-alives stop, the original inactivity timeout still fires. A server closure remains an error, not success.

One internal timing record per completed guarded request identifies the request/model/provider and reports sseObserved, transportBytes, preInferenceKeepAliveCount, semanticStarted, idleExpired, cancelled and optional last-activity ages. sseObserved=false means this observer did not see an eligible response; zero observed bytes alone must not be described as proof about unobserved network traffic. Existing task metrics remain authoritative for semantic generation and usage.

Official reference, checked 2026-09-15: [Request Keep-Alive Mechanism](https://api-docs.deepseek.com/quick_start/rate_limit/). The provider documents waiting comments and a server-controlled pre-inference closure after ten minutes. The client does not create an additional ten-minute task limit.
