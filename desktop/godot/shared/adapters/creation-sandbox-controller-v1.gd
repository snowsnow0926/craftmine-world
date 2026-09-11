extends "res://craftmine_shared/base_adapter_legacy.gd"
const ControllerProbe = preload("res://craftmine_shared/controller_evidence.gd")
const PickerV2 = preload("res://craftmine_shared/scene_mesh_picker_v2.gd")
var _controller_probe := ControllerProbe.new()

func _init() -> void:
	# Preserve the legacy sampler's physics signal registration explicitly.
	super._init()
	mesh_picker = PickerV2.new()

func _scene_objects(existing: Dictionary) -> Dictionary:
	var result: Dictionary = super._scene_objects(existing)
	result.selection["scope"] = "bounded-static-base-mesh-triangles"
	result.selection["geometryBasis"] = "base-surface-arrays"
	result.selection["renderLodVerified"] = false
	result.selection["pixelAccurate"] = false
	return result

func _controller_tick() -> int:
	return observed_physics_tick

func observe() -> Dictionary:
	var result: Dictionary = super.observe()
	# Overwrite any authored field. Evidence always comes from the fixed sampler.
	result.controllerEvidence = _controller_probe.sample(world(), observed_physics_tick)
	return result

func command(op: String, args: Dictionary) -> Dictionary:
	if op == "controller-walk":
		if not Contract.fields(args, ["forward", "right", "frames"]) or not Contract.finite(args.forward, -1, 1) or not Contract.finite(args.right, -1, 1) or not Contract.integer(args.frames, 1, 240):
			return {"error": "CONTROLLER_WALK_ARGUMENTS_INVALID"}
		if not is_ready(): return {"error": "CONTROLLER_WORLD_NOT_READY"}
		return await _controller_probe.walk(world(), Vector2(float(args.right), -float(args.forward)), int(args.frames), _controller_tick)
	return await super.command(op, args)
