# Godot presentation recovery

Automatic adoption can emit a ready state before its candidate transaction releases the host gate. The world panel must preserve the latest valid visibility/resume intent through that transient refusal, without claiming that a failed operation succeeded.

- Only existing runtimeSurface and runtimeResume presentation calls enter the queue. Existing Main world, instance, source and candidate checks apply on every attempt.
- Retry only the exact GODOT_CANDIDATE_ACTIVE code, including its standard Electron IPC wrapper. Keep one physical call and one retry timer, with delays capped at two seconds. Never close, apply or recover a candidate to unblock presentation.
- A newer surface intent supersedes earlier visibility and standalone resume intents. Bind all results to the current world and mount/close generation. World changes, closing, restore, preview, application and page disposal invalidate obsolete intents.
- A successful reply must contain ok: true. Only that success may dismiss the queue's own still-current busy error. Another save, navigation or runtime error must neither be overwritten by a background busy retry nor cleared by its success. Unknown errors remain visible and are not retried.
- Manual preview continues to use the existing return/apply controls. This queue changes presentation scheduling, not generation, candidate authorization, persistence or semantic playtest acceptance.

Validation: tests/godot-presentation-queue.test.mjs and tests/godot-presentation-recovery-headless.mjs exercise controlled scheduling and the actual complete world view. The latter retains the ordinary strict show-world helper; it does not bypass an existing error to obtain a passing result.
