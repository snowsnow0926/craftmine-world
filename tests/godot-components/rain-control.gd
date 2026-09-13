extends SceneTree

const World = preload("res://scenes/creation.tscn")
const Rain = preload("res://addons/cw.module.rain-control/rain_control.gd")
const Ledger = preload("res://craftmine_shared/component_state.gd")
var checks: Array[String] = []
var failed := false
var stage: Node3D
var rain: Node3D
var facts := {}

class LegacyWeatherWorld:
	extends Node3D
	func advance_rain() -> void: pass
	func resume_rain() -> void: pass

func verify(value: bool, label: String) -> void:
	if value: checks.append(label)
	else:
		failed = true
		push_error(label)

func ticks(count: int) -> void:
	for frame in count: await physics_frame

func key(code: int, down := true, modifiers := false, echo := false) -> void:
	var event := InputEventKey.new()
	event.physical_keycode = code
	event.keycode = code
	event.pressed = down
	event.ctrl_pressed = modifiers
	event.echo = echo
	Input.parse_input_event(event)
	Input.flush_buffered_events()

func tap(code: int) -> void:
	key(code)
	key(code, false)

func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	stage = World.instantiate()
	root.add_child(stage)
	current_scene = stage
	rain = stage.get_node("RainFixture")
	await ticks(3)
	verify(stage.ready_for_play and rain.configuration_error.is_empty(), "normal creation world and packaged rain component initialize")
	if OS.get_cmdline_user_args().has("--reload"):
		_cold_reopen()
		return
	# The base deliberately disables interactive input in headless fixture mode.
	# Enable its ordinary controller route; never assign motion or player progress.
	stage.player.input_enabled = true
	verify(not stage.player.capture_mouse_on_click, "headless fixture never enables mouse capture")
	var player = stage.player
	var camera = player.get_node("CameraRig/PitchPivot/Camera3D")
	var environment = stage.get_node("WorldEnvironment") if stage.has_node("WorldEnvironment") else null
	var environment_count := 0
	for node in stage.get_children():
		if node is WorldEnvironment:
			environment = node
			environment_count += 1
	var original_environment = environment.environment
	var world_bodies := stage.get_children().filter(func(node: Node) -> bool: return node is StaticBody3D)
	verify(not world_bodies.is_empty(), "fixture includes the existing world ground and collision bodies")
	facts["inputActionsBefore"] = InputMap.get_actions()
	verify(rain.rain_mesh.instance_count == 2200 and rain.drop_positions.size() == 2200, "rain uses 2200 individually integrated visible instances")
	var falling_y: float = rain.drop_positions[0].y
	await ticks(2)
	verify(rain.drop_positions[0].y < falling_y or falling_y < 0.6, "normal rain positions move downward")
	tap(KEY_U)
	await ticks(65)
	verify(rain.phase == Rain.Phase.HOLD and rain.speed == 0.0, "ordinary U input slows and suspends rain")
	var held = rain.drop_positions.duplicate()
	var before: Vector3 = player.position
	key(KEY_W)
	await ticks(45)
	key(KEY_W, false)
	await ticks(35)
	facts["walkDistance"] = Vector2(player.position.x-before.x, player.position.z-before.z).length()
	verify(facts.walkDistance > 1.0, "the existing player walks through suspended rain using normal movement input")
	verify(held == rain.drop_positions, "all 2200 held drop positions remain exactly fixed while walking")
	verify(stage.player == player and camera == player.get_node("CameraRig/PitchPivot/Camera3D") and environment.environment == original_environment, "rain preserves existing player camera and environment identities")
	verify(stage.get_children().filter(func(node: Node) -> bool: return node is StaticBody3D) == world_bodies, "rain preserves every existing ground and collision body")
	tap(KEY_U)
	await ticks(85)
	verify(rain.phase == Rain.Phase.RISE and rain.speed == Rain.RISE_SPEED, "second U reverses the same rain upward")
	var index := 0
	for i in rain.drop_positions.size():
		if rain.drop_positions[i].y > 2 and rain.drop_positions[i].y < 10:
			index = i
			break
	var rise_y: float = rain.drop_positions[index].y
	await ticks(3)
	verify(rain.drop_positions[index].y > rise_y, "reversal changes actual simulated drop displacement")
	tap(KEY_I)
	await ticks(110)
	verify(rain.phase == Rain.Phase.FALL and rain.speed == Rain.FALL_SPEED and not rain.automatic, "I returns rain to normal downward motion")
	var cast_before: int = rain.casts
	key(KEY_U, true, true)
	key(KEY_U, false, true)
	key(KEY_U, true, false, true)
	key(KEY_U, false)
	verify(rain.casts == cast_before, "modified and repeated keys do not cast skills")
	tap(KEY_O)
	await ticks(65)
	verify(rain.phase == Rain.Phase.HOLD and rain.automatic, "O starts an automatic suspension and reversal sequence")
	paused = true
	var ledger = Ledger.new()
	var saved: Dictionary = ledger.capture(stage)
	verify(saved.error.is_empty(), "normal component ledger captures rain state")
	var disk := FileAccess.open("user://rain-control-save.json", FileAccess.WRITE)
	disk.store_string(JSON.stringify({"world": stage.capture(), "components": saved.states}))
	disk.close()
	var frozen = rain.drop_positions.duplicate()
	tap(KEY_U)
	verify(rain.request_action("normal") == "RAIN_WORLD_PAUSED", "F2 tree pause rejects direct and keyboard rain actions")
	await ticks(12)
	verify(frozen == rain.drop_positions, "F2 pause leaves all rain positions unchanged")
	var snapshot: Dictionary = rain.snapshot()
	var bad: Dictionary = snapshot.duplicate(true)
	bad.phase = 99
	verify(not rain.restore(bad).is_empty() and rain.snapshot() == snapshot, "invalid phase restore rejects atomically")
	bad = snapshot.duplicate(true)
	bad.entityId = "another-world-instance"
	verify(not rain.restore(bad).is_empty() and rain.snapshot() == snapshot, "foreign identity restore rejects atomically")
	bad = snapshot.duplicate(true)
	bad.heights[0] = "not-base64"
	verify(not rain.restore(bad).is_empty() and rain.snapshot() == snapshot, "invalid height data rejects before any position changes")
	bad = snapshot.duplicate(true)
	bad.velocity = 1.0
	verify(not rain.restore(bad).is_empty() and rain.snapshot() == snapshot, "held state cannot restore a nonzero velocity")
	stage.remove_child(rain)
	rain.queue_free()
	rain = Rain.new()
	rain.name = "RainFixture"
	rain.entity_id = "rain-fixture"
	stage.add_child(rain)
	ledger = Ledger.new()
	verify(ledger.restore(stage, saved.states, true).is_empty(), "new component instance restores through the ordinary ledger")
	var reopened: Dictionary = ledger.capture(stage)
	verify(reopened.error.is_empty() and JSON.stringify(reopened.states) == JSON.stringify(saved.states), "reopen exactly preserves mode speed phase age clock casts and every float32 height")
	facts["savedStateBytes"] = JSON.stringify(saved.states).to_utf8_buffer().size()
	paused = false
	await ticks(220)
	verify(rain.phase == Rain.Phase.LIFT or rain.phase == Rain.Phase.RISE, "restored automatic timer continues into reversal")
	tap(KEY_I)
	await ticks(110)
	verify(not rain.automatic and rain.phase == Rain.Phase.FALL, "normal-rain action cancels automatic sequence without a late reversal")
	await ticks(260)
	verify(rain.phase == Rain.Phase.FALL, "cancelled automatic sequence does not restart later")
	verify(rain.request_action("unknown") == "RAIN_ACTION_INVALID", "unknown controls are rejected")
	var duplicate = Rain.new()
	duplicate.entity_id = "rain-second"
	stage.add_child(duplicate)
	verify(rain.request_action("advance") == "RAIN_WEATHER_OWNER_CONFLICT" and duplicate.request_action("advance") == "RAIN_WEATHER_OWNER_CONFLICT", "two weather owners explicitly conflict instead of silently overriding each other")
	verify(not ledger.capture(stage).error.is_empty(), "duplicate weather owner prevents a successful world save")
	stage.remove_child(duplicate)
	duplicate.queue_free()
	verify(ledger.capture(stage).error.is_empty(), "removing duplicate owner restores the original component availability")
	var conflict = Rain.new()
	conflict.entity_id = "rain-conflicting-key"
	conflict.advance_keycode = KEY_W
	stage.add_child(conflict)
	verify(conflict.configuration_error.begins_with("RAIN_INPUT_BINDING_CONFLICT"), "key already owned by InputMap movement is rejected")
	stage.remove_child(conflict)
	conflict.queue_free()
	verify(InputMap.get_actions() == facts.inputActionsBefore, "component never adds or removes global InputMap actions")
	var environments_after := 0
	for node in stage.get_children():
		if node is WorldEnvironment: environments_after += 1
	verify(environments_after == environment_count and environment.environment == original_environment, "component never adds or replaces global weather environment")
	var legacy := LegacyWeatherWorld.new()
	root.add_child(legacy)
	var legacy_player := Node3D.new()
	legacy_player.name = "Player"
	legacy.add_child(legacy_player)
	var extra := Rain.new()
	extra.entity_id = "rain-legacy-conflict"
	legacy.add_child(extra)
	verify(extra.request_action("advance") == "RAIN_EXISTING_WEATHER_CONFLICT" and not Ledger.new().capture(legacy).error.is_empty(), "accepted legacy rain-world control contract rejects a second weather owner")
	legacy.queue_free()
	print("RAIN_CONTROL_TEST=" + JSON.stringify({"ok":not failed,"headless":DisplayServer.get_name()=="headless","checks":checks,"facts":facts}))
	quit(1 if failed else 0)

func _cold_reopen() -> void:
	paused = true
	var saved: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("user://rain-control-save.json"))
	verify(stage.restore(saved.world).is_empty(), "fresh engine process restores existing world and player through normal world restore")
	var ledger = Ledger.new()
	verify(ledger.restore(stage, saved.components, true).is_empty(), "fresh engine process restores rain through normal component ledger")
	var actual: Dictionary = ledger.capture(stage)
	verify(actual.error.is_empty() and JSON.stringify(actual.states) == JSON.stringify(saved.components), "fresh process exactly restores persisted rain mode timing casts and drop heights")
	verify(JSON.stringify(stage.capture()) == JSON.stringify(saved.world), "rain restore preserves saved world and player progress")
	verify(rain.phase == Rain.Phase.HOLD and rain.automatic, "fresh process resumes the saved automatic suspended phase")
	print("RAIN_CONTROL_REOPEN=" + JSON.stringify({"ok":not failed,"checks":checks,"stateSha256":JSON.stringify(actual.states).sha256_text(),"headless":DisplayServer.get_name()=="headless"}))
	quit(1 if failed else 0)
