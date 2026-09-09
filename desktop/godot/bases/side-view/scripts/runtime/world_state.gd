## Persistent side-view state.
##
## Every key is a stable string id declared in world data, never a node path, so
## a room can be rebuilt, renamed or moved without invalidating a player's save.
## This object is the only thing that is serialised; runtime nodes are rebuilt
## from world data plus this state on every room entry and every process start.
class_name WorldState
extends RefCounted

const FORMAT := "craftmine.godot-sideview-state/1"

var world_id: String = ""
var state_version: int = 1
## ability_id -> true. Only ever granted by an AbilityPickup body_entered.
var abilities: Dictionary = {}
## checkpoint_id -> true for every checkpoint the player has touched.
var checkpoints: Dictionary = {}
## Respawn target. Empty means "use the world start spawn".
var active_checkpoint: String = ""
## reward_id -> true. One-time rewards are never granted twice.
var rewards: Dictionary = {}
## room_id -> { "visited": true, "entries": int }
var rooms: Dictionary = {}
## Free-form integer counters (coins, hits, deaths, ...).
var counters: Dictionary = {}
## item_id -> count. Awarded by rewards; kept separate from counters.
var inventory: Dictionary = {}
## Stable target id -> remaining health; empty on legacy saves.
var entities: Dictionary = {}
## Health and death recovery survive a paused save and a complete restart.
var vitals: Dictionary = {}
## Last known player placement, used to restore on restart.
var player: Dictionary = {
	"room": "",
	"x": 0.0,
	"y": 0.0,
	"facing": 1,
}

# Avoid a self-typed static factory: Godot 4.7.2 retains the script at editor exit.
static func create(world_id_value: String, state_version_value: int):
	var state = load("res://scripts/runtime/world_state.gd").new()
	state.world_id = world_id_value
	state.state_version = state_version_value
	return state

func has_ability(ability_id: String) -> bool:
	return abilities.get(ability_id, false) == true

func grant_ability(ability_id: String) -> bool:
	if has_ability(ability_id):
		return false
	abilities[ability_id] = true
	return true

func has_checkpoint(checkpoint_id: String) -> bool:
	return checkpoints.get(checkpoint_id, false) == true

func activate_checkpoint(checkpoint_id: String) -> bool:
	var first_time := not has_checkpoint(checkpoint_id)
	checkpoints[checkpoint_id] = true
	active_checkpoint = checkpoint_id
	return first_time

func has_reward(reward_id: String) -> bool:
	return rewards.get(reward_id, false) == true

func collect_reward(reward_id: String) -> bool:
	if has_reward(reward_id):
		return false
	rewards[reward_id] = true
	return true

func mark_room_visited(room_id: String) -> int:
	var entry: Dictionary = rooms.get(room_id, {})
	entry["visited"] = true
	entry["entries"] = int(entry.get("entries", 0)) + 1
	rooms[room_id] = entry
	return int(entry["entries"])

func room_visited(room_id: String) -> bool:
	var entry: Dictionary = rooms.get(room_id, {})
	return entry.get("visited", false) == true

func add_counter(key: String, delta: int) -> int:
	var value := int(counters.get(key, 0)) + delta
	counters[key] = value
	return value

func counter(key: String) -> int:
	return int(counters.get(key, 0))

func add_item(item_id: String, amount: int) -> int:
	var value := int(inventory.get(item_id, 0)) + amount
	if value <= 0:
		inventory.erase(item_id)
	else:
		inventory[item_id] = value
	return value

func item_count(item_id: String) -> int:
	return int(inventory.get(item_id, 0))

# --- serialisation --------------------------------------------------------

## Canonical, sorted representation. The acceptance harness hashes this to prove
## that a restart restored the same persistent facts.
func to_dict() -> Dictionary:
	return {
		"format": FORMAT,
		"worldId": world_id,
		"stateVersion": state_version,
		"abilities": _sorted(abilities),
		"checkpoints": _sorted(checkpoints),
		"activeCheckpoint": active_checkpoint,
		"rewards": _sorted(rewards),
		"rooms": _sorted_rooms(),
		"counters": _sorted(counters),
		"inventory": _sorted(inventory),
		"entities": _sorted(entities),
		"vitals": vitals.duplicate(true),
		"player": {
			"room": str(player.get("room", "")),
			"x": float(player.get("x", 0.0)),
			"y": float(player.get("y", 0.0)),
			"facing": int(player.get("facing", 1)),
		},
	}

func to_canonical_json() -> String:
	return JSON.stringify(to_dict(), "", true, true)

## Persistent facts only: no player position, no room entry counters. Used as
## the launch state hash so that walking around does not invalidate a receipt.
func to_persistent_dict() -> Dictionary:
	return {
		"format": FORMAT,
		"worldId": world_id,
		"stateVersion": state_version,
		"abilities": _sorted(abilities),
		"checkpoints": _sorted(checkpoints),
		"activeCheckpoint": active_checkpoint,
		"rewards": _sorted(rewards),
		"counters": _sorted(counters),
		"inventory": _sorted(inventory),
		"entities": _sorted(entities),
	}

func apply_dict(data: Dictionary) -> Dictionary:
	var problem := validate_dict(data)
	if not problem.is_empty():
		return {"ok": false, "error": problem}
	world_id = str(data.get("worldId", world_id))
	state_version = int(data.get("stateVersion", state_version))
	abilities = _true_keys(data.get("abilities", {}))
	checkpoints = _true_keys(data.get("checkpoints", {}))
	active_checkpoint = str(data.get("activeCheckpoint", ""))
	rewards = _true_keys(data.get("rewards", {}))
	rooms = {}
	for key: Variant in (data.get("rooms", {}) as Dictionary).keys():
		var entry: Variant = (data.get("rooms", {}) as Dictionary)[key]
		if typeof(entry) == TYPE_DICTIONARY:
			rooms[str(key)] = {
				"visited": (entry as Dictionary).get("visited", false) == true,
				"entries": int((entry as Dictionary).get("entries", 0)),
			}
	counters = _int_dict(data.get("counters", {}))
	inventory = _int_dict(data.get("inventory", {}))
	entities = data.get("entities", {}).duplicate(true)
	vitals = data.get("vitals", {}).duplicate(true)
	var player_data: Variant = data.get("player", {})
	if typeof(player_data) == TYPE_DICTIONARY:
		var pd: Dictionary = player_data
		player = {
			"room": str(pd.get("room", "")),
			"x": float(pd.get("x", 0.0)),
			"y": float(pd.get("y", 0.0)),
			"facing": int(pd.get("facing", 1)),
		}
	return {"ok": true}

func validate_dict(data: Dictionary) -> String:
	if data.get("format") != FORMAT:
		return "Unsupported state format"
	if not data.get("worldId") is String or data.worldId != world_id:
		return "State belongs to another world"
	if not _integer(data.get("stateVersion")) or int(data.stateVersion) != state_version:
		return "Unsupported state version"
	for field in ["abilities", "checkpoints", "rewards", "rooms", "counters", "inventory", "player"]:
		if not data.get(field) is Dictionary:
			return "Invalid state block: " + field
	for field in ["abilities", "checkpoints", "rewards"]:
		for key in data[field]:
			if not key is String or key.is_empty() or not data[field][key] is bool or not data[field][key]:
				return "Invalid ledger: " + field
	if not data.get("activeCheckpoint") is String:
		return "Invalid checkpoint identity"
	if not data.activeCheckpoint.is_empty() and not data.checkpoints.has(data.activeCheckpoint):
		return "Active checkpoint is absent from ledger"
	for field in ["counters", "inventory"]:
		for key in data[field]:
			if not key is String or key.is_empty() or not _integer(data[field][key]) or float(data[field][key]) < 0:
				return "Invalid count: " + field
	for key in data.rooms:
		var entry: Variant = data.rooms[key]
		if not key is String or not entry is Dictionary:
			return "Invalid room"
		if not entry.get("visited") is bool or not _integer(entry.get("entries")) or float(entry.entries) < 0:
			return "Invalid room facts"
	if not data.get("entities", {}) is Dictionary or not data.get("vitals", {}) is Dictionary:
		return "Invalid entity or vital state"
	for id in data.get("entities", {}):
		var entity: Variant = data.entities[id]
		if not id is String or id.is_empty() or not entity is Dictionary or not _integer(entity.get("health")) or entity.health < 0 or entity.size() != 1:
			return "Invalid target health"
	var vital: Dictionary = data.get("vitals", {})
	if not vital.is_empty():
		if vital.size() != 4:
			return "Unsupported player vital field"
		if not _integer(vital.get("health")) or vital.health < 0 or not vital.get("alive") is bool or vital.alive != (vital.health > 0):
			return "Invalid player vitals"
		for field in ["invulnerableRemaining", "respawnRemaining"]:
			var timer: Variant = vital.get(field)
			if not (timer is int or timer is float) or not is_finite(float(timer)) or float(timer) < 0 or float(timer) > 3600:
				return "Invalid player vital timer"
	var placement: Dictionary = data.player
	if not placement.get("room") is String or not _integer(placement.get("facing")) or not int(placement.facing) in [-1, 1]:
		return "Invalid player identity"
	for axis in ["x", "y"]:
		var value: Variant = placement.get(axis)
		if not (value is int or value is float) or not is_finite(float(value)) or absf(float(value)) > 1000000:
			return "Invalid player position"
	return ""

static func _integer(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value)) and float(value) == floorf(float(value)) and absf(float(value)) <= 9007199254740991.0

static func _sorted(source: Dictionary) -> Dictionary:
	var out := {}
	var keys := source.keys()
	keys.sort()
	for key: Variant in keys:
		out[str(key)] = source[key]
	return out

func _sorted_rooms() -> Dictionary:
	var out := {}
	var keys := rooms.keys()
	keys.sort()
	for key: Variant in keys:
		var entry: Dictionary = rooms[key]
		out[str(key)] = {
			"visited": entry.get("visited", false) == true,
			"entries": int(entry.get("entries", 0)),
		}
	return out

static func _true_keys(source: Variant) -> Dictionary:
	var out := {}
	if typeof(source) != TYPE_DICTIONARY:
		return out
	for key: Variant in (source as Dictionary).keys():
		if (source as Dictionary)[key] == true:
			out[str(key)] = true
	return out

static func _int_dict(source: Variant) -> Dictionary:
	var out := {}
	if typeof(source) != TYPE_DICTIONARY:
		return out
	for key: Variant in (source as Dictionary).keys():
		out[str(key)] = int((source as Dictionary)[key])
	return out
