# Present world slots instead of editor and base choices

Status: accepted for the approved two-world convergence.

The default entry previously asked the player to choose an editor presentation,
then a generic world, then a base/template or a dialogue preparation flow. This
exposed technical choices before the player could enter a world, while old-world
conversation state could remain selected during an asynchronous world switch.

Use two fixed host-owned slots and one world-first presentation. The renderer
waits for the host's actual enter transaction and independently checks selected
slot identity. Initialization polling does not substitute for navigation. Retain
the older world list and its recovery tools under Settings rather than deleting
projects or coercing their engines.

Explicit slot entry also owns session handoff. Validate both navigation intent
and live draft stability; a host already on a destination is not proof that the
visible conversation belongs there. Only a durable world-conversation binding
permits retaining or restoring a session. This reuses existing isolation and
draft mechanisms and keeps first local entry independent of model configuration.
