# Await Godot teardown before quitting Electron

The host previously detached its world and started asynchronous runtime
disposal without giving application shutdown a completion barrier. That leaves
owned loopback connections closing while Electron may stop its event loop.

Return a shared disposal promise and include it in the existing service
shutdown barrier. Keep the durable checkpoint prerequisite and runtime's
bounded socket cleanup. Do not add sleeps or turn nonzero process exits into
success. The observed native IOCP shutdown error remains a recorded failure;
the lifecycle omission is independently verified, and native retests decide
the practical result.

The PP2 follow-up closes additional ownership gaps: wait for formal world
WebContents destruction, await owned child process/stdio termination, and share
the complete HTTP runtime disposal promise. Deadlines produce named incomplete
teardown errors; main records these after collecting every service result.
No sleep is added and application exit-code acceptance is unchanged. This is
an independently justified lifecycle repair, not a proven explanation of the
IOCP crash. UtilityProcess has a distinct exit-plus-stream-close contract;
Node ChildProcess uses its native close event.

The follow-up retains ownership of retiring instances beyond current/pending selection and retains their failed cleanup evidence. Electron UtilityProcess stream observers are attached after its synchronous exit listener cleanup, using retained stream references. Native headless acceptance now carries and checks shutdownFailures, so a permitted exit zero cannot conceal an incomplete owner teardown. Ordinary quit policy is unchanged; the original IOCP crash is still not attributed by this repair.
Startup ownership starts before awaiting the runtime factory, not when pending receives a completed runtime. Dispose first initiates instance close, then drains the already-registered startup activities with a finite failure deadline. This avoids the close/readiness dependency cycle while preventing successful disposal before late resource cleanup. A deadline failure remains a failure after eventual cleanup; normal factory errors still reach the creation caller.