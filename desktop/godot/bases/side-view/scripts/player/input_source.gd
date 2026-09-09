## Input contract consumed by the player controller.
##
## The controller only ever reads this interface, so a human session and a
## headless acceptance run drive the exact same code path. That is what makes
## "real physics reachability" meaningful: the harness presses buttons, it never
## moves the player.
class_name InputSource
extends RefCounted

var move_axis: float = 0.0
var jump_held: bool = false
var jump_pressed: bool = false
var attack_pressed: bool = false
var interact_pressed: bool = false
var source_name: String = "none"

## Refresh the values for this frame. Called once per physics tick before the
## controller runs.
func poll(_delta: float) -> void:
	pass
