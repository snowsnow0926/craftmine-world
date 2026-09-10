extends Node

# 示例源码：先操作第一个标记两次，再操作第二个标记开门。
# 这是可阅读和修改的普通脚本，不是 creation_operation 的新 action。
var _host: Node
var _door_id: String
var _first: String
var _second: String
var _presses := 0
var _completed := false

func configure(host: Node, definition: Dictionary) -> void:
	_host = host
	_door_id = definition.doorId
	_first = definition.sequence[0]
	_second = definition.sequence[1]

func on_entity_interacted(entity_id: String) -> void:
	if _completed:
		return
	if entity_id == _first:
		_presses = mini(_presses + 1, 2)
	elif entity_id == _second and _presses == 2:
		_completed = true
		_host.set_door_open(_door_id, true)
	else:
		_presses = 0

func snapshot() -> Dictionary:
	return {"presses": _presses, "completed": _completed}

func validate_state(data: Dictionary) -> String:
	if data.size() != 2 or not data.has("presses") or not data.has("completed"):
		return "Invalid double-press state fields"
	var presses: Variant = data.presses
	if not (presses is int or presses is float) or not is_finite(float(presses)) or float(presses) != floorf(float(presses)) or presses < 0 or presses > 2:
		return "Invalid double-press count"
	if not data.completed is bool or (data.completed and presses != 2):
		return "Invalid double-press completion"
	return ""

func restore(data: Dictionary) -> void:
	if not validate_state(data).is_empty():
		return
	_presses = int(data.presses)
	_completed = data.completed
	if _completed:
		_host.set_door_open(_door_id, true)
