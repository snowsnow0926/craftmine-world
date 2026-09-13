extends "res://scripts/rain_world.gd"

const RainState = preload("res://scripts/rain_magic_state.gd")
const ComponentLedger = preload("res://craftmine_shared/component_state.gd")
var rain_state: Node
var persistence_probe: Dictionary = {}
var _auditing_audio := false

func _ready() -> void:
	super._ready()
	if not rain_ready: return
	rain_state = RainState.new()
	rain_state.name = "RainMagicState"
	add_child(rain_state)
	# Bounded startup round-trip audit runs before any host save is loaded. It never writes a save/receipt.
	# It uses the same bundled component transaction as the normal adapter, not a parallel save implementation.
	var problem := _audit_component_roundtrip()
	if not problem.is_empty():
		_fail("Rain component audit: "+problem)
		return
	sync_rain_audio()

func _setup_audio() -> void:
	# STREAM is set BEFORE adding/playing either node. No Web SampleNode backend is instantiated.
	# The original synthesized rain and cast WAVs, loop, pitch and gain are retained.
	rain_audio = AudioStreamPlayer.new()
	rain_audio.name = "RainSound"
	rain_audio.playback_type = AudioServer.PLAYBACK_TYPE_STREAM
	rain_audio.stream = _wave(0)
	rain_audio.volume_db = linear_to_db(0.68)
	add_child(rain_audio)
	rain_audio.play()
	cast_audio = AudioStreamPlayer.new()
	cast_audio.name = "RainCastSound"
	cast_audio.playback_type = AudioServer.PLAYBACK_TYPE_STREAM
	cast_audio.stream = _wave(1)
	cast_audio.volume_db = -8
	add_child(cast_audio)

func sync_rain_audio(restoring := false) -> void:
	if is_instance_valid(rain_audio):
		rain_audio.volume_db = -80.0 if _auditing_audio else linear_to_db(maxf(0.0001,absf(rain_speed)/8.5*0.68))
		rain_audio.pitch_scale = 0.76 if rain_speed > 0 else 1.0
	if is_instance_valid(cast_audio):
		cast_audio.volume_db = -80.0 if _auditing_audio else -8.0
		if restoring:
			cast_audio.stop()
			if rain_phase in [RainPhase.BRAKE,RainPhase.LIFT] and phase_age < 0.85:
				cast_audio.play(phase_age)

func _audit_roundtrip(ledger: RefCounted, expected_phase: int) -> String:
	if rain_phase != expected_phase: return "Input did not reach stage "+str(expected_phase)
	_sync_drops()
	var saved: Dictionary = ledger.capture(self)
	if not saved.error.is_empty(): return saved.error
	var mesh_before: Transform3D = rain_mesh.get_instance_transform(0)
	# Move through the real recovery operation, then restore the captured non-default component stage.
	resume_rain()
	_step_rain(2.0)
	_sync_drops()
	var problem: String = ledger.restore(self,saved.states,true)
	if not problem.is_empty(): return problem
	var after: Dictionary = ledger.capture(self)
	if not after.error.is_empty() or after.states != saved.states: return "Component round-trip changed saved state"
	if rain_phase != expected_phase or rain_mesh.get_instance_transform(0) != mesh_before: return "Rendered rain did not restore"
	persistence_probe[PHASE_NAMES[expected_phase]] = true
	return ""

func _audit_component_roundtrip() -> String:
	_auditing_audio = true
	sync_rain_audio()
	var ledger := ComponentLedger.new()
	var initial: Dictionary = ledger.capture(self)
	if not initial.error.is_empty(): return initial.error
	var problem := _audit_roundtrip(ledger,RainPhase.FALL)
	if problem.is_empty():
		advance_rain()
		_step_rain(0.2)
		problem = _audit_roundtrip(ledger,RainPhase.BRAKE)
	if problem.is_empty():
		_step_rain(1.0)
		problem = _audit_roundtrip(ledger,RainPhase.HOLD)
	if problem.is_empty():
		var held := drop_positions.duplicate()
		_step_rain(0.25)
		if drop_positions != held: problem = "Restored suspended rain moved"
	if problem.is_empty():
		advance_rain()
		_step_rain(0.2)
		problem = _audit_roundtrip(ledger,RainPhase.LIFT)
	if problem.is_empty():
		_step_rain(2.0)
		problem = _audit_roundtrip(ledger,RainPhase.RISE)
	if problem.is_empty():
		resume_rain()
		_step_rain(0.2)
		problem = _audit_roundtrip(ledger,RainPhase.RETURN)
	if problem.is_empty():
		perform_rain()
		_step_rain(2.0)
		_step_rain(1.1)
		problem = _audit_roundtrip(ledger,RainPhase.HOLD)
		if problem.is_empty():
			_step_rain(2.2)
			if rain_phase != RainPhase.LIFT or not auto_performance: problem = "Automatic sequence did not continue from saved time"
		persistence_probe["automaticTimerContinues"] = problem.is_empty()
	if problem.is_empty():
		var saved: Dictionary = ledger.capture(self)
		var bad: Dictionary = saved.states.duplicate(true)
		bad["rain-magic"]["phase"] = 99
		var rejected: String = ledger.restore(self,bad,true)
		var unchanged: Dictionary = ledger.capture(self)
		if rejected.is_empty() or unchanged.states != saved.states: problem = "Invalid component state was not rejected atomically"
		persistence_probe["invalidStateRejectedAtomically"] = problem.is_empty()
	var rollback: String = ledger.restore(self,initial.states,true)
	if not rollback.is_empty(): problem += "; initial rollback: "+rollback
	_auditing_audio = false
	sync_rain_audio(true)
	persistence_probe["source"] = "executed-bundled-component-ledger-roundtrip"
	persistence_probe["passed"] = problem.is_empty()
	print("RAIN_COMPONENT_ROUNDTRIP="+JSON.stringify(persistence_probe))
	return problem

func observe() -> Dictionary:
	var result := super.observe()
	result.creation.rainMagic["persistence"] = persistence_probe.duplicate(true)
	result.creation.rainMagic["persistentComponentId"] = "rain-magic"
	result.creation.rainMagic["audioPlayback"] = {"rain":rain_audio.playback_type if is_instance_valid(rain_audio) else null,"cast":cast_audio.playback_type if is_instance_valid(cast_audio) else null,"requiredStreamType":AudioServer.PLAYBACK_TYPE_STREAM}
	return result
