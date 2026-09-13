extends RefCounted
## Fixed engine monitors only. Does not enumerate nodes or invoke project callbacks.
## The caller owns transport/source verification; this script alone is not a security boundary.

const FORMAT := "craftmine.godot-engine-performance/1"
const PROFILE := "engine-monitor/1"
const MONITORS := {
	"processTime": ["TIME_PROCESS", 1, "s", "Engine-published time to complete a frame; not OS CPU usage or script-only time."],
	"physicsTime": ["TIME_PHYSICS_PROCESS", 2, "s", "Engine-published time to complete a physics frame; not the physics step interval."],
	"fps": ["TIME_FPS", 0, "fps", "Engine-published frame rate; refreshed approximately once per second, not a per-frame timer."],
	"objectCount": ["OBJECT_COUNT", 7, "count", "Engine-wide instantiated Object count, including nodes and runtime overhead."],
	"nodeCount": ["OBJECT_NODE_COUNT", 9, "count", "Engine-wide node count in the scene tree, including its root."],
	"drawCalls": ["RENDER_TOTAL_DRAW_CALLS_IN_FRAME", 13, "count", "Draw calls in the last rendered frame; not GPU execution time."],
	"primitives": ["RENDER_TOTAL_PRIMITIVES_IN_FRAME", 12, "count", "Vertices or indices submitted in the last rendered frame, including rendering passes."],
}
var _sequence: int = 0

func sample() -> Dictionary:
	_sequence += 1
	var info := Engine.get_version_info()
	# The display string is "4.7.2-stable (official)"; canonicalize built-in fields.
	var version := "%s.%s.%s.%s.%s.%s" % [info.get("major", ""), info.get("minor", ""), info.get("patch", ""), info.get("status", ""), info.get("build", ""), str(info.get("hash", "")).substr(0, 9)]
	var tree := Engine.get_main_loop() as SceneTree
	var paused := tree.paused if tree != null else false
	var headless := DisplayServer.get_name() == "headless"
	var method := RenderingServer.get_current_rendering_method()
	var driver := RenderingServer.get_current_rendering_driver_name()
	var metrics: Dictionary = {}
	for key in MONITORS:
		var spec: Array = MONITORS[key]
		var reading := {"status": "unknown", "monitor": spec[0], "unit": spec[2], "meaning": spec[3]}
		var reason := ""
		if version != "4.7.2.stable.official.ed1daf0bf":
			reason = "ENGINE_VERSION_UNVERIFIED"
		elif tree == null:
			reason = "SCENE_TREE_UNAVAILABLE"
		elif not ClassDB.class_has_integer_constant("Performance", spec[0]) or ClassDB.class_get_integer_constant("Performance", spec[0]) != spec[1]:
			reason = "MONITOR_ENUM_UNVERIFIED"
		elif key in ["processTime", "physicsTime", "fps"] and paused:
			reason = "SCENE_TREE_PAUSED_NOT_ACTIVE_GAMEPLAY"
		elif key in ["drawCalls", "primitives"] and (headless or method == "dummy" or driver == "dummy" or Engine.get_frames_drawn() == 0):
			reason = "RENDERER_NOT_DRAWING"
		else:
			var raw := Performance.get_monitor(spec[1])
			if not is_finite(raw) or raw < 0.0:
				reason = "INVALID_ENGINE_MONITOR_VALUE"
			elif key in ["processTime", "physicsTime", "fps"] and raw == 0.0:
				reason = "ENGINE_TIMING_NOT_YET_PUBLISHED_OR_ZERO_UNVERIFIED"
			else:
				reading["status"] = "measured"
				reading["rawValue"] = raw
		if not reason.is_empty():
			reading["reason"] = reason
		metrics[key] = reading
	metrics["gpuTime"] = {"status": "unknown", "monitor": null, "unit": "s", "meaning": "GPU execution duration.", "reason": "NO_TRUSTED_GPU_TIMER"}
	return {
		"format": FORMAT, "profile": PROFILE, "engineVersion": version,
		"sequence": _sequence, "processFrame": Engine.get_process_frames(), "physicsFrame": Engine.get_physics_frames(), "framesDrawn": Engine.get_frames_drawn(),
		"paused": paused, "headless": headless, "renderingMethod": method, "renderingDriver": driver,
		"debugBuild": OS.is_debug_build(), "editorHint": Engine.is_editor_hint(),
		"sampledAt": Time.get_datetime_string_from_system(true) + "Z", "monotonicUsec": Time.get_ticks_usec(),
		"monitorFreshness": "Engine monitors may be cached for about one second; request sequence is not an engine refresh sequence.",
		"metrics": metrics,
	}
