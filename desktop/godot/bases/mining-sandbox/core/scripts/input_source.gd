## Input contract consumed by the mining-sandbox player controller.
##
## The controller only ever reads this interface, so a human session and a
## headless probe drive the exact same code path. That is what makes "the probe
## presses buttons, it never moves the player" true.
class_name InputSource
extends RefCounted

var move_axis: float = 0.0
var jump_held: bool = false
var jump_pressed: bool = false
var source_name: String = "none"


## Refresh the values for this frame. Called once per physics tick before the
## controller runs.
func poll(_delta: float) -> void:
	pass
