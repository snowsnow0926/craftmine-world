// Public surface of the controlled L3 part-extension layer.
//
// Consumers:
//   * the release/migration owner (H) installs, upgrades, uninstalls and rolls
//     parts back through `createPartManager`;
//   * the performance/licensing owner (K) feeds real measurements into
//     `measureBudget` and release checks use `licenseReady`;
//   * the tool/context owner (L) reads `status()` to tell the model which part
//     version is actually active instead of guessing.
//
// Nothing here executes part code. Loading the entry script is a separate,
// host-owned step that must run inside a managed Godot job.
export * from './formats.mjs';
export * from './content-ref.mjs';
export * from './manifest.mjs';
export * from './package.mjs';
export * from './compat.mjs';
export * from './store.mjs';
export * from './lifecycle.mjs';
export * from './budget.mjs';
export * from './candidate.mjs';
