# A talking character. Lines come from res://data/npcs/<id>.json and can depend on
# quest status, so the same NPC reacts differently before and after delivery.
class_name Npc
extends Interactable

@export var npc_id: String = ""
@export var quest_id: String = ""

var dialogue: Dictionary = {}


func _ready() -> void:
	super()
	dialogue = Game.npc_data(npc_id)
	if not quest_id.is_empty():
		Game.state.ensure_quest(quest_id)


func current_line() -> String:
	var status := "inactive"
	if not quest_id.is_empty():
		status = Game.state.quest_status(quest_id)
	var fallback := ""
	for entry in dialogue.get("lines", []):
		if not entry is Dictionary:
			continue
		var text := String(entry.get("text", ""))
		if fallback.is_empty():
			fallback = text
		var when := String(entry.get("when", "always"))
		# First matching line wins; authors order specific conditions first.
		if when == "always" or when == status:
			return text
	return fallback


func talk(actor: Node) -> Dictionary:
	if not in_range(actor):
		return {"ok": false, "reason": "out_of_range", "npcId": npc_id}
	return {
		"ok": true,
		"npcId": npc_id,
		"name": String(dialogue.get("name", npc_id)),
		"line": current_line(),
		"questId": quest_id,
		"questStatus": Game.state.quest_status(quest_id),
	}
