# Direct input after entering the Web world

Entering the Web slot through the trusted desktop already expresses the player's
intent to play. The iframe must not require a second Enter world click merely
to enable W/E controls. The trusted view now carries its immersive-active state
with load and immersion messages. The existing source/origin/nonce message checks
remain in force.

The real Web engine enables keyboard input and hides the duplicate entry gate
when immersive, unfrozen and not covered by dialogue/pause. This transition does
not focus any element or window and does not request Pointer Lock. The original
canvas gesture remains available for optional mouse-look capture. Pausing or
leaving immersion disables input and clears held keys. Returning to play enables
input again; duplicate unchanged presentation messages do not clear a held key.
Standalone embedded/manual play and draft previews retain their original gate.

The trusted parent world view also forwards a finite set of gameplay keys when
it owns the real DOM keyboard event. This covers the normal focus handoff to
the parent WebContents without focusing its child iframe. Only trusted events
on a loaded immersive Web world are eligible; forms, IME, modified keydowns,
paused/frozen/closing views, previews and workbench surfaces are excluded.
F2, Escape and other application shortcuts are not in the relay key set.

The relay uses the existing parent-source, origin and nonce-checked message
protocol and includes the current world identity. The receiver checks that
identity and its own immersive/pause/frozen state, then uses the same engine
keyboard handler as native iframe DOM events. Child-frame events do not bubble
to the parent, so they are not forwarded twice. Key release is accepted for a
held known key even after modifiers or composition start. Parent blur, leaving
play and pause clear held input. A subsequent trusted active-world key can
restore keyboard input after blur without focus or mouse capture; a paused or
save-frozen world cannot be reactivated this way.

The isolated game test runs the actual game document and voxel engine. Trusted
host messages enable controls; DOM callback events exercise real W movement and
E interaction dispatch. It verifies pause isolation, held-key clearing, resumption
and no focus/Pointer Lock calls. This is not physical keyboard acceptance.
The relay tests call its actual callback contract with event-shaped receipts;
the product's `isTrusted` check has no test bypass. They verify parent-to-child
messages through the actual game receiver, stale nonce/source/world rejection,
modifiers, editing, blur/resume and frozen-state refusal. Plugin bundling is run
into an isolated test output and checked for both parent and game handlers; the
new keyboard module is bundled, not an omitted runtime file dependency.

The earlier offscreen Web image showing a 1200x800 world within a 2560x1440 view
was an early resize observation, not proof of a permanently broken layout. The
same unchanged package naturally reached full iframe/canvas size. Native visual
and normal attachment tests now wait for two consistent samples matching the
actual viewport, without writing view bounds or forcing a repaint. This is an
acceptance correction; no product resize workaround was added for screenshots.
