# Authoritative runtime state for one top-down world instance.
#
# The state is keyed by *stable entity ids* declared in scenes and by data ids
# declared in `res://data/**`, never by node paths or array indices. That is what
# makes a save survive scene edits, node reordering and scene switching.
#
# Every mutation used by gameplay goes through the helpers below so that the
# probe interface and the real game share exactly one code path.
class_name WorldState
extends RefCounted

const STATE_VERSION := 1

const FACINGS := ["down", "left", "right", "up"]
const QUEST_STATUSES := ["inactive", "active", "completed"]

var world_id: String = ""
var coins: int = 0
var inventory: Dictionary = {}
var shops: Dictionary = {}
var quests: Dictionary = {}
var granted_rewards: Dictionary = {}
var flags: Dictionary = {}
var scene_positions: Dictionary = {}
var scene_id: String = ""
var player_position: Vector2 = Vector2.ZERO
var player_facing: String = "down"


static func create(world_id_value: String, initial: Dictionary) -> WorldState:
	var state := WorldState.new()
	state.world_id = world_id_value
	state.apply_initial_progress(initial)
	return state


# Initial progress is shipped with the world template. It deliberately contains
# only the starting position/inventory of a brand new player, so a world copied
# from the example can never inherit the example author's claimed rewards.
func apply_initial_progress(initial: Dictionary) -> void:
	coins = int(initial.get("coins", 0))
	inventory.clear()
	for entry in _as_array(initial.get("inventory", [])):
		if entry is Dictionary and entry.get("id") is String:
			inventory[String(entry.id)] = int(entry.get("count", 0))
	shops.clear()
	for shop_entry in _as_array(initial.get("shops", [])):
		if shop_entry is Dictionary and shop_entry.get("id") is String:
			var stock: Dictionary = {}
			for item in _as_array(shop_entry.get("stock", [])):
				if item is Dictionary and item.get("id") is String:
					stock[String(item.id)] = int(item.get("count", 0))
			shops[String(shop_entry.id)] = {"stock": stock}
	quests.clear()
	for quest_entry in _as_array(initial.get("quests", [])):
		if quest_entry is Dictionary and quest_entry.get("id") is String:
			quests[String(quest_entry.id)] = {
				"status": String(quest_entry.get("status", "inactive")),
				"delivered": 0,
				"rewarded": false,
			}
	granted_rewards.clear()
	flags.clear()
	scene_positions.clear()
	for flag_entry in _as_array(initial.get("flags", [])):
		if flag_entry is Dictionary and flag_entry.get("id") is String:
			flags[String(flag_entry.id)] = flag_entry.get("value", true)
	scene_id = String(initial.get("sceneId", ""))
	var spawn := _as_array(initial.get("playerPosition", [0, 0]))
	player_position = Vector2(float(spawn[0]), float(spawn[1]))
	player_facing = String(initial.get("playerFacing", "down"))
	if not FACINGS.has(player_facing):
		player_facing = "down"


func clone() -> WorldState:
	var copy := WorldState.new()
	copy.from_dict(to_dict(), world_id)
	return copy


# ---------------------------------------------------------------- inventory

func count_of(item_id: String) -> int:
	return int(inventory.get(item_id, 0))


func add_item(item_id: String, amount: int) -> void:
	if amount <= 0:
		return
	inventory[item_id] = count_of(item_id) + amount


func has_items(item_id: String, amount: int) -> bool:
	return count_of(item_id) >= amount


func remove_item(item_id: String, amount: int) -> bool:
	if amount <= 0 or not has_items(item_id, amount):
		return false
	var left := count_of(item_id) - amount
	if left == 0:
		inventory.erase(item_id)
	else:
		inventory[item_id] = left
	return true


# ---------------------------------------------------------------- shop stock

func ensure_shop(shop_id: String, catalog: Array) -> void:
	if not shops.has(shop_id):
		shops[shop_id] = {"stock": {}}
	var stock: Dictionary = shops[shop_id]["stock"]
	for entry in catalog:
		if not entry is Dictionary or not entry.get("id") is String:
			continue
		var item_id := String(entry.id)
		if not stock.has(item_id):
			stock[item_id] = int(entry.get("stock", 0))


func stock_of(shop_id: String, item_id: String) -> int:
	if not shops.has(shop_id):
		return 0
	return int(shops[shop_id]["stock"].get(item_id, 0))


func set_stock(shop_id: String, item_id: String, value: int) -> void:
	if not shops.has(shop_id):
		shops[shop_id] = {"stock": {}}
	shops[shop_id]["stock"][item_id] = maxi(0, value)


# ------------------------------------------------------------------- quests

func ensure_quest(quest_id: String, initial_status: String = "inactive") -> void:
	if quests.has(quest_id):
		return
	quests[quest_id] = {"status": initial_status, "delivered": 0, "rewarded": false}


func quest_status(quest_id: String) -> String:
	if not quests.has(quest_id):
		return "inactive"
	return String(quests[quest_id].get("status", "inactive"))


func set_quest_status(quest_id: String, status: String) -> void:
	ensure_quest(quest_id)
	quests[quest_id]["status"] = status


func quest_rewarded(quest_id: String) -> bool:
	if not quests.has(quest_id):
		return false
	return bool(quests[quest_id].get("rewarded", false))


# `granted_rewards` is an independent ledger keyed by reward id. The quest flag
# alone would still be correct, but two ledgers make a duplicated grant from a
# second code path (a new shop item, a new quest script) fail closed instead of
# silently paying twice.
func has_granted(reward_id: String) -> bool:
	return granted_rewards.has(reward_id)


func mark_granted(reward_id: String) -> void:
	granted_rewards[reward_id] = true


# ------------------------------------------------------------ serialization

func to_dict() -> Dictionary:
	return {
		"format": BaseContract.STATE_FORMAT,
		"stateVersion": STATE_VERSION,
		"worldId": world_id,
		"coins": coins,
		"inventory": inventory.duplicate(true),
		"shops": shops.duplicate(true),
		"quests": quests.duplicate(true),
		"grantedRewards": granted_rewards.duplicate(true),
		"flags": flags.duplicate(true),
		"scenePositions": scene_positions.duplicate(true),
		"player": {
			"sceneId": scene_id,
			"position": [player_position.x, player_position.y],
			"facing": player_facing,
		},
	}


# Strict validation: a progress file is untrusted input. Anything unexpected is
# rejected as a whole rather than partially applied.
func from_dict(data: Dictionary, expected_world_id: String) -> Dictionary:
	if not data.get("format") is String or data.get("format") != BaseContract.STATE_FORMAT:
		return _invalid("State format is not supported")
	if _as_int(data.get("stateVersion")) != STATE_VERSION:
		return _invalid("State version is not supported")
	if not data.get("worldId") is String or String(data.worldId) != expected_world_id:
		return _invalid("State belongs to another world")

	var next_coins: Variant = _as_int(data.get("coins"))
	if next_coins == null or next_coins < 0:
		return _invalid("Coins are invalid")

	var next_inventory: Dictionary = {}
	if not data.get("inventory") is Dictionary:
		return _invalid("Inventory is invalid")
	for key in data.inventory.keys():
		if not key is String:
			return _invalid("Inventory key is invalid")
		var amount: Variant = _as_int(data.inventory[key])
		if amount == null or amount < 0:
			return _invalid("Inventory amount is invalid")
		if amount > 0:
			next_inventory[String(key)] = amount

	var next_shops: Dictionary = {}
	if not data.get("shops") is Dictionary:
		return _invalid("Shop state is invalid")
	for shop_key in data.shops.keys():
		if not shop_key is String or not data.shops[shop_key] is Dictionary:
			return _invalid("Shop entry is invalid")
		var raw_stock: Variant = data.shops[shop_key].get("stock", {})
		if not raw_stock is Dictionary:
			return _invalid("Shop stock is invalid")
		var stock: Dictionary = {}
		for item_key in raw_stock.keys():
			if not item_key is String:
				return _invalid("Shop stock key is invalid")
			var stock_amount: Variant = _as_int(raw_stock[item_key])
			if stock_amount == null or stock_amount < 0:
				return _invalid("Shop stock amount is invalid")
			stock[String(item_key)] = stock_amount
		next_shops[String(shop_key)] = {"stock": stock}

	var next_quests: Dictionary = {}
	if not data.get("quests") is Dictionary:
		return _invalid("Quest state is invalid")
	for quest_key in data.quests.keys():
		if not quest_key is String or not data.quests[quest_key] is Dictionary:
			return _invalid("Quest entry is invalid")
		var raw_quest: Dictionary = data.quests[quest_key]
		var status := String(raw_quest.get("status", "inactive"))
		if not QUEST_STATUSES.has(status):
			return _invalid("Quest status is invalid")
		var delivered: Variant = _as_int(raw_quest.get("delivered", 0))
		if delivered == null or delivered < 0:
			return _invalid("Quest delivery count is invalid")
		if not raw_quest.get("rewarded", false) is bool:
			return _invalid("Quest reward flag is invalid")
		next_quests[String(quest_key)] = {
			"status": status,
			"delivered": delivered,
			"rewarded": bool(raw_quest.get("rewarded", false)),
		}

	var next_granted: Dictionary = {}
	if not data.get("grantedRewards") is Dictionary:
		return _invalid("Reward ledger is invalid")
	for reward_key in data.grantedRewards.keys():
		if not reward_key is String or data.grantedRewards[reward_key] != true:
			return _invalid("Reward ledger entry is invalid")
		next_granted[String(reward_key)] = true

	var next_flags: Dictionary = {}
	if not data.get("flags") is Dictionary:
		return _invalid("Flags are invalid")
	for flag_key in data.flags.keys():
		if not flag_key is String:
			return _invalid("Flag key is invalid")
		var value: Variant = data.flags[flag_key]
		if not (value is bool or value is String or value is int or value is float):
			return _invalid("Flag value is invalid")
		next_flags[String(flag_key)] = value

	var next_positions: Dictionary = {}
	if not data.get("scenePositions") is Dictionary:
		return _invalid("Scene positions are invalid")
	for scene_key in data.scenePositions.keys():
		if not scene_key is String:
			return _invalid("Scene position key is invalid")
		var raw_position: Variant = data.scenePositions[scene_key]
		if not raw_position is Array or raw_position.size() != 2:
			return _invalid("Scene position is invalid")
		var sx: Variant = _as_float(raw_position[0])
		var sy: Variant = _as_float(raw_position[1])
		if sx == null or sy == null:
			return _invalid("Scene position is invalid")
		next_positions[String(scene_key)] = [sx, sy]

	if not data.get("player") is Dictionary:
		return _invalid("Player state is invalid")
	var raw_player: Dictionary = data.player
	if not raw_player.get("sceneId") is String:
		return _invalid("Player scene is invalid")
	if not raw_player.get("position") is Array or raw_player.position.size() != 2:
		return _invalid("Player position is invalid")
	var px: Variant = _as_float(raw_player.position[0])
	var py: Variant = _as_float(raw_player.position[1])
	if px == null or py == null:
		return _invalid("Player position is invalid")
	var facing := String(raw_player.get("facing", "down"))
	if not FACINGS.has(facing):
		return _invalid("Player facing is invalid")

	coins = next_coins
	inventory = next_inventory
	shops = next_shops
	quests = next_quests
	granted_rewards = next_granted
	flags = next_flags
	scene_positions = next_positions
	scene_id = String(raw_player.sceneId)
	player_position = Vector2(px, py)
	player_facing = facing
	return {"ok": true}


# Compact facts for the run service. Never includes anything the run service
# must not trust: it is reported data, not authorization.
func snapshot() -> Dictionary:
	return {
		"format": BaseContract.SNAPSHOT_FORMAT,
		"worldId": world_id,
		"stateVersion": STATE_VERSION,
		"coins": coins,
		"inventory": inventory.duplicate(true),
		"shops": shops.duplicate(true),
		"quests": quests.duplicate(true),
		"grantedRewards": granted_rewards.duplicate(true),
		"flags": flags.duplicate(true),
		"scenePositions": scene_positions.duplicate(true),
		"player": {
			"sceneId": scene_id,
			"position": [player_position.x, player_position.y],
			"facing": player_facing,
		},
	}


static func _invalid(message: String) -> Dictionary:
	return {"ok": false, "error": message}


static func _as_array(value: Variant) -> Array:
	return value if value is Array else []


static func _as_int(value: Variant) -> Variant:
	if value is int:
		return value
	if value is float and is_finite(value) and float(value) == floorf(float(value)):
		return int(value)
	return null


static func _as_float(value: Variant) -> Variant:
	if value is int or value is float:
		if is_finite(float(value)):
			return float(value)
	return null
