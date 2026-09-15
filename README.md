# Craftmine World · 最中幻想

**Perhaps a new way to play.**

English · [简体中文](README.zh-CN.md)

> An open world? How open is your imagination?

What if making a game were part of playing it?

Craftmine World brings AI into the world you play in. Start with a blank canvas—a 3D world, a top-down 2D scene, or a side-scrolling 2D level—and describe what you imagine. A tree becomes a forest. A quiet clearing becomes a monster arena. Ask for a companion, a sword, or a new rule, then keep playing as your world grows.

Use text or voice to express an idea. AI finds reusable assets or creates new content, checks the changes, and brings them into your world. Our ambition is the feeling of speaking things into existence: **less distance between imagining a game, making it, and playing it.**

[Get started](#get-started) · [How creation works](#how-creation-works) · [Build from source](#build-from-source) · [Licensing](#licensing)

## The current demo

**Windows x64 · `0.14.4-preview.27` · Portable ZIP**

Craftmine extends the existing **PI Desktop** interface with playable worlds, a reusable asset library, and an AI creation workflow. **Godot** runs the worlds; bundled **Blender** supports model creation in the background. The latest complete playtest focuses on the blank 3D world. The repository also includes top-down and side-view 2D bases; their capabilities and test coverage differ.

| Experience | Available today |
| --- | --- |
| Start playing | Open an example world or create an independent copy of a saved world template. |
| Start creating | Open a blank 3D world and describe the content or gameplay you want. |
| Speak your idea | Use an available Windows speech recognizer to create an editable text draft. |
| Reuse what exists | Search 34 asset entries across 41 versions, with four complete reference worlds. |
| Keep your progress | Save worlds, retain compatible state across updates, and reopen them later. |
| Share a starting point | Save a world to the local library, export a template ZIP, and create another world from it. |
| Choose your AI | Connect your own model service through PI, or configure a separately installed Codex CLI. |

The latest real DeepSeek playtest built and played this sequence in one blank world:

**Tree → flowers and grass → monsters → sword → giant monster trial → AK47.**

The test checked visible objects, enemy attacks, melee damage, gunfire, reloading, weapon switching, saving, and reopening. Six creation turns took about **17 minutes 31 seconds** in that run; this is an observed result, not a latency promise. See the [acceptance report](docs/DEMO_PREVIEW27_DELIVERY_ZH.md) for the configuration, failures, fixes, and evidence limits.

## Get started

### With a demo package

1. Obtain the complete Windows portable ZIP from the maintainer. GitHub's **Code → Download ZIP** downloads source, not the ready-to-run application.
2. Extract the entire package, then run `START-PLAYER-PREVIEW.cmd`. Keep the executable and its adjacent resources together.
3. Open an example, or choose **New world → 3D creation world → blank start**. Labels follow the selected UI language and version.
4. To create with AI, connect your own provider and select a model in settings. Credentials are not included in the package; model usage belongs to your own account.
5. Describe one change, wait for it to be checked and applied, then return to the world to try it.

Playing existing worlds and using supported library/template actions do not require an AI request. In the 3D creation world, **WASD** moves, **E** interacts, and **F2** opens the creation conversation. Other controls follow the active world's on-screen instructions. Voice input requires microphone permission and the corresponding Windows speech language.

The supplied `examples/deepseek-six-step-playtested.zip` reproduces the six-step world without running those model requests again. Import it from the world entry screen and create a copy. It includes saved playtest progress.

See [current Windows delivery](docs/CURRENT_WINDOWS_DELIVERY.md) for the package filename, checksum, profile behavior, and how to continue an older preview.

### A first creation session

Send these one at a time, trying each change before continuing:

```text
I'd like a tree.
Add some flowers and grass on the ground.
Create some monsters.
Give me a sword.
I'd like a monster-hunting fight. Add a giant monster.
Give me an AK47.
```

Then make it your own: change the setting, add a companion, tune the encounter, or invent a different goal. Save useful results to the library so the next world can build on them.

## How creation works

**Describe → inspect the world → search reusable assets → create or adapt → check → apply → play.**

The agent examines the current world and searches relevant assets, including their interfaces and dependencies. Suitable objects or gameplay components can be reused; new ideas can require code or a Blender model. In automatic mode, eligible changes are applied after their checks pass. Other flows present an installation proposal or candidate for the player to review.

Generating a response, installing an asset, passing a check, and updating the playable world are distinct steps. The result panel shows their progress. Speed and success depend on the model, service availability, the request, and available assets. Compatible state is preserved; incompatible changes can require repair before application.

This preview focuses on local creation and local reuse. A public community marketplace, shared online discovery, and multiplayer creation are future directions. The six-step test does not establish that every model or every open-ended request will succeed.

## Build from source

For the Windows application, use **Node.js 24**, **pnpm 11**, and the **Rust MSVC toolchain with Visual Studio C++ Build Tools**. Players using the complete package do not need these development tools.

```powershell
git clone --branch main https://github.com/snowsnow0926/craftmine-world.git
cd craftmine-world
pnpm -C vendor/pi-desktop install --frozen-lockfile
```

Prepare the pinned Godot, Blender, and MinGit inputs described in [desktop/README.md](desktop/README.md), then build from a clean checkout:

```powershell
powershell -NoProfile -File desktop/build-client.ps1 `
  -GodotCache '<absolute Godot cache directory>' `
  -BlenderCache '<absolute Blender cache directory>' `
  -GitArchive '<absolute MinGit ZIP path>'
```

The build creates `desktop/build/releases/<commit>-<id>/` with the unpacked application and evidence. Portable ZIP export is a separate step. Use the build guide for exact input hashes and commands. Root `npm start` starts the **legacy Web runner**, not PI Desktop.

| Directory | Responsibility |
| --- | --- |
| `vendor/pi-desktop/` | PI-based desktop shell, agent runtime, native host, and Craftmine domain service. |
| `plugins/craftmine-world/` | Creation tools, checks, application flow, and asset reuse. |
| `desktop/godot/` | World bases, runtime bridges, components, and engine tooling. |
| `desktop/blender/` | Blender integration, Python adapter, and native broker. |
| `desktop/delivery/` | Packaging, provenance, license inventories, and delivery checks. |
| `app/`, `world-workshop-3d/` | Earlier Web runner and prototype, retained as separate historical implementations. |
| `tests/`, `docs/` | Tests, design decisions, player guides, and acceptance evidence. |

A local CPU smoke check for the recent creation fixes:

```powershell
node --test tests/operator-world-session.test.mjs tests/world-publication-capture.test.mjs
```

Follow [AGENTS.md](AGENTS.md). Automated browser validation uses independent headless processes and separate profiles without taking over the user's mouse, keyboard, or pointer lock. Native and real-provider tests need their documented toolchains and explicit configuration.

## Licensing

Original project creation software uses **AGPL-3.0-only**. The explicitly listed original export runtime uses **MIT**. PI Desktop and its covered modifications retain **LGPL-3.0-or-later**; Blender and the Blender Python adapter retain their applicable **GPL** terms. Assets and other dependencies keep their own licenses.

Read [LICENSE](LICENSE), the [scope and exceptions](LICENSING.md), and [third-party notices](THIRD_PARTY_NOTICES.md). Using the tool does not, by itself, make your original game AGPL-licensed. Code and assets actually included in an export still carry their applicable terms. A separate commercial license for eligible project-owned creation code can be discussed with the maintainer; it does not cover third-party rights.

## More information

- [Asset catalog and reuse plan](docs/EXISTING_ASSETS_AND_REUSE_FIRST_PLAN_2026-09-15_ZH.md)
- [Current demo acceptance](docs/DEMO_PREVIEW27_DELIVERY_ZH.md)
- [Windows build guide](desktop/README.md)
- [Licensing explanation in Chinese](LICENSE.zh-CN.md)
- [Legacy Web runner documentation](docs/legacy/WEB_RUNNER_ALPHA_0_8.zh-CN.md)
- [Report a problem or propose an idea](https://github.com/snowsnow0926/craftmine-world/issues)

Built on the work of PI Desktop, Godot, Blender, Kenney, and the open-source libraries and tools listed in the notices.
