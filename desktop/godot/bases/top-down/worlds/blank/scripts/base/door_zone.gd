# A door: walking into the region switches to another scene of the same world.
#
# The target spawn marker is placed away from the return door so a transition
# cannot immediately bounce back.
class_name DoorZone
extends TopDownZone

@export var target_scene: String = ""
@export var target_spawn: String = ""

var _transitioning := false


func _ready() -> void:
	super()
	trigger_on_enter = true


func on_trigger(body: Node) -> void:
	if _transitioning or target_scene.is_empty():
		return
	if not body.is_in_group("player"):
		return
	_transitioning = true
	# Area2D enters during a physics flush; defer removing its collision objects.
	_enter_scene.call_deferred()

func _enter_scene() -> void:
	if not is_inside_tree():
		return
	var outcome := Game.change_scene(target_scene, target_spawn)
	if not outcome.get("ok", false):
		push_error("Door transition failed: %s" % String(outcome.get("error", "unknown")))
	_transitioning = false
