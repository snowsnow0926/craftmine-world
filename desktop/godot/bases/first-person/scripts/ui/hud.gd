class_name Hud
extends CanvasLayer

## Live readout of the same state the gameplay uses: equipped item, magazine and
## reserve, cooldown, aim prompt, quest progress, health and damage feedback.

var equipment_state: EquipmentState
var aim_query: AimQuery
var attack_dispatcher: AttackDispatcher
var quest_tracker: QuestTracker
var inventory: Inventory
var player: PlayerController

@onready var equipment_label: Label = get_node_or_null("Root/EquipmentLabel")
@onready var ammo_label: Label = get_node_or_null("Root/AmmoLabel")
@onready var status_label: Label = get_node_or_null("Root/StatusLabel")
@onready var prompt_label: Label = get_node_or_null("Root/PromptLabel")
@onready var quest_label: Label = get_node_or_null("Root/QuestLabel")
@onready var inventory_label: Label = get_node_or_null("Root/InventoryLabel")
@onready var cooldown_bar: ProgressBar = get_node_or_null("Root/CooldownBar")
@onready var damage_popup: Label = get_node_or_null("Root/DamagePopup")
@onready var message_label: Label = get_node_or_null("Root/MessageLabel")
@onready var health_label: Label = get_node_or_null("Root/HealthLabel")

var last_damage_amount := 0.0
var last_message := ""


func bind_world(world: BaseWorld) -> void:
	equipment_state = world.equipment_state
	aim_query = world.aim_query
	attack_dispatcher = world.attack_dispatcher
	quest_tracker = world.quest_tracker
	inventory = world.inventory
	player = world.player
	if equipment_state != null:
		if not equipment_state.equipment_changed.is_connected(_on_equipment_changed):
			equipment_state.equipment_changed.connect(_on_equipment_changed)
		if not equipment_state.ammo_changed.is_connected(_on_ammo_changed):
			equipment_state.ammo_changed.connect(_on_ammo_changed)
		if not equipment_state.cooldown_changed.is_connected(_on_cooldown_changed):
			equipment_state.cooldown_changed.connect(_on_cooldown_changed)
		if not equipment_state.reload_changed.is_connected(_on_reload_changed):
			equipment_state.reload_changed.connect(_on_reload_changed)
	if attack_dispatcher != null:
		if not attack_dispatcher.damage_dealt.is_connected(_on_damage_dealt):
			attack_dispatcher.damage_dealt.connect(_on_damage_dealt)
		if not attack_dispatcher.attack_blocked.is_connected(_on_attack_blocked):
			attack_dispatcher.attack_blocked.connect(_on_attack_blocked)
	if quest_tracker != null:
		if not quest_tracker.quest_changed.is_connected(_on_quest_changed):
			quest_tracker.quest_changed.connect(_on_quest_changed)
		if not quest_tracker.quest_completed.is_connected(_on_quest_completed):
			quest_tracker.quest_completed.connect(_on_quest_completed)
	if inventory != null and not inventory.changed.is_connected(_refresh_inventory):
		inventory.changed.connect(_refresh_inventory)
	_refresh_all()


func _process(_delta: float) -> void:
	_refresh_health()
	_refresh_prompt()
	_refresh_cooldown()


func _refresh_all() -> void:
	_refresh_health()
	if equipment_state != null:
		_on_equipment_changed(equipment_state.active_id, equipment_state.definition())
		_on_ammo_changed(equipment_state.active_id, equipment_state.magazine(), equipment_state.capacity(), equipment_state.reserve())
		_on_cooldown_changed(equipment_state.active_id, equipment_state.cooldown_remaining(), 0.0)
	_refresh_quests()
	_refresh_inventory()

func _refresh_health() -> void:
	if health_label == null or player == null:
		return
	health_label.text = "生命 %d / %d%s" % [int(roundf(player.health)), int(roundf(player.max_health)), "  ·  已倒下" if player.dead else ""]
	health_label.modulate = Color(1.0, 0.35, 0.3) if player.dead else Color(0.7, 1.0, 0.7)


func _on_equipment_changed(_id: StringName, definition: EquipmentDefinition) -> void:
	if equipment_label == null:
		return
	if definition == null:
		equipment_label.text = "No equipment"
		return
	equipment_label.text = "%s  ·  %s" % [definition.display_name, definition.attack_mode_name()]


func _on_ammo_changed(_id: StringName, magazine: int, capacity: int, reserve: int) -> void:
	if ammo_label == null:
		return
	if capacity <= 0:
		ammo_label.text = "∞"
		return
	ammo_label.text = "%d / %d   reserve %d" % [magazine, capacity, reserve]


func _on_cooldown_changed(_id: StringName, remaining: float, _total: float) -> void:
	if status_label == null or equipment_state == null:
		return
	var reason := equipment_state.attack_block_reason()
	if reason.is_empty():
		status_label.text = "Ready"
		status_label.modulate = Color(0.7, 1.0, 0.7)
	elif reason == "cooling-down":
		status_label.text = "Cooling down %.2fs" % remaining
		status_label.modulate = Color(1.0, 0.85, 0.4)
	elif reason == "reloading":
		status_label.text = "Reloading"
		status_label.modulate = Color(1.0, 0.85, 0.4)
	elif reason == "empty":
		status_label.text = "Magazine empty  [R]"
		status_label.modulate = Color(1.0, 0.5, 0.4)
	else:
		status_label.text = reason
		status_label.modulate = Color(0.8, 0.8, 0.8)


func _on_reload_changed(_id: StringName, reloading: bool, progress: float) -> void:
	if status_label == null:
		return
	if reloading:
		status_label.text = "Reloading %d%%" % int(progress * 100.0)
		status_label.modulate = Color(1.0, 0.85, 0.4)


func _refresh_cooldown() -> void:
	if cooldown_bar == null or equipment_state == null:
		return
	cooldown_bar.value = (1.0 - equipment_state.cooldown_ratio()) * 100.0


func _refresh_prompt() -> void:
	if prompt_label == null or aim_query == null:
		return
	prompt_label.text = aim_query.prompt()


func _on_damage_dealt(_target: Object, amount: float, _point: Vector3) -> void:
	last_damage_amount = amount
	if damage_popup == null:
		return
	damage_popup.text = "-%d" % int(roundf(amount))
	damage_popup.modulate = Color(1.0, 0.65, 0.35, 1.0)
	var tween := create_tween()
	tween.tween_property(damage_popup, "position:y", damage_popup.position.y - 26.0, 0.45)
	tween.parallel().tween_property(damage_popup, "modulate:a", 0.0, 0.45)


func _on_attack_blocked(reason: String) -> void:
	show_message("Cannot attack: " + reason)


func _on_quest_changed(_id: StringName, _entry: Dictionary) -> void:
	_refresh_quests()


func _on_quest_completed(id: StringName, _entry: Dictionary) -> void:
	show_message("Quest complete: " + String(id))


func _refresh_quests() -> void:
	if quest_label == null or quest_tracker == null:
		return
	var lines: Array[String] = []
	for definition in quest_tracker.quests:
		if definition == null:
			continue
		var entry: Dictionary = quest_tracker.progress.get(definition.id, {})
		var status := int(entry.get("status", QuestTracker.STATUS_INACTIVE))
		var count := float(entry.get("count", 0.0))
		if status == QuestTracker.STATUS_COMPLETED:
			lines.append("✔ " + definition.title)
		else:
			lines.append("%s  %d/%d" % [definition.title, int(count), int(definition.required_count)])
	quest_label.text = "\n".join(lines)


func _refresh_inventory() -> void:
	if inventory_label == null or inventory == null:
		return
	var parts: Array[String] = []
	for slot in inventory.snapshot().slots:
		parts.append("%s x%d" % [slot.id, slot.count])
	inventory_label.text = "Bag: " + ("empty" if parts.is_empty() else ", ".join(parts))


func show_message(text: String) -> void:
	last_message = text
	if message_label == null:
		return
	message_label.text = text
	message_label.modulate = Color(1.0, 1.0, 1.0, 1.0)
	var tween := create_tween()
	tween.tween_interval(1.2)
	tween.tween_property(message_label, "modulate:a", 0.0, 0.6)


func snapshot() -> Dictionary:
	return {
		"health": health_label.text if health_label != null else "",
		"equipment": equipment_label.text if equipment_label != null else "",
		"ammo": ammo_label.text if ammo_label != null else "",
		"status": status_label.text if status_label != null else "",
		"prompt": prompt_label.text if prompt_label != null else "",
		"quests": quest_label.text if quest_label != null else "",
		"inventory": inventory_label.text if inventory_label != null else "",
		"lastDamage": last_damage_amount,
		"message": last_message,
	}
