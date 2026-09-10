# Optional creation workflow guide

The world workbench shows a collapsed, optional guide in the library. It
explains creation, drafts, checks, isolated previews, applying changes, and
saving/reopening. It does not infer progress or mark any step complete.
Expanding or collapsing the guide performs no model, source, or progress action.

Optional buttons open the existing checks or library views. Navigation is
blocked while another world operation or candidate preview is active. Switching
worlds or leaving the library clears listeners and invalidates late responses.
Returning to the library makes the guide available again, initially collapsed.
It stores no new preference, world state, or task state.

The guide stays inside the existing workbench surface. It must not increase the
fixed 76 CSS pixel Godot chrome height or overlap the sibling game view. The
existing navigation owns hiding, pausing, and resuming that game view.

The standalone headless DOM test covers the module's collapse/navigation/error
behavior. The assembled client must additionally verify the actual library
mount, existing navigation, and absence of viewport overlap. This slice does not
establish a successful new-player or real-model study.
