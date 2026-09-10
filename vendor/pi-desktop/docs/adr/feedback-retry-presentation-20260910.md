# Show explicit retry preparation without rewriting Core history

Actual failed-profile acceptance observed `world.creationRetry` acknowledge at
09:02:10.889 UTC, an unchanged failed row at 09:02:10.891, and a new Core job at
09:02:12.265. The old row made the UI immediately offer another retry and made a
test driver mistake the prior failure for the new attempt's terminal result.

The world factory now tracks its own pending explicit retry promises. Only
while such a promise exists and Core still reports a terminal failure, list
projection shows preparation. Core records remain untouched; confirmed or new
build states take precedence. Concurrent requests share the pending promise.
Scheduling errors are retained for status display instead of becoming an
unhandled rejection in the fire-and-forget panel route.

This is a presentation and scheduling correction. It introduces no durable
queue, automatic replay, new Core authority, or claim to repair the native
engine crash. A restart discards the scheduling projection and reads Core.

Validation: the four retry presentation regressions plus existing initializer
and creation tests passed (23 checks total), using production factory code and
controlled Core/initializer responses. No model, installer or GUI input ran.
