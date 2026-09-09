class_name QuestTracker
extends Node

## Minimal but real quest state. Progress is driven by actual gameplay signals
## (real damage, real destroyed targets) and the completion reward is granted
## exactly once, including across a save and restart.

signal quest_changed(id: StringName, entry: Dictionary)
signal quest_completed(id: StringName, entry: Dictionary)

const STATUS_INACTIVE := 0
const STATUS_ACTIVE := 1
const STATUS_COMPLETED := 2

@export var quests: Array[QuestDefinition] = []

var equipment_state: EquipmentState
var inventory: Inventory
var attack_dispatcher: AttackDispatcher

var progress: Dictionary = {}


func _ready() -> void:
	for definition in quests:
		if definition == null:
			continue
		progress[definition.id] = {"status": STATUS_ACTIVE, "count": 0.0, "rewardGranted": false}


func bind_world(world: BaseWorld) -> void:
	equipment_state = world.equipment_state
	inventory = world.inventory
	attack_dispatcher = world.attack_dispatcher
	if attack_dispatcher != null and not attack_dispatcher.damage_dealt.is_connected(_on_damage_dealt):
		attack_dispatcher.damage_dealt.connect(_on_damage_dealt)
	if not get_tree().node_added.is_connected(_on_node_added):
		get_tree().node_added.connect(_on_node_added)
	call_deferred("_connect_targets")


## Targets authored later (or spawned by gameplay) must still count.
func _on_node_added(node: Node) -> void:
	if node.is_in_group("base_targets") and node.has_signal("destroyed") and not node.destroyed.is_connected(_on_target_destroyed):
		node.destroyed.connect(_on_target_destroyed)


func _connect_targets() -> void:
	for target in get_tree().get_nodes_in_group("base_targets"):
		if target.has_signal("destroyed") and not target.destroyed.is_connected(_on_target_destroyed):
			target.destroyed.connect(_on_target_destroyed)


func _on_target_destroyed(_target: Node) -> void:
	record(QuestDefinition.Objective.DESTROY_TARGETS, 1.0)


func _on_damage_dealt(_target: Object, amount: float, _point: Vector3) -> void:
	record(QuestDefinition.Objective.LAND_HITS, 1.0)
	record(QuestDefinition.Objective.DEAL_DAMAGE, amount)


func definition_for(id: StringName) -> QuestDefinition:
	for definition in quests:
		if definition != null and definition.id == id:
			return definition
	return null


func record(objective: QuestDefinition.Objective, amount: float) -> void:
	for definition in quests:
		if definition == null or definition.objective != objective:
			continue
		var entry: Dictionary = progress.get(definition.id, {})
		if entry.is_empty() or int(entry.status) != STATUS_ACTIVE:
			continue
		entry.count = minf(float(entry.count) + amount, definition.required_count)
		if float(entry.count) >= definition.required_count:
			_complete(definition, entry)
		quest_changed.emit(definition.id, entry.duplicate(true))


func _complete(definition: QuestDefinition, entry: Dictionary) -> void:
	# Grant first, complete second. If a reward cannot be stored (full bag, no
	# ammunition item available) the quest stays active and will be retried on the
	# next matching event, instead of silently losing the reward.
	var granted := true
	if definition.reward_reserve_rounds > 0:
		if equipment_state == null:
			granted = false
		elif equipment_state.add_reserve(definition.reward_reserve_rounds) <= 0:
			granted = false
	if not definition.reward_item.is_empty():
		if inventory == null:
			granted = false
		elif inventory.add(definition.reward_item, definition.reward_item_amount) <= 0:
			granted = false
	if not granted:
		return
	entry.status = STATUS_COMPLETED
	entry.rewardGranted = true
	quest_completed.emit(definition.id, entry.duplicate(true))


func active_titles() -> Array[String]:
	var titles: Array[String] = []
	for definition in quests:
		if definition == null:
			continue
		var entry: Dictionary = progress.get(definition.id, {})
		if int(entry.get("status", STATUS_INACTIVE)) == STATUS_ACTIVE:
			titles.append(definition.title)
	return titles


func snapshot() -> Dictionary:
	var entries := []
	for definition in quests:
		if definition == null:
			continue
		var entry: Dictionary = progress.get(definition.id, {"status": STATUS_INACTIVE, "count": 0.0, "rewardGranted": false})
		entries.append({
			"id": String(definition.id),
			"status": int(entry.status),
			"count": float(entry.count),
			"rewardGranted": bool(entry.rewardGranted),
		})
	return {"quests": entries}


## Returns "" on success, otherwise why the saved quest state was rejected.
func restore(data: Dictionary) -> String:
	if not data.get("quests") is Array:
		return "Quest state has no entry list"
	var restored := {}
	for entry in data.quests:
		if not entry is Dictionary:
			return "Quest entry is not an object"
		var id := StringName(str(entry.get("id", "")))
		var definition := definition_for(id)
		if definition == null:
			return "Unknown quest in state: " + String(id)
		var status = entry.get("status")
		if not (status is float or status is int) or int(status) < STATUS_INACTIVE or int(status) > STATUS_COMPLETED:
			return String(id) + ": saved status is invalid"
		var count = entry.get("count")
		if not (count is float or count is int) or not is_finite(float(count)) or float(count) < 0.0 or float(count) > definition.required_count:
			return String(id) + ": saved progress is invalid"
		var rewarded = entry.get("rewardGranted")
		if not rewarded is bool:
			return String(id) + ": saved reward flag is invalid"
		if bool(rewarded) and int(status) != STATUS_COMPLETED:
			return String(id) + ": saved reward flag contradicts the status"
		if restored.has(id):
			return "Quest entry is duplicated: " + String(id)
		restored[id] = {"status": int(status), "count": float(count), "rewardGranted": bool(rewarded)}
	for definition in quests:
		if definition != null and not restored.has(definition.id):
			return "State is missing quest: " + String(definition.id)
	progress = restored
	return ""
