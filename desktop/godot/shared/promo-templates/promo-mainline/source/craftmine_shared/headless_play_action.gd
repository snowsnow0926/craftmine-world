extends Node

# Private host-controller capability. This does not sandbox authored GDScript.
var _token := ""
var _scope: Dictionary = {}
var _held := false
var _generation := 0
var _busy := false

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS

func authorize(token: String, identity: Dictionary) -> Dictionary:
	if not _token.is_empty() or token.length() != 64 or not token.is_valid_hex_number(false):
		return {"error": "PLAY_ACTION_AUTHORIZATION"}
	_token = token
	_scope = identity.duplicate(true)
	return {"result": {"authorized": true}}

func cancel() -> void:
	_generation += 1
	if _held:
		_held = false
		var event := InputEventAction.new()
		event.action = &"interact"
		event.pressed = false
		Input.parse_input_event(event)
		Input.flush_buffered_events()

func cancel_authorized(args: Dictionary, identity: Dictionary) -> Dictionary:
	if _token.is_empty() or args.size() != 1 or args.get("token") != _token or identity != _scope:
		return {"error": "PLAY_ACTION_UNAUTHORIZED"}
	cancel()
	return {"result": {"released": true}}

func _notification(what: int) -> void:
	if what == NOTIFICATION_PAUSED:
		cancel()

func _exit_tree() -> void:
	cancel()

func perform(args: Dictionary, identity: Dictionary) -> Dictionary:
	if _token.is_empty() or args.get("token") != _token or identity != _scope:
		return {"error": "PLAY_ACTION_UNAUTHORIZED"}
	if args.size() != 3 or args.get("action") != "interact" or not (args.get("frames") is int or args.get("frames") is float) or args.frames != 1:
		return {"error": "PLAY_ACTION_ARGUMENTS"}
	if get_tree().paused:
		return {"error": "PLAY_ACTION_PAUSED"}
	if _busy or Input.is_action_pressed(&"interact"):
		return {"error": "PLAY_ACTION_BUSY"}
	_busy = true
	var generation := _generation
	# Align to the beginning of a physics tick, then keep the action held until
	# the next tick. Both event handlers and Input polling see the same action.
	await get_tree().physics_frame
	if generation != _generation or not is_inside_tree() or get_tree().paused:
		_busy = false
		return {"error": "PLAY_ACTION_CANCELLED"}
	var event := InputEventAction.new()
	event.action = &"interact"
	event.pressed = true
	_held = true
	Input.parse_input_event(event)
	Input.flush_buffered_events()
	await get_tree().physics_frame
	var cancelled := generation != _generation or not is_inside_tree() or get_tree().paused
	cancel()
	_busy = false
	if cancelled:
		return {"error": "PLAY_ACTION_CANCELLED"}
	return {"result": {"dispatched": true, "action": "interact", "frames": 1}}
