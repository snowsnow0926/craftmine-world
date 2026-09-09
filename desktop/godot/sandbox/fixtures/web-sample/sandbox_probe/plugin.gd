@tool
extends EditorPlugin

const Probe := preload("res://sandbox_probe/probe.gd")

# Runs as soon as the editor loads this plugin, before any game is started.

func _enter_tree() -> void:
	Probe.run("plugin")
	# Force the @tool resource below to be instantiated by the editor.
	var resource := load("res://probe_resource.tres")
	if resource == null:
		push_error("sandbox probe could not load its @tool resource")
