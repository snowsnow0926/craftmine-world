extends Node3D

## Optional player health for authored sandbox combat modules. The existing
## native player save remains unchanged; this state uses the component ledger.
const FORMAT := "craftmine.combat-vitals-state/1"
const GROUP := "craftmine_player_vitals"
@export var entity_id := ""
@export var player_path := NodePath("../Player")
@export_range(1, 999999) var maximum_health := 100
var health := 100.0
var _player: Node3D
var _source: Dictionary
var _identity := ""
var _label: Label

func _ready() -> void:
	_identity = entity_id
	_source = JSON.parse_string(JSON.stringify({"maximumHealth": maximum_health}))
	_source.make_read_only()
	health = float(maximum_health)
	_player = get_node_or_null(player_path) as Node3D
	add_to_group("craftmine_persistent_components")
	add_to_group(GROUP)
	if not _configuration_error().is_empty(): return
	var canvas := CanvasLayer.new()
	add_child(canvas)
	_label = Label.new()
	canvas.add_child(_label)
	_label.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	_label.offset_left = -220
	_label.offset_top = 18
	_label.offset_right = -18
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_sync()

func _configuration_error() -> String:
	var pattern := RegEx.new()
	pattern.compile("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
	var matched := pattern.search(_identity)
	if matched == null or matched.get_string() != _identity or entity_id != _identity:
		return "VITALS_IDENTITY_INVALID"
	if maximum_health < 1 or maximum_health > 999999 or not is_instance_valid(_player) or not _player.has_method("set_movement_lock"):
		return "VITALS_CONFIGURATION_INVALID"
	for peer in get_tree().get_nodes_in_group(GROUP):
		if peer != self and peer.get("_player") == _player:
			return "VITALS_DUPLICATE_PLAYER"
	return ""

func _sync() -> void:
	if is_instance_valid(_player) and _player.has_method("set_movement_lock"):
		_player.set_movement_lock(self, health <= 0.0)
	if is_instance_valid(_label):
		_label.text = "生命 %d / %d%s" % [ceili(health), maximum_health, " · 已倒下" if health <= 0.0 else ""]

func take_damage(amount: float) -> float:
	if get_tree().paused or not _configuration_error().is_empty() or not is_finite(amount) or amount <= 0.0 or health <= 0.0:
		return 0.0
	var applied := minf(amount, health)
	health -= applied
	_sync()
	return applied

func revive() -> bool:
	if get_tree().paused or not _configuration_error().is_empty() or health > 0.0: return false
	health = float(maximum_health)
	_sync()
	return true

func snapshot() -> Dictionary:
	return JSON.parse_string(JSON.stringify({"format": FORMAT, "entityId": _identity, "settings": _source, "sourceSettings": _source, "health": health}))

func validate_state(data: Dictionary) -> String:
	var problem := _configuration_error()
	if not problem.is_empty(): return problem
	var fields := ["format", "entityId", "settings", "sourceSettings", "health"]
	if data.size() != fields.size() or not fields.all(func(key): return data.has(key)) or data.format != FORMAT or data.entityId != _identity:
		return "VITALS_STATE_IDENTITY_INVALID"
	if data.settings != _source or data.sourceSettings != _source:
		return "VITALS_SOURCE_SETTINGS_CHANGED"
	var value: Variant = data.health
	if not (value is int or value is float) or not is_finite(float(value)) or value < 0 or value > maximum_health:
		return "VITALS_HEALTH_INVALID"
	return ""

func restore(data: Dictionary) -> String:
	var problem := validate_state(data)
	if not problem.is_empty(): return problem
	health = float(data.health)
	_sync()
	return ""

func _exit_tree() -> void:
	if is_instance_valid(_player) and _player.has_method("set_movement_lock"):
		_player.set_movement_lock(self, false)
