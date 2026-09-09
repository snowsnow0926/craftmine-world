class_name Interactable
extends StaticBody3D

## Base class for anything the player can point at and use. AimQuery calls these
## methods; a world only has to add a script with them to become interactable.

signal interacted(result: Dictionary)

@export var prompt := "Interact"
@export var enabled := true


func can_interact() -> bool:
	return enabled


func interaction_prompt() -> String:
	return prompt if can_interact() else ""


## Stable identity used by saved state, independent of node name uniqueness.
## Empty by default so existing scenes keep their node-name identity.
@export var entity_id: String = ""

func state_id() -> String:
	return entity_id if not entity_id.is_empty() else name


func interact() -> Dictionary:
	return {"handled": false, "reason": "not-implemented"}


func snapshot() -> Dictionary:
	return {"enabled": enabled}


func restore(data: Dictionary) -> String:
	var saved = data.get("enabled", true)
	if not saved is bool:
		return name + ": saved enabled flag is invalid"
	enabled = bool(saved)
	return ""
