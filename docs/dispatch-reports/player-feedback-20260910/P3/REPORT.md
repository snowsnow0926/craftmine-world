# P3 delivery: fullscreen controls and input-layer policy

Baseline eae279915094f09d987ef0eb747eba20ef92cd0e; branch codex/fb-p3-20260910 in D:/cm-fb-p3-20260910.

The main renderer retains the existing F11 command and now consumes repeat without toggling. A finite Escape listener preserves IME/menu/pointer capture and native control layers before requesting explicit exitFullScreen. The layout controls provide a visible fullscreen button, returned/broadcast actual state, busy/error handling and Chinese/English shortcut instructions. No play-mode exit, window close, source mutation, snapshot write, or new global shortcut is introduced.

The first small commit e3abc987501c027f4911838cb943c741bee6bfe0 contains the shared helper and its policy tests for P1 consumption. The follow-up narrows native editing suppression so ordinary chat text does not permanently block Escape, adds App/UI hookup and the single NativeMenuAction enum entry. Host/preload/Main files are not modified in this branch.

Actual validations:

- Pure policy and direct listener lifecycle fixture: 13/13. Trusted/untrusted events, repeat, IME, modifiers, initial/late menus, defaultPrevented, pointer release, disposal/blur invalidation, single-flight/error handling. Event objects directly call captured functions; no OS or synthetic DOM keyboard dispatch.
- Actual React component + isolated headless Chromium DOM: final 14/14. The earlier 12/12 run is preserved separately. Real visible/hidden overlay inspection, native control classification, button form submission, actual returned fixture window state, failure/retry, busy deduplication, listener cleanup and zero pointer/focus requests. No mouse/keyboard/click/fill API is used.
- Existing settings-keyboard-shortcuts source regressions: 3/3.
- Shared helper strict standalone TypeScript: exit 0. Complete desktop TypeScript is left to the common source/dependency build; component bundling here is not that full check.

All commands/logs and source hashes are indexed in evidence-index.json. TEMP, browser profiles and outputs are on this D worktree. Dependencies are borrowed read-only from C:/cm-plan-next-20260910. No model, credential, personal profile or sealed package was used or modified.

Integration is not implied by these fixtures: P1 owns actual Godot sender/scope/visible-instance enforcement and its dedicated preload exit channel; P10 owns Main exitFullScreen=setFullScreen(false), the host callback and legacy panel focus path. Both were given exact contracts. A Godot key handler may consume Escape; do not bypass defaultPrevented or claim actual engine keyboard success without evidence. No actual Electron/Godot window transition, snapshot regression, package, OS input, multi-monitor/DPI or player feel was tested in P3's fixtures. P10/P1 must run the common no-input client checks after connecting these hooks; P11/user cover device/keyboard experience. Current scope does not exit play, so pause/checkpoint/write semantics remain untouched.

No main merge or push. This branch is a reviewable P3 module/UI delivery, with host/Main integration dependencies explicit; stop after handoff.
