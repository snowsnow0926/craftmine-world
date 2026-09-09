// Public surface of the L4 creation-strategy experiment layer.
//
// This layer never decides whether a change is allowed: it builds the retrieval
// index, selects tools per arm, runs the frozen task set through an injected
// attempt adapter, and reports an honest comparison. The acceptance owner (I)
// freezes the tasks and the scoring contract; the tool/context owner (L) calls
// `selectTools` in the real creation loop once an arm has evidence behind it.
export * from './formats.mjs';
export * from './retrieval.mjs';
export * from './tool-selection.mjs';
export * from './experiment.mjs';
