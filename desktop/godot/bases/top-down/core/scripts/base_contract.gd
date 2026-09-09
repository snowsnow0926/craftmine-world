# Base contract constants shared by every top-down world.
#
# These identifiers are the B/C integration surface: the build service identifies
# a world project by `worldFormat`, the run service drives it through `probeFormat`
# and reads/writes progress through `progressFormat`. Changing any value here is a
# protocol change and must be recorded in docs/ADR-0001-top-down-base.md.
class_name BaseContract
extends RefCounted

const BASE_ID := "top-down"
const BASE_VERSION := "1.0.0"
const BASE_PROTOCOL_VERSION := 1

const WORLD_FORMAT := "craftmine.godot-topdown-world/1"
const STATE_FORMAT := "craftmine.godot-topdown-state/1"
const PROGRESS_FORMAT := "craftmine.godot-topdown-progress/1"
const PROBE_FORMAT := "craftmine.godot-topdown-probe/1"

const STATE_VERSION := 1

# Scene-level facts the run service can query without reading the save file.
const SNAPSHOT_FORMAT := "craftmine.godot-topdown-snapshot/1"
