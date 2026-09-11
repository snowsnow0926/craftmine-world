# Craftmine primary modes

The application shows two equal, side-by-side entry choices on every renderer
launch: **Immersive world** and **Game creation workbench**. The launch choice is
not persisted; stored dimensions and overlay preferences cannot bypass it.

Choosing a mode changes presentation only. It opens the existing world tab in
the current conversation, closes any retained chat overlay, and preserves the
world, draft, running task, and conversation identity. It never creates a task,
submits a prompt, or enters operating-system fullscreen.

Immersive entry opens the current playable world. If none is available, the
entry shows the host-backed world selection and explicit creation controls.
The player can enter only a world reported ready. Loading, initialization,
unavailable bridge, and failed selection cannot silently create or replace a
world. Creating a world remains a separate explicit action.

Workbench entry records an explicit preference to stay in the workbench when
a world activates. Resetting dimensions preserves this choice. Both modes
provide an action to return to the primary chooser. Return keeps the existing
workspace mounted while blocking its native surfaces, voice input, and
workspace shortcuts; choosing a mode resumes that same workspace.

The immersive world fills the client area; its chat and complete creation panel
are modal overlays with the world geometry retained. The workbench retains its
side-by-side editing layout. Startup selection is a product entry point, not a
world navigation sidebar layout preset.

Validation: targeted pure tests cover explicit mode preferences, resetting,
retained task identity, and the presentation-only chooser event. Integration
validation uses an isolated headless renderer with pointer lock disabled and
page-script form/event dispatch only; it never drives user input devices.
