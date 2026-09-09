class_name BaseWorld
extends Node3D

## Scene root of every first-person base world. It wires the core nodes together
## by path so a copy of a scene stays editable, and it propagates the world
## identity that save/restore is scoped to.

signal world_ready()

@export var base_id := "first-person"
@export var base_version := "0.1.0"
@export var world_id := "local-world"
@export var level_title := ""
@export var balance_profile: BalanceProfile

@export_group("Core nodes")
@export var player_path: NodePath = ^"Player"
@export var equipment_state_path: NodePath = ^"EquipmentState"
@export var aim_query_path: NodePath = ^"Player/CameraRig/AimQuery"
@export var attack_dispatcher_path: NodePath = ^"Player/CameraRig/AttackDispatcher"
@export var world_state_path: NodePath = ^"WorldState"
@export var save_store_path: NodePath = ^"SaveStore"
@export var inventory_path: NodePath = ^"Inventory"
@export var quest_tracker_path: NodePath = ^"QuestTracker"
@export var crosshair_path: NodePath = ^"Hud/Root/Crosshair"
@export var hud_path: NodePath = ^"Hud"
@export var equipment_visuals_path: NodePath = ^"Player/CameraRig/PitchPivot/Camera3D/WeaponMount/EquipmentVisuals"

var player: PlayerController
var equipment_state: EquipmentState
var aim_query: AimQuery
var attack_dispatcher: AttackDispatcher
var world_state: WorldState
var save_store: SaveStore
var inventory: Inventory
var quest_tracker: QuestTracker
var crosshair: Crosshair
var hud: Hud
var equipment_visuals: EquipmentVisuals


func _ready() -> void:
	player = get_node_or_null(player_path) as PlayerController
	equipment_state = get_node_or_null(equipment_state_path) as EquipmentState
	aim_query = get_node_or_null(aim_query_path) as AimQuery
	attack_dispatcher = get_node_or_null(attack_dispatcher_path) as AttackDispatcher
	world_state = get_node_or_null(world_state_path) as WorldState
	save_store = get_node_or_null(save_store_path) as SaveStore
	inventory = get_node_or_null(inventory_path) as Inventory
	quest_tracker = get_node_or_null(quest_tracker_path) as QuestTracker
	crosshair = get_node_or_null(crosshair_path) as Crosshair
	hud = get_node_or_null(hud_path) as Hud
	equipment_visuals = get_node_or_null(equipment_visuals_path) as EquipmentVisuals
	_apply_world_id(world_id)
	for node in _bindable_nodes():
		node.bind_world(self)
	for node in get_tree().get_nodes_in_group("base_interactables"):
		if node.has_method("bind_world"):
			node.bind_world(self)
	if balance_profile != null:
		balance_profile.apply_to(self)
	world_ready.emit()


## Every core node that needs a reference implements bind_world(BaseWorld).
func _bindable_nodes() -> Array[Node]:
	var nodes: Array[Node] = []
	for candidate in [aim_query, attack_dispatcher, equipment_visuals, crosshair, hud, quest_tracker, world_state]:
		if candidate != null and candidate.has_method("bind_world"):
			nodes.append(candidate)
	return nodes


func _apply_world_id(value: String) -> void:
	world_id = value
	if world_state != null:
		world_state.base_id = base_id
		world_state.base_version = base_version
		world_state.world_id = value
	if save_store != null:
		save_store.world_id = value


## Overrides the world identity before the first save. Used by the run adapters
## so two worlds built from the same scene never share progress.
func set_world_id(value: String) -> void:
	if value.is_empty():
		return
	_apply_world_id(value)


func camera_rig() -> CameraRig:
	return player.camera_rig if player != null else null


func snapshot() -> Dictionary:
	var display := {"visible": false, "meshPath": "", "local": [0.0, 0.0, 0.0]}
	var attached := false
	var aligned := false
	var forward_dot := 0.0
	var weapon_global := [0.0, 0.0, 0.0]
	var camera_global := [0.0, 0.0, 0.0]
	var rig := camera_rig()
	if equipment_visuals != null:
		display = equipment_visuals.snapshot()
		var model := equipment_visuals.model()
		if model != null and rig != null:
			attached = model.global_transform.is_equal_approx(rig.camera.global_transform * model.transform)
			forward_dot = model.global_transform.basis.z.dot(rig.camera_basis().z)
			aligned = forward_dot > 0.99
			weapon_global = [model.global_position.x, model.global_position.y, model.global_position.z]
	if rig != null:
		camera_global = [rig.camera.global_position.x, rig.camera.global_position.y, rig.camera.global_position.z]
	var definition := equipment_state.definition() if equipment_state != null else null
	var viewport_size := get_viewport().get_visible_rect().size
	return {
		"base": base_id,
		"baseVersion": base_version,
		"worldId": world_id,
		"levelTitle": level_title,
		"viewportSize": [viewport_size.x, viewport_size.y],
		"windowSize": [get_window().size.x, get_window().size.y],
		"equipment": {
			"active": String(equipment_state.active_id) if equipment_state != null else "",
			"displayName": definition.display_name if definition != null else "",
			"attackMode": definition.attack_mode_name() if definition != null else "NONE",
			"damage": definition.damage if definition != null else 0.0,
			"cooldownSeconds": definition.cooldown_seconds if definition != null else 0.0,
			"crosshairVisible": definition.crosshair_visible if definition != null else false,
			"magazine": equipment_state.magazine() if equipment_state != null else 0,
			"capacity": equipment_state.capacity() if equipment_state != null else 0,
			"reserve": equipment_state.reserve() if equipment_state != null else 0,
			"cooldownRemaining": equipment_state.cooldown_remaining() if equipment_state != null else 0.0,
			"reloading": equipment_state.is_reloading() if equipment_state != null else false,
			"blockReason": equipment_state.attack_block_reason() if equipment_state != null else "no-equipment-state",
		},
		"display": {
			"visible": display.get("visible", false),
			"meshPath": display.get("meshPath", ""),
			"local": display.get("local", [0.0, 0.0, 0.0]),
			"global": weapon_global,
			"cameraGlobal": camera_global,
			"attachedToCamera": attached,
			"alignedWithCamera": aligned,
			"forwardDot": forward_dot,
		},
		"crosshair": crosshair.measure() if crosshair != null else {},
		"player": player.snapshot() if player != null else {},
		"aim": aim_query.snapshot() if aim_query != null else {},
		"inventory": inventory.snapshot() if inventory != null else {"slots": []},
		"quests": quest_tracker.snapshot() if quest_tracker != null else {"quests": []},
		"hud": hud.snapshot() if hud != null else {},
		"targets": world_state.collect("base_targets") if world_state != null else [],
		"interactables": world_state.collect("base_interactables") if world_state != null else [],
		"inputCaptured": player.captured if player != null else false,
		"hasSave": save_store.has_state() if save_store != null else false,
		"persistentStorage": OS.is_userfs_persistent(),
	}
