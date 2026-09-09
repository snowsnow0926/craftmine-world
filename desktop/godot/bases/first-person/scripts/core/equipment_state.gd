class_name EquipmentState
extends Node

## The single source of truth for the equipped item, its ammunition and its
## cooldown. The crosshair, the displayed model, the HUD and the attack
## dispatcher all observe this node instead of keeping their own copy.

signal equipment_changed(id: StringName, definition: EquipmentDefinition)
signal ammo_changed(id: StringName, magazine: int, capacity: int, reserve: int)
signal cooldown_changed(id: StringName, remaining: float, total: float)
signal reload_changed(id: StringName, reloading: bool, progress: float)

@export var catalog: EquipmentCatalog

var active_id: StringName = &""
var _magazine: Dictionary = {}
var _reserve: Dictionary = {}
var _cooldown_remaining := 0.0
var _cooldown_total := 0.0
var _reload_remaining := 0.0
var _reload_total := 0.0


func _ready() -> void:
	if catalog == null:
		push_error("EquipmentState requires an EquipmentCatalog")
		set_physics_process(false)
		return
	var problem := catalog.validate()
	if not problem.is_empty():
		push_error("Equipment catalog is invalid: " + problem)
		set_physics_process(false)
		return
	for definition in catalog.items:
		_magazine[definition.id] = definition.initial_ammo()
		_reserve[definition.id] = maxi(0, definition.starting_reserve)
	var initial := catalog.default_id
	if initial.is_empty():
		initial = catalog.items[0].id
	set_physics_process(true)
	equip(initial)


func _physics_process(delta: float) -> void:
	var ticked := false
	if _cooldown_remaining > 0.0:
		_cooldown_remaining = maxf(0.0, _cooldown_remaining - delta)
		ticked = true
	if _reload_remaining > 0.0:
		_reload_remaining = maxf(0.0, _reload_remaining - delta)
		if _reload_remaining <= 0.0:
			_finish_reload()
		ticked = true
	if ticked:
		cooldown_changed.emit(active_id, _cooldown_remaining, _cooldown_total)
		reload_changed.emit(active_id, is_reloading(), reload_progress())


# --------------------------------------------------------------------------
# Queries
# --------------------------------------------------------------------------

func definition() -> EquipmentDefinition:
	if catalog == null:
		return null
	return catalog.definition_for(active_id)


func definition_for(id: StringName) -> EquipmentDefinition:
	if catalog == null:
		return null
	return catalog.definition_for(id)


func magazine() -> int:
	return int(_magazine.get(active_id, 0))


func reserve() -> int:
	return int(_reserve.get(active_id, 0))


func capacity() -> int:
	var definition := definition()
	return definition.magazine_size if definition != null else 0


func cooldown_remaining() -> float:
	return _cooldown_remaining


func cooldown_ratio() -> float:
	if _cooldown_total <= 0.0:
		return 0.0
	return clampf(_cooldown_remaining / _cooldown_total, 0.0, 1.0)


func is_reloading() -> bool:
	return _reload_remaining > 0.0


func reload_progress() -> float:
	if _reload_total <= 0.0:
		return 1.0
	return clampf(1.0 - _reload_remaining / _reload_total, 0.0, 1.0)


## Why an attack cannot start right now: "", "no-equipment", "no-attack",
## "cooling-down", "reloading" or "empty".
func attack_block_reason() -> String:
	var definition := definition()
	if definition == null:
		return "no-equipment"
	if definition.attack_mode == EquipmentDefinition.AttackMode.NONE:
		return "no-attack"
	if _cooldown_remaining > 0.0:
		return "cooling-down"
	if is_reloading():
		return "reloading"
	if definition.uses_ammo() and magazine() <= 0:
		return "empty"
	return ""


# --------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------

func equip(id: StringName) -> bool:
	var definition := definition_for(id)
	if definition == null:
		push_warning("Unknown equipment: " + String(id))
		return false
	active_id = id
	_cooldown_remaining = 0.0
	_cooldown_total = 0.0
	_reload_remaining = 0.0
	_reload_total = 0.0
	equipment_changed.emit(active_id, definition)
	ammo_changed.emit(active_id, magazine(), capacity(), reserve())
	cooldown_changed.emit(active_id, 0.0, 0.0)
	reload_changed.emit(active_id, false, 1.0)
	return true


func equip_next() -> bool:
	if catalog == null:
		return false
	return equip(catalog.next_id(active_id))


## Consumes ammunition and starts the cooldown, then hands back the definition
## the dispatcher must execute. Returns {"ok": false, "reason": ...} otherwise.
func try_begin_attack() -> Dictionary:
	var reason := attack_block_reason()
	if not reason.is_empty():
		return {"ok": false, "reason": reason, "definition": definition()}
	var definition := definition()
	if definition.uses_ammo():
		_magazine[active_id] = magazine() - 1
		ammo_changed.emit(active_id, magazine(), capacity(), reserve())
	_cooldown_total = definition.cooldown_seconds
	_cooldown_remaining = definition.cooldown_seconds
	cooldown_changed.emit(active_id, _cooldown_remaining, _cooldown_total)
	if _cooldown_remaining <= 0.0:
		cooldown_changed.emit(active_id, 0.0, 0.0)
	return {"ok": true, "reason": "", "definition": definition}


func request_reload() -> bool:
	var definition := definition()
	if definition == null or not definition.uses_ammo():
		return false
	if is_reloading() or magazine() >= capacity() or reserve() <= 0:
		return false
	_reload_total = definition.reload_seconds
	_reload_remaining = definition.reload_seconds
	if _reload_remaining <= 0.0:
		_finish_reload()
	else:
		reload_changed.emit(active_id, true, 0.0)
	return true


## Adds rounds to the reserve of the active item. Returns how many were taken.
func add_reserve(rounds: int) -> int:
	if rounds <= 0 or definition() == null:
		return 0
	_reserve[active_id] = reserve() + rounds
	ammo_changed.emit(active_id, magazine(), capacity(), reserve())
	return rounds


func add_reserve_for(id: StringName, rounds: int) -> int:
	if rounds <= 0 or definition_for(id) == null:
		return 0
	_reserve[id] = int(_reserve.get(id, 0)) + rounds
	if id == active_id:
		ammo_changed.emit(active_id, magazine(), capacity(), reserve())
	return rounds


func _finish_reload() -> void:
	var definition := definition()
	_reload_remaining = 0.0
	_reload_total = 0.0
	if definition == null:
		return
	var moved := mini(capacity() - magazine(), reserve())
	if moved > 0:
		_magazine[active_id] = magazine() + moved
		_reserve[active_id] = reserve() - moved
	ammo_changed.emit(active_id, magazine(), capacity(), reserve())
	reload_changed.emit(active_id, false, 1.0)


# --------------------------------------------------------------------------
# Persistence
# --------------------------------------------------------------------------

func snapshot() -> Dictionary:
	var items := []
	if catalog != null:
		for definition in catalog.items:
			if definition == null:
				continue
			items.append({
				"id": String(definition.id),
				"magazine": int(_magazine.get(definition.id, 0)),
				"reserve": int(_reserve.get(definition.id, 0)),
			})
	return {"active": String(active_id), "items": items}


## Applies a saved equipment block. Returns "" on success, otherwise a message
## that explains why nothing was changed.
func restore(data: Dictionary) -> String:
	if not data.get("active") is String:
		return "Equipment state has no active item"
	if not data.get("items") is Array:
		return "Equipment state has no item list"
	var restored_magazine := {}
	var restored_reserve := {}
	for entry in data.items:
		if not entry is Dictionary:
			return "Equipment entry is not an object"
		var id := StringName(str(entry.get("id", "")))
		var definition := definition_for(id)
		if definition == null:
			return "Unknown equipment id in state: " + String(id)
		var magazine_value = entry.get("magazine")
		var reserve_value = entry.get("reserve")
		if not _is_int(magazine_value, 0, definition.magazine_size):
			return "Invalid magazine for " + String(id)
		if not _is_int(reserve_value, 0, 99999):
			return "Invalid reserve for " + String(id)
		restored_magazine[id] = int(magazine_value)
		restored_reserve[id] = int(reserve_value)
	for definition in catalog.items:
		if definition != null and not restored_magazine.has(definition.id):
			return "State is missing equipment: " + String(definition.id)
	if not equip(StringName(str(data.active))):
		return "Unknown active equipment: " + str(data.active)
	_magazine = restored_magazine
	_reserve = restored_reserve
	ammo_changed.emit(active_id, magazine(), capacity(), reserve())
	return ""


static func _is_int(value, minimum: int, maximum: int) -> bool:
	if not (value is float or value is int):
		return false
	var number := float(value)
	return is_finite(number) and number == floorf(number) and number >= float(minimum) and number <= float(maximum)
