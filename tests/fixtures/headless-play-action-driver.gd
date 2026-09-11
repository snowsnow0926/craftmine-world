extends SceneTree

class Observer extends Node:
	var presses := 0
	var releases := 0
	var unhandled := 0
	var held_ticks := 0
	var consume := false
	var during_hold: Callable
	func _input(event: InputEvent) -> void:
		if event.is_action_pressed("interact"):
			presses += 1
			if consume: get_viewport().set_input_as_handled()
		if event.is_action_released("interact"): releases += 1
	func _unhandled_input(event: InputEvent) -> void:
		if event.is_action_pressed("interact"): unhandled += 1
	func _physics_process(_dt: float) -> void:
		if Input.is_action_pressed("interact"):
			held_ticks += 1
			if during_hold.is_valid():
				var callback := during_hold
				during_hold = Callable()
				callback.call_deferred()

var runtime: Node
var observer: Observer
var checks := []
const ID := {"worldId": "play-action-fixture", "buildId": "build", "instanceId": "instance"}
const TOKEN := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func _initialize() -> void:
	run.call_deferred()

func check(label: String, passed: bool) -> void:
	checks.append({"name": label, "passed": passed})
	if not passed: printerr("FAILED: " + label)

func request(op: String, args: Dictionary = {}, identity: Dictionary = ID) -> Dictionary:
	var payload := identity.duplicate(true)
	payload.merge({"op": op, "args": args})
	# JSON numbers in the real Web bridge are floats, unlike GDScript literals.
	return await runtime.handle_request(JSON.parse_string(JSON.stringify(payload)))

func action() -> Dictionary:
	return await request("play-action", {"action": "interact", "frames": 1, "token": TOKEN})

func pause_during_hold() -> void:
	await request("pause")

func duplicate_during_hold() -> void:
	check("concurrent-action-rejected", (await action()).get("error") == "PLAY_ACTION_BUSY")

func restore_during_hold() -> void:
	await request("load")

func detach_during_hold() -> void:
	runtime.remove_child(runtime.play_action)

func run() -> void:
	change_scene_to_file(ProjectSettings.get_setting("application/run/main_scene"))
	for _frame in range(600):
		await process_frame
		runtime = root.get_node_or_null("CraftmineRuntime")
		if runtime != null and runtime.initialized: break
	observer = Observer.new()
	root.add_child(observer)
	check("before-load-rejected", (await action()).has("error"))
	check("authorize-once", (await request("headless-play-authorize", {"token": TOKEN})).has("result"))
	check("duplicate-authorization-rejected", (await request("headless-play-authorize", {"token": TOKEN})).has("error"))
	await request("load")
	check("paused-rejected", (await action()).has("error"))
	await request("resume")
	check("bad-token-rejected", (await request("play-action", {"action": "interact", "frames": 1, "token": "wrong"})).has("error"))
	check("wrong-identity-rejected", (await request("play-action", {"action": "interact", "frames": 1, "token": TOKEN}, {"worldId": "play-action-fixture", "buildId": "other", "instanceId": "instance"})).has("error"))
	for args in [{"action": "attack", "frames": 1, "token": TOKEN}, {"action": "interact", "frames": 2, "token": TOKEN}, {"action": "interact", "frames": 1, "token": TOKEN, "headless": true}]:
		check("invalid-arguments-rejected", (await request("play-action", args)).has("error"))
	check("rejection-dispatches-nothing", observer.presses == 0)
	check("real-action-dispatched", (await action()).has("result"))
	check("one-event-one-release", observer.presses == 1 and observer.releases == 1 and observer.unhandled == 1)
	check("global-input-one-physics-tick", observer.held_ticks == 1 and not Input.is_action_pressed("interact"))
	await action()
	check("repeat-without-duplicate", observer.presses == 2 and observer.releases == 2 and observer.unhandled == 2 and observer.held_ticks == 2)
	observer.consume = true
	await action()
	check("handled-event-not-broadcast", observer.presses == 3 and observer.unhandled == 2)
	observer.consume = false
	observer.during_hold = pause_during_hold
	check("pause-cancels-inflight", (await action()).has("error"))
	check("pause-releases-hold", not Input.is_action_pressed("interact") and observer.presses == observer.releases)
	await request("resume")
	check("resumes-after-cancel", (await action()).has("result"))
	observer.during_hold = duplicate_during_hold
	await action()
	observer.during_hold = restore_during_hold
	check("restore-cancels-inflight", (await action()).has("error"))
	check("restore-releases-hold", not Input.is_action_pressed("interact"))
	observer.during_hold = detach_during_hold
	check("detach-cancels-inflight", (await action()).has("error"))
	check("detach-releases-hold", not Input.is_action_pressed("interact"))
	runtime.add_child(runtime.play_action)
	runtime.play_action.cancel()
	runtime.play_action.cancel()
	check("cleanup-idempotent", observer.presses == observer.releases and not Input.is_action_pressed("interact"))
	var ok := true
	for result in checks: ok = ok and result.passed
	print("PLAY_ACTION_RESULTS=" + JSON.stringify({"checks": checks, "presses": observer.presses, "releases": observer.releases, "heldTicks": observer.held_ticks}))
	quit(0 if ok else 1)
