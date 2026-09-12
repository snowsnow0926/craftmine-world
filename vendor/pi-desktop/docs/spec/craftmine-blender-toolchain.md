# Private Blender toolchain configuration

The Electron main process supplies `craftmineBlenderToolchain` to PluginRuntime.
Packaged paths derive only from `process.resourcesPath/blender`; development
paths derive from the checkout's `desktop/build/runtime-resources/blender`.

The trusted world plugin's process bridge offers `pi.craftmine.getBlenderToolchain()`.
Its parent RPC is `craftmine.getBlenderToolchain` with no arguments. Only
`craftmine.world` may call it. The return value is a fresh object with four
absolute paths: `broker`, `brokerIdentity`, `runtimeRoot`, and `toolchainLock`.
Additional host properties are not returned. Missing configuration returns null;
relative or non-string paths fail. These paths are configuration, not an
attestation that binaries exist, match their pins, or pass isolation checks.

The renderer panel bridge and generic Craftmine host request allowlist do not
expose this RPC. The plugin's execution service separately validates the exact
runtime and broker identities and each native result before importing a model.

Validation: `apps/desktop/test/craftmine-blender-toolchain.test.mjs` exercises the
actual PluginRuntime dispatch, including other-plugin rejection, argument
rejection, invalid paths, missing configuration, returned-object independence,
and separation from panel/generic request routes. It starts no UI or engine.
