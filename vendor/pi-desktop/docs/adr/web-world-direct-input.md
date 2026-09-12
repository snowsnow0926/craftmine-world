# Remove the Web world's duplicate gameplay entry gate

Status: accepted for the approved two-world player flow.

The desktop's Web card opened the world, but `game.js` paused engine input after
load. Resume/immersion only activated simulation; the input flag stayed false
until the internal entry button invoked focus and Pointer Lock. Consequently the
outer entry could show a world while W/E remained gated behind another click.

Use the existing trusted presentation channel to express immersive gameplay
ownership independently from mouse capture. Enable keyboard input without focus
or Pointer Lock, and revoke it on dialogue/pause/leave transitions. Preserve the
manual gate outside immersive desktop play. This changes the actual engine input
state rather than simulating a click or adding test-only activation.
