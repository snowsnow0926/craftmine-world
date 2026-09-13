extends CharacterBody3D

const StateContract = preload("res://scripts/scene_contract.gd")
const SAVE_FORMAT := "craftmine.pet-dog/1"
const STEP_DIRS := [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]
@export var entity_id := "pet-dog-01"
var following := true
var petted_count := 0
var world: Node3D
var player: CharacterBody3D
var route: Array[Vector2] = []
var obstacles: Array[Dictionary] = []
var repath := 0.0
var phase := 0.0
var pat_time := 0.0
var notice_time := 0.0
var notice := ""
var hud: Label
var name_tag: Label3D
var pivots: Dictionary = {}
var rest: Dictionary = {}
var gravity := 9.8

func _ready() -> void:
	world = get_parent() as Node3D
	player = world.get_node("Player") as CharacterBody3D
	add_to_group("craftmine_persistent_components")
	set_meta("entity_id", entity_id)
	gravity = float(ProjectSettings.get_setting("physics/3d/default_gravity", 9.8))
	for key in ["LegFrontL", "LegFrontR", "LegBackL", "LegBackR", "TailPivot", "HeadPivot", "TorsoPivot"]:
		var part: Node3D = $Visual.find_child(key, true, false) as Node3D
		if part == null:
			push_error("Puppy model is missing animation pivot: " + key)
			return
		pivots[key] = part
		rest[key] = {"position": part.position, "rotation": part.rotation}
	call_deferred("_setup_hud")

func _setup_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	hud = Label.new()
	hud.position = Vector2(20, 46)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_theme_font_size_override("font_size", 16)
	var font: Font = world.get("creation_font") as Font
	if font != null: hud.add_theme_font_override("font", font)
	layer.add_child(hud)
	name_tag = Label3D.new()
	name_tag.position.y = 1.18
	name_tag.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	name_tag.font_size = 30
	name_tag.pixel_size = 0.005
	if font != null: name_tag.font = font
	add_child(name_tag)
	_update_hud()

func _xz(p: Vector3) -> Vector2:
	return Vector2(p.x, p.z)

# Read the actual base-generated collision shapes; never move or replace trees.
func _read_obstacles() -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	var nodes: Dictionary = world.get("entity_nodes")
	for id in nodes:
		var entity: Node3D = nodes[id]
		var body: StaticBody3D = entity.get_node_or_null("Body") as StaticBody3D
		if body == null or body.get_child_count() == 0: continue
		var shape: CollisionShape3D = body.get_child(0) as CollisionShape3D
		if shape == null or shape.disabled or not shape.shape is BoxShape3D: continue
		var box: BoxShape3D = shape.shape as BoxShape3D
		var scale_x := shape.global_transform.basis.x.length()
		var scale_z := shape.global_transform.basis.z.length()
		result.append({"inverse": shape.global_transform.affine_inverse(), "height": shape.global_position.y, "half": box.size * 0.5, "sx": scale_x, "sz": scale_z})
	return result

func _clear_point(p: Vector2, items: Array[Dictionary], radius: float = 0.52) -> bool:
	if absf(p.x) > 30.5 or absf(p.y) > 30.5: return false
	for item in items:
		var local: Vector3 = item.inverse * Vector3(p.x, item.height, p.y)
		var half: Vector3 = item.half
		var dx: float = maxf(absf(local.x) - half.x, 0.0) * item.sx
		var dz: float = maxf(absf(local.z) - half.z, 0.0) * item.sz
		if dx * dx + dz * dz < radius * radius: return false
	return true

func _segment_clear(a: Vector2, b: Vector2) -> bool:
	var steps := maxi(1, ceili(a.distance_to(b) / 0.2))
	for i in range(steps + 1):
		if not _clear_point(a.lerp(b, float(i) / float(steps)), obstacles): return false
	return true

func _nearest_cell(p: Vector2, visible_from_start: bool) -> Vector2i:
	var base := Vector2i(roundi(p.x), roundi(p.y))
	var best := Vector2i(999, 999)
	var score := INF
	for x in range(-3, 4):
		for z in range(-3, 4):
			var cell := base + Vector2i(x, z)
			var point := Vector2(cell)
			var distance := point.distance_squared_to(p)
			if distance >= score or not _clear_point(point, obstacles): continue
			if visible_from_start and not _segment_clear(p, point): continue
			best = cell
			score = distance
	return best

# Bounded four-neighbour search on this flat sandbox, followed by safe line smoothing.
# Movement always uses CharacterBody3D collisions, never teleporting through obstacles.
func _plan_route() -> void:
	route.clear()
	obstacles = _read_obstacles()
	var start_pos := _xz(global_position)
	var goal_pos := _xz(player.global_position)
	if _segment_clear(start_pos, goal_pos):
		route.append(goal_pos)
		return
	var start := _nearest_cell(start_pos, true)
	var goal := _nearest_cell(goal_pos, false)
	if start.x == 999 or goal.x == 999: return
	var queue: Array[Vector2i] = [start]
	var parent: Dictionary = {start: start}
	var walkable: Dictionary = {}
	var cursor := 0
	while cursor < queue.size() and queue.size() <= 3721:
		var current: Vector2i = queue[cursor]
		cursor += 1
		if current == goal: break
		for step: Vector2i in STEP_DIRS:
			var next := current + step
			if abs(next.x) > 30 or abs(next.y) > 30 or parent.has(next): continue
			if not walkable.has(next): walkable[next] = _clear_point(Vector2(next), obstacles)
			if not walkable[next] or not _segment_clear(Vector2(current), Vector2(next)): continue
			parent[next] = current
			queue.append(next)
	if not parent.has(goal): return
	var cells: Array[Vector2] = []
	var cell := goal
	while cell != start:
		cells.append(Vector2(cell))
		cell = parent[cell]
	cells.append(Vector2(start))
	cells.reverse()
	var anchor := start_pos
	var first := 0
	while first < cells.size():
		var last := cells.size() - 1
		while last > first and not _segment_clear(anchor, cells[last]): last -= 1
		if not _segment_clear(anchor, cells[last]): return
		route.append(cells[last])
		anchor = cells[last]
		first = last + 1

func _physics_process(delta: float) -> void:
	if not is_instance_valid(player) or world.get("ready_for_play") != true: return
	phase += delta
	pat_time = maxf(0.0, pat_time - delta)
	notice_time = maxf(0.0, notice_time - delta)
	repath -= delta
	var distance := _xz(global_position).distance_to(_xz(player.global_position))
	var wish := Vector3.ZERO
	if following and distance > 1.9 and pat_time <= 0.0:
		if repath <= 0.0:
			_plan_route()
			repath = 0.65
		while not route.is_empty() and _xz(global_position).distance_to(route[0]) < 0.28:
			route.pop_front()
		if not route.is_empty():
			var direction := (route[0] - _xz(global_position)).normalized()
			var speed := 8.4 if distance > 7.0 else minf(4.0, maxf(1.0, (distance - 1.7) * 2.6))
			wish = Vector3(direction.x, 0, direction.y) * speed
	else:
		route.clear()
	velocity.x = move_toward(velocity.x, wish.x, 13.0 * delta)
	velocity.z = move_toward(velocity.z, wish.z, 13.0 * delta)
	if not following or pat_time > 0.0:
		velocity.x = 0.0
		velocity.z = 0.0
	velocity.y = -0.1 if is_on_floor() else maxf(-20.0, velocity.y - gravity * delta)
	move_and_slide()
	var flat := Vector3(velocity.x, 0, velocity.z)
	if flat.length() > 0.12:
		rotation.y = wrapf(lerp_angle(rotation.y, atan2(-flat.x, -flat.z), minf(1.0, delta * 9.0)), -PI, PI)
	_animate(flat.length(), distance, delta)
	_update_hud()

func _animate(speed: float, distance: float, delta: float) -> void:
	if pivots.size() != 7: return
	var amount := minf(1.0, speed / 3.0)
	var gait := sin(phase * (10.0 if speed < 5.0 else 15.0)) * 0.58 * amount
	for key in ["LegFrontL", "LegBackR", "LegFrontR", "LegBackL"]:
		var leg: Node3D = pivots[key]
		var sign_value := 1.0 if key in ["LegFrontL", "LegBackR"] else -1.0
		leg.rotation.x = lerpf(leg.rotation.x, rest[key].rotation.x + gait * sign_value, minf(1.0, delta * 16.0))
	var tail: Node3D = pivots.TailPivot
	tail.rotation.y = rest.TailPivot.rotation.y + sin(phase * (16.0 if pat_time > 0.0 else 8.0)) * (0.65 if distance < 4.0 else 0.25)
	var torso: Node3D = pivots.TorsoPivot
	torso.position.y = rest.TorsoPivot.position.y + absf(sin(phase * 10.0)) * 0.018 * amount
	var head: Node3D = pivots.HeadPivot
	head.rotation.z = rest.HeadPivot.rotation.z + (sin(phase * 4.0) * 0.14 if pat_time > 0.0 else 0.0)

func _update_hud() -> void:
	if hud == null: return
	var mode := "跟随中" if following else "原地等候"
	hud.text = (notice if notice_time > 0.0 else "小麦 · " + mode) + "\n靠近按 F 跟随/等候 · G 摸摸 · C 呼唤"
	if name_tag != null:
		name_tag.text = "小麦 · 开心" if pat_time > 0.0 else "小麦"
		name_tag.visible = global_position.distance_to(player.global_position) < 10.0

func _feedback(message: String) -> void:
	notice = message
	notice_time = 2.5
	_update_hud()

func _near(actor: Node3D) -> bool:
	if actor != player or global_position.distance_to(actor.global_position) > 3.4: return false
	var items := _read_obstacles()
	var a := _xz(global_position)
	var b := _xz(actor.global_position)
	for i in range(17):
		if not _clear_point(a.lerp(b, float(i) / 16.0), items, 0.02): return false
	return true

func interact(actor: Node) -> Dictionary:
	if not actor is Node3D or not _near(actor as Node3D): return {"interacted": false, "reason": "out-of-range"}
	following = not following
	route.clear()
	repath = 0.0
	velocity.x = 0.0
	velocity.z = 0.0
	var message := "小麦摇摇尾巴，跟上了你。" if following else "小麦会在这里乖乖等你。"
	_feedback(message)
	return {"interacted": true, "entityId": entity_id, "feedback": message}

func pet(actor: Node3D) -> Dictionary:
	if not _near(actor): return {"interacted": false, "reason": "out-of-range"}
	if pat_time > 0.0: return {"interacted": false, "reason": "already-petting"}
	petted_count = mini(999999, petted_count + 1)
	pat_time = 1.3
	_feedback("你摸了摸小麦，它开心地摇起尾巴。")
	return {"interacted": true, "entityId": entity_id, "feedback": notice}

func _unhandled_input(event: InputEvent) -> void:
	if not is_instance_valid(player) or not player.get("input_enabled") or get_tree().paused: return
	if not event is InputEventKey or not event.pressed or event.echo: return
	match event.physical_keycode:
		KEY_F:
			if not _near(player): return
			interact(player)
		KEY_G:
			if not _near(player): return
			pet(player)
		KEY_C:
			following = true
			repath = 0.0
			_feedback("小麦听见了你的呼唤，正向你跑来。")
		_: return
	get_viewport().set_input_as_handled()

# Standard additive component ledger: keep stable identity and played pet state.
func snapshot() -> Dictionary:
	return {"format": SAVE_FORMAT, "entityId": entity_id, "sourceSettings": {"following": true}, "settings": {"following": following}, "position": [global_position.x, global_position.y, global_position.z], "yaw": rotation.y, "pets": petted_count}

func validate_state(data: Dictionary) -> String:
	if not StateContract.fields(data, ["format", "entityId", "sourceSettings", "settings", "position", "yaw", "pets"]): return "Invalid pet state fields"
	if data.format != SAVE_FORMAT or data.entityId != entity_id: return "Pet identity mismatch"
	if not StateContract.fields(data.sourceSettings, ["following"]) or data.sourceSettings.following != true: return "Pet source settings mismatch"
	if not StateContract.fields(data.settings, ["following"]) or not data.settings.following is bool: return "Invalid follow mode"
	if not data.position is Array or data.position.size() != 3: return "Invalid pet position"
	if not StateContract.finite(data.position[0], -30.5, 30.5) or not StateContract.finite(data.position[2], -30.5, 30.5) or not StateContract.finite(data.position[1], -0.1, 12): return "Pet is outside the sandbox"
	if not StateContract.finite(data.yaw, -PI - 0.001, PI + 0.001) or not StateContract.integer(data.pets, 0, 999999): return "Invalid pet progress"
	var point := Vector2(float(data.position[0]), float(data.position[2]))
	if not _clear_point(point, _read_obstacles(), 0.355): return "Pet overlaps a world object"
	return ""

func restore(data: Dictionary) -> String:
	var problem := validate_state(data)
	if not problem.is_empty(): return problem
	following = data.settings.following
	petted_count = int(data.pets)
	global_position = Vector3(float(data.position[0]), float(data.position[1]), float(data.position[2]))
	rotation.y = float(data.yaw)
	velocity = Vector3.ZERO
	route.clear()
	repath = 0.0
	pat_time = 0.0
	notice_time = 0.0
	_update_hud()
	return ""
