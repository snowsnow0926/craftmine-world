# Default ordinary world creation to Auto without overriding explicit choices

Date: 2026-09-13. Status: accepted.

The requested product is a world players create through conversation, rather
than a development workbench requiring permission cards, checks and adoption
steps. Previously an absent permission preference fell through to generic Ask,
so the new-player experience did not use the implemented automatic pipeline.

Set Auto on creation sessions only when neither the session nor global settings
contains an explicit choice. Keep workbench defaults and explicit preferences.
For retained conversations, complete the pipeline with a live, identity-checked
handoff back to play after the host confirms automatic adoption. Preserve any
newly entered draft and do not disturb history, other worlds or full workbench
views. No model or thinking defaults change.

See [the behavior and separate model acceptance scenarios](../spec/creation-default-auto-and-play.md).
