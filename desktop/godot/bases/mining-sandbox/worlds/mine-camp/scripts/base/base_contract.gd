# Base contract constants shared by every mining-sandbox world.
#
# These identifiers are the integration surface: the build service identifies a
# world project by `worldFormat`, the run service drives it through `probeFormat`
# and reads/writes progress through `progressFormat` + `chunkFormat`. Changing any
# value here is a protocol change and must be recorded in
# docs/ADR-0001-mining-sandbox.md.
class_name MiningBaseContract
extends RefCounted

const BASE_ID := "mining-sandbox"
const BASE_VERSION := "1.0.0"
const BASE_PROTOCOL_VERSION := 1

const WORLD_FORMAT := "craftmine.godot-mining-sandbox-world/1"
const STATE_FORMAT := "craftmine.godot-mining-sandbox-state/1"
const PROGRESS_FORMAT := "craftmine.godot-mining-sandbox-progress/1"
const CHUNK_FORMAT := "craftmine.godot-mining-sandbox-chunk/1"
const PARAMS_FORMAT := "craftmine.godot-mining-sandbox-params/1"
const PROBE_FORMAT := "craftmine.godot-mining-sandbox-probe/1"
const SNAPSHOT_FORMAT := "craftmine.godot-mining-sandbox-snapshot/1"

const STATE_VERSION := 1

# Reused side-view foundation. The movement model is a declared dependency, not a
# copy that may drift silently: docs/REUSE.md records the source paths and hashes.
const REUSED_BASE_ID := "side-view"
const REUSED_BASE_VERSION := "1.0.0"

const AIR := "air"
