class_name TargetDummy
extends StaticBody3D

## A destructible training target. Damage, health and the destroyed flag are
## real gameplay state and are preserved across a save and restart.

signal damaged(target: TargetDummy, amount: float, remaining: float)
signal destroyed(target: TargetDummy)
signal restored(target: TargetDummy)

@export var target_id: StringName = &"target"
@export var display_name: String = "Target"
@export var max_health := 50.0
var _hit_flash_explicit := false
var _applying_balance_flash := false
@export var hit_flash_seconds := 0.12:
	set(value):
		hit_flash_seconds = value
		if not _applying_balance_flash:
			_hit_flash_explicit = true

@onready var mesh_instance: MeshInstance3D = get_node_or_null("Mesh")
@onready var collision: CollisionShape3D = get_node_or_null("Collision")

var health := 0.0
var is_destroyed := false
var hit_count := 0
var damage_taken := 0.0
var _flash_remaining := 0.0
var _base_material: Material


## Script initialization bypasses the setter; scene assignments, including an
## explicit 0.12, call it. Balance updates must not become instance overrides.
func apply_balance_hit_flash_seconds(value: float) -> void:
	if not _hit_flash_explicit:
		_applying_balance_flash = true
		hit_flash_seconds = value
		_applying_balance_flash = false


func _ready() -> void:
	health = max_health
	if mesh_instance != null:
		_base_material = mesh_instance.material_override
	add_to_group("base_targets")


func _process(delta: float) -> void:
	if _flash_remaining <= 0.0:
		return
	_flash_remaining = maxf(0.0, _flash_remaining - delta)
	if _flash_remaining == 0.0 and mesh_instance != null:
		mesh_instance.material_override = _base_material


func apply_damage(amount: float, context: Dictionary = {}) -> Dictionary:
	if is_destroyed or amount <= 0.0 or not is_finite(amount):
		return {"applied": 0.0, "remaining": health, "destroyed": is_destroyed}
	var applied := minf(amount, health)
	health = maxf(0.0, health - applied)
	damage_taken += applied
	hit_count += 1
	_flash()
	damaged.emit(self, applied, health)
	if health <= 0.0 and not is_destroyed:
		is_destroyed = true
		destroyed.emit(self)
	return {"applied": applied, "remaining": health, "destroyed": is_destroyed, "point": context.get("point", global_position)}


func _flash() -> void:
	_flash_remaining = hit_flash_seconds
	if mesh_instance != null:
		var material := StandardMaterial3D.new()
		material.albedo_color = Color(1.0, 0.55, 0.35)
		material.emission_enabled = true
		material.emission = Color(0.9, 0.35, 0.1)
		material.emission_energy_multiplier = 1.6
		mesh_instance.material_override = material


func reset() -> void:
	health = max_health
	is_destroyed = false
	hit_count = 0
	damage_taken = 0.0
	visible = true
	if collision != null:
		collision.disabled = false


func snapshot() -> Dictionary:
	return {
		"id": String(target_id),
		"health": health,
		"destroyed": is_destroyed,
		"hitCount": hit_count,
		"damageTaken": damage_taken,
	}


func state_id() -> String:
	return String(target_id)


## Returns "" on success, otherwise why the saved target was rejected.
func restore(data: Dictionary) -> String:
	var saved_health = data.get("health")
	if not (saved_health is float or saved_health is int) or not is_finite(float(saved_health)) or float(saved_health) < 0.0:
		return String(target_id) + ": saved health is invalid"
	var saved_destroyed = data.get("destroyed")
	if not saved_destroyed is bool:
		return String(target_id) + ": saved destroyed flag is invalid"
	if bool(saved_destroyed) != (float(saved_health) <= 0.0):
		return String(target_id) + ": saved health and destroyed flag disagree"
	var saved_hits = data.get("hitCount", 0)
	var saved_damage = data.get("damageTaken", 0.0)
	if not (saved_hits is float or saved_hits is int) or not is_finite(float(saved_hits)) or float(saved_hits) != floorf(float(saved_hits)) or float(saved_hits) < 0.0:
		return String(target_id) + ": saved hit count is invalid"
	if not (saved_damage is float or saved_damage is int) or not is_finite(float(saved_damage)) or float(saved_damage) < 0.0:
		return String(target_id) + ": saved damage total is invalid"
	# max_health is source and may be lowered; clamp instead of discarding progress.
	health = minf(float(saved_health), max_health)
	is_destroyed = bool(saved_destroyed)
	hit_count = int(saved_hits)
	damage_taken = float(saved_damage)
	visible = true
	if collision != null:
		collision.disabled = false
	if mesh_instance != null:
		mesh_instance.material_override = _base_material
	restored.emit(self)
	return ""
