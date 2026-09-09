@tool
extends Resource

const Probe := preload("res://sandbox_probe/probe.gd")

# @tool code runs in the editor as soon as this resource is instantiated.

func _init() -> void:
	Probe.run("tool_init")
