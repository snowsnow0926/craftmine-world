extends "res://craftmine_shared/base_adapter_controller_v1.gd"

const ProgressCollision = preload("res://craftmine_shared/progress_collision.gd")
var _progress_collision := ProgressCollision.new()
var _last_collision := {"profile":ProgressCollision.PROFILE,"status":"inconclusive","reason":"NOT_RESTORED"}
var _last_sync: Dictionary = {}

func observe() -> Dictionary:
	var result: Dictionary = super.observe()
	result.progressCollisionGuard = _last_collision.duplicate(true)
	return result

func _sync_restore(scene: Node) -> bool:
	var tree := scene.get_tree()
	var start := Engine.get_physics_frames()
	_last_sync = {"startedFrame":start,"finishedFrame":start,"boundaries":0,"paused":tree.paused}
	# Keep simulation paused, but cross actual physics-frame boundaries so
	# deferred collision disabling/restoring reaches the physics server.
	for frame in 3:
		await tree.physics_frame
		_last_sync.finishedFrame = Engine.get_physics_frames()
		_last_sync.boundaries = frame + 1
		if world() != scene: return false
		if Engine.get_physics_frames() >= start + 2: return true
	return false

func restore(body: Dictionary) -> String:
	_last_collision = {"profile":ProgressCollision.PROFILE,"status":"inconclusive","reason":"RESTORE_PENDING"}
	if not body.get("player") is Dictionary: return "CREATION_COLLISION_GUARD_UNSUPPORTED:POSE_INVALID"
	var scene: Node = world()
	var tree := scene.get_tree()
	var before: Dictionary = _controller_probe.sample(scene, Engine.get_physics_frames())
	if before.get("status") != "supported":
		_last_collision.reason = "CONTROLLER_UNSUPPORTED"
		return "CREATION_COLLISION_GUARD_UNSUPPORTED:CONTROLLER_UNSUPPORTED"
	var previous: Dictionary = super.capture().duplicate(true)
	var was_paused := tree.paused
	tree.paused = true
	var problem: String = await super.restore(body)
	if not problem.is_empty(): _last_collision.reason = "BASE_RESTORE_REJECTED"
	if problem.is_empty():
		if not await _sync_restore(scene):
			_last_collision = {"profile":ProgressCollision.PROFILE,"status":"inconclusive","reason":"PHYSICS_SYNC_UNAVAILABLE"}
		else:
			var current: Dictionary = _controller_probe.sample(scene, Engine.get_physics_frames())
			_last_collision = _progress_collision.inspect(scene, body.get("player", {}), before, current)
		_last_collision.synchronization = _last_sync.duplicate(true)
		if _last_collision.status != "passed": problem = "CREATION_COLLISION_GUARD_" + ("FAILED:" if _last_collision.status == "failed" else "UNSUPPORTED:") + str(_last_collision.reason)
	if not problem.is_empty() and world() == scene:
		# Roll back the call's original state; never search for a different pose
		# that could make a rejected candidate pass.
		var rollback: String = await super.restore(previous)
		var restored := await _sync_restore(scene) and rollback.is_empty() and JSON.stringify(previous) == JSON.stringify(super.capture())
		if restored:
			var rollback_current: Dictionary = _controller_probe.sample(scene, Engine.get_physics_frames())
			var rollback_guard := _progress_collision.inspect(scene, previous.player, before, rollback_current)
			# The original candidate pose can itself be obstructed. Rollback proves
			# identity and exact saved state, not that the rejected source is safe.
			restored = rollback_guard.status != "inconclusive"
		if not restored: problem += ":ROLLBACK_UNCONFIRMED"
	tree.paused = was_paused
	return problem
