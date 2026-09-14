extends Node3D

const Core = preload("res://addons/cw.module.promo-monsters/core.gd")
@export var entity_id := "promo-monsters"
@export var player_path := NodePath("Player")
@export var camera_path := NodePath("Player/CameraRig/PitchPivot/Camera3D")
@export var saved_position_min := Vector3(-80, -1, -80)
@export var saved_position_max := Vector3(80, 20, 80)
var context: Node3D

func _enter_tree() -> void:
	# Root identity is assigned by the source installer before entering the tree.
	# Hashing keeps child identities under the component ledger's length limit.
	for child in get_children():
		if child.has_method("take_hit"):
			child.entity_id = "promo-monster-" + (entity_id + "/" + str(child.name)).sha256_text().substr(0, 24)
	context = Core.acquire(self, Core, player_path, camera_path)
	if context == null:
		process_mode = Node.PROCESS_MODE_DISABLED
		return

func _ready() -> void:
	if context == null: return
	for child in get_children():
		if child.has_method("take_hit"): context.monsters.append(child)
	context._notice("树林边出现了角怪。靠近后小心它们的蓄力攻击。")
	add_to_group("craftmine_persistent_components")
	var problem := validate_state(snapshot())
	if not problem.is_empty(): push_error(problem)

func snapshot() -> Dictionary:
	return {"format": "craftmine.promo-encounter/1", "entityId": entity_id,
		"settings": {}, "sourceSettings": {}}

func validate_state(data: Dictionary) -> String:
	if context == null or not context.configuration_error.is_empty(): return "PROMO_CONTEXT_REQUIRED"
	if data != snapshot(): return "PROMO_ENCOUNTER_STATE_INVALID"
	if not global_basis.is_equal_approx(Basis.IDENTITY): return "PROMO_ENCOUNTER_AXIS_ALIGNED_UNIT_SCALE_REQUIRED"
	if not saved_position_min.is_finite() or not saved_position_max.is_finite(): return "PROMO_POSITION_BOUNDS_INVALID"
	for i in range(3):
		if saved_position_min[i] >= saved_position_max[i] or absf(saved_position_min[i]) > 100000 or absf(saved_position_max[i]) > 100000:
			return "PROMO_POSITION_BOUNDS_INVALID"
	for child in get_children():
		if not child.has_method("take_hit"): continue
		var initial: Vector3 = child.home
		if initial.x - 14 < saved_position_min.x or initial.x + 14 > saved_position_max.x or initial.z - 14 < saved_position_min.z or initial.z + 14 > saved_position_max.z:
			return "PROMO_ENCOUNTER_FOOTPRINT_OUTSIDE_CONFIGURED_BOUNDS"
	return ""

func restore(data: Dictionary) -> String:
	return validate_state(data)

func _exit_tree() -> void:
	if not is_instance_valid(context): return
	for child in get_children(): context.monsters.erase(child)
