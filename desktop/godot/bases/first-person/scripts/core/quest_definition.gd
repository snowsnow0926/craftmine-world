@tool
class_name QuestDefinition
extends Resource

## A small, data-driven objective. The tracker reads the objective kind and the
## required count from here, so a model can add or retune quests without editing
## scripts.

enum Objective { DESTROY_TARGETS, LAND_HITS, DEAL_DAMAGE }

@export var id: StringName = &""
@export var title: String = ""
@export_multiline var description: String = ""
@export var objective: Objective = Objective.DESTROY_TARGETS
@export var required_count := 2.0
## Rounds added to the reserve of the equipped item when the quest completes.
@export var reward_reserve_rounds := 0
## Inventory item granted exactly once when the quest completes.
@export var reward_item: StringName = &""
@export var reward_item_amount := 1


func objective_name() -> String:
	return ["DESTROY_TARGETS", "LAND_HITS", "DEAL_DAMAGE"][int(objective)]


func validate() -> String:
	if id.is_empty():
		return "Quest id is empty"
	if required_count <= 0.0 or not is_finite(required_count):
		return String(id) + ": required count must be a finite positive number"
	if reward_reserve_rounds < 0:
		return String(id) + ": reserve reward cannot be negative"
	if reward_item_amount < 0:
		return String(id) + ": item reward cannot be negative"
	return ""
