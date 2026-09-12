extends Node

const Collector = preload("res://engine_performance.gd")
var sampler := Collector.new()
var custom_calls := 0
var workload: Node

func _ready() -> void:
	call_deferred("_run")

func _custom_callback() -> float:
	custom_calls += 1
	return 991.0

func _run() -> void:
	Performance.add_custom_monitor("fixture/must_not_be_called", _custom_callback)
	workload = Node.new()
	workload.name = "FixedWorkload"
	add_child(workload)
	await get_tree().create_timer(1.3).timeout
	var empty := sampler.sample()
	for index in range(256):
		var node := Node.new()
		node.name = "Item" + str(index)
		workload.add_child(node)
	await get_tree().create_timer(1.3).timeout
	var loaded := sampler.sample()
	get_tree().paused = true
	var stopped := sampler.sample()
	for child in workload.get_children():
		child.free()
	var removed := sampler.sample()
	get_tree().paused = false
	await get_tree().create_timer(1.3).timeout
	var resumed := sampler.sample()
	print("ENGINE_PERFORMANCE_RESULT=" + JSON.stringify({"empty": empty, "loaded": loaded, "paused": stopped, "removed": removed, "resumed": resumed, "addedNodes": 256, "customMonitorCalls": custom_calls}))
	Performance.remove_custom_monitor("fixture/must_not_be_called")
	get_tree().quit(0)
