# ADR 0301: Craftmine product profile and desktop surfaces

- Status: Accepted for the downstream Craftmine distribution
- Date: 2026-09-09

The product owner explicitly requests the complete PI desktop experience with stronger game-creation surfaces. Keep its React shell, session navigation, model settings, tools, work-panel tabs and theme system. Add a fixed World navigation item, a useful 560-pixel initial work-panel width, a scalable Craftmine mark, and Chinese-first product text. Saved widths and explicit language choices remain valid. The world view follows the host appearance event rather than assuming the operating system theme matches the application.

The application ID is `world.craftmine.desktop`, the English name is `craftmine world`, and the Chinese name is `最中幻想`. On Windows the default profile is `LOCALAPPDATA/CraftmineWorld`; Chromium uses its `desktop` subdirectory. An explicit absolute `CRAFTMINE_DATA_DIR` overrides that profile. The entry point sets the internal PI data-dir alias only after choosing the product profile, so an inherited PI profile cannot be reused accidentally. Each profile retains its own single-instance lock. No personal PI data or credential import is implicit.

The packaged distribution includes both Rust executables, the Agent sidecar, built-in world plugin, license, provenance, build instructions and matching source archive. It does not subscribe to the upstream application's update feed. Preview packaging is not a claim that the native-window, installation or real-model acceptance journeys have passed.
