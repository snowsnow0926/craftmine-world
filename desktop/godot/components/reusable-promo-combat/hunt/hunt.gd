extends Node3D

const Core = preload("res://addons/cw.module.promo-hunt/core.gd")
const Contract = preload("res://scripts/scene_contract.gd")
@export var entity_id := "promo-hunt"
@export var player_path := NodePath("Player")
@export var camera_path := NodePath("Player/CameraRig/PitchPivot/Camera3D")
var context: Node3D
var blade: Node3D
var configuration_error := ""
@onready var boss: CharacterBody3D = $Riftbeast

func _ready() -> void:
	context = Core.acquire(self, Core, player_path, camera_path)
	call_deferred("_bind")

func _bind() -> void:
	if context == null: return
	blade = context.module("blade")
	if blade == null:
		configuration_error = "PROMO_HUNT_REQUIRES_HEAVYBLADE"
	else:
		configuration_error = context.register_module("hunt", self)
	if configuration_error.is_empty():
		boss.arena = blade
		boss.hunter = context.player
		boss.set_meta("entity_id", "promo-beast-" + entity_id.sha256_text().substr(0, 24))
		configuration_error = blade.bind_hunt(self)
	add_to_group("craftmine_persistent_components")
	if not configuration_error.is_empty(): push_error(configuration_error)

func validate_placement() -> String:
	if not global_basis.is_equal_approx(Basis.IDENTITY): return "PROMO_ARENA_AXIS_ALIGNED_UNIT_SCALE_REQUIRED"
	if not global_position.is_finite(): return "PROMO_ARENA_POSITION_INVALID"
	for i in range(3):
		if absf(global_position[i]) > 100000: return "PROMO_ARENA_POSITION_INVALID"
	# Actual arena interior must be flat and clear. This reads physics only;
	# it never deletes obstacles, reshapes terrain or relocates a player.
	for x in [-10.0, -5.0, 0.0, 5.0, 10.0]:
		for z in [-13.0, -6.5, 0.0, 6.5, 13.0]:
			var point := global_position + Vector3(x, 0, z)
			var hit := get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(point + Vector3.UP * 0.15, point - Vector3.UP * 0.15, 3))
			if hit.is_empty() or absf(hit.position.y - global_position.y) > 0.05 or hit.normal.dot(Vector3.UP) < 0.99:
				return "PROMO_ARENA_REQUIRES_FLAT_SUPPORTED_FOOTPRINT"
	var shape := BoxShape3D.new()
	shape.size = Vector3(21.5, 4.4, 27.5)
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = shape
	query.transform = Transform3D(Basis.IDENTITY, global_position + Vector3(0, 2.35, 0))
	query.collision_mask = 3
	query.exclude = [boss.get_rid()]
	if not get_world_3d().direct_space_state.intersect_shape(query, 1).is_empty(): return "PROMO_ARENA_FOOTPRINT_OBSTRUCTED"
	return ""

func snapshot() -> Dictionary:
	return {"format":"craftmine.promo-hunt/1", "entityId":entity_id,
		"settings":{"difficulty":"hard"}, "sourceSettings":{"difficulty":"hard"}, "boss":boss.snapshot()}

func validate_state(data: Dictionary) -> String:
	if not configuration_error.is_empty(): return configuration_error
	if blade == null: return "PROMO_HUNT_REQUIRES_HEAVYBLADE"
	if not Contract.fields(data, ["format","entityId","settings","sourceSettings","boss"]): return "PROMO_HUNT_STATE_FIELDS_INVALID"
	if data.format != "craftmine.promo-hunt/1" or data.entityId != entity_id: return "PROMO_HUNT_IDENTITY_MISMATCH"
	for key in ["settings", "sourceSettings"]:
		if data[key] != {"difficulty":"hard"}: return "PROMO_HUNT_SETTINGS_MISMATCH"
	if not data.boss is Dictionary: return "PROMO_BEAST_STATE_REQUIRED"
	var problem: String = boss.validate_state(data.boss)
	if not problem.is_empty(): return problem
	return validate_placement()

func restore(data: Dictionary) -> String:
	var problem := validate_state(data)
	if not problem.is_empty(): return problem
	return boss.restore(data.boss)

func validate_restored_state() -> String:
	if blade.status == "active" and (blade.health <= 0 or boss.health <= 0): return "PROMO_ACTIVE_TRIAL_DEFEATED_ACTOR"
	if blade.status == "won" and boss.health != 0: return "PROMO_WON_TRIAL_BOSS_MISMATCH"
	return ""
