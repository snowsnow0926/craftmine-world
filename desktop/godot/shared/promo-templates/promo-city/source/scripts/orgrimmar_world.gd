extends "res://scripts/creation_world.gd"

const CitySurface = preload("res://shaders/city_surface.gdshader")
const GuardScript = preload("res://scripts/city_guard.gd")
const GuardModel = preload("res://assets/blender/orgrimmar-grunt.glb")
const MapScript = preload("res://scripts/city_map.gd")
const PLACES := [
	{"id":"org-gate","name":"奥格瑞玛城门","at":Vector3(0,0,-41),"radius":13.0},
	{"id":"org-strength","name":"力量谷","at":Vector3(0,0,-79),"radius":22.0},
	{"id":"org-drag","name":"暗巷集市","at":Vector3(-40,0,-87),"radius":18.0},
	{"id":"org-honor","name":"荣誉高地","at":Vector3(52,9,-143),"radius":19.0},
	{"id":"org-spirit","name":"精神高地","at":Vector3(-53,9,-148),"radius":20.0},
	{"id":"org-hall","name":"酋长大厅","at":Vector3(0,14,-146),"radius":19.0}
]
var city_title: Label
var district_label: Label
var guide_label: Label
var message_label: Label
var city_map: Control
var overview: Camera3D
var guards: Array[CharacterBody3D] = []
var fire_lights: Array[OmniLight3D] = []
var elapsed := 0.0
var message_time := 0.0
var surface_probe: Array = []
var city_materials := {}
var collider_count := 0

func _build_environment() -> void:
	var world_env := WorldEnvironment.new()
	var settings := Environment.new()
	settings.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color("638dad")
	sky_mat.sky_horizon_color = Color("dfb58b")
	sky_mat.ground_bottom_color = Color("715541")
	sky_mat.ground_horizon_color = Color("dfb58b")
	sky.sky_material = sky_mat
	settings.sky = sky
	settings.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	settings.ambient_light_color = Color("dbd2bd")
	settings.ambient_light_energy = 0.57
	settings.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	settings.fog_enabled = true
	settings.fog_light_color = Color("c79b77")
	settings.fog_density = 0.0017
	world_env.environment = settings
	add_child(world_env)
	sun = DirectionalLight3D.new()
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 180
	sun.light_color = Color("ffe0b5")
	add_child(sun)
	_prepare_geometry($Architecture)
	_prepare_geometry($Wards)
	_prepare_geometry($Canyon)
	marker = MeshInstance3D.new()
	var sphere := SphereMesh.new()
	sphere.radius = 0.025
	sphere.height = 0.05
	marker.mesh = sphere
	marker.material_override = _material(Color("e3c994"),true)
	marker.visible = false
	add_child(marker)
	# The keep's modeled 13.7m shelf is levelled to its 14m hall/ramp.
	_solid(self,Vector3(58,0.3,50),Vector3(0,13.85,-153),"citadel-floor")
	overview = Camera3D.new()
	overview.name = "CityOverview"
	overview.fov = 54
	overview.far = 800
	add_child(overview)
	overview.position = Vector3(137,122,91)
	overview.look_at(Vector3(0,12,-93))

func _prepare_geometry(node: Node) -> void:
	if node is MeshInstance3D:
		var mesh_node := node as MeshInstance3D
		var solid: bool = str(node.name).begins_with("Solid_") or str(node.name).begins_with("HiddenSolid_")
		if solid:
			var faces := mesh_node.mesh.get_faces()
			for i in range(faces.size()):
				if str(node.name) == "Solid_Approach_wood" and absf(faces[i].y + 0.2) < 0.02:
					faces[i].y = 0.0
				if str(node.name).begins_with("Solid_UpperWard") and str(node.name).ends_with("_wood") and absf(faces[i].y - 8.8) < 0.02:
					faces[i].y = 9.0
			var shape := ConcavePolygonShape3D.new()
			shape.set_faces(faces)
			shape.backface_collision = true
			var body := StaticBody3D.new()
			body.name = "AuthoredCollision"
			body.collision_layer = 1
			body.collision_mask = 8
			body.set_meta("surface","city-architecture")
			var col := CollisionShape3D.new()
			col.shape = shape
			body.add_child(col)
			mesh_node.add_child(body)
			collider_count += 1
		if str(node.name).begins_with("HiddenSolid_"):
			mesh_node.visible = false
		else:
			for i in range(mesh_node.mesh.get_surface_count()):
				var original := mesh_node.mesh.surface_get_material(i) as StandardMaterial3D
				if original == null: continue
				var key: String = original.resource_name
				if not city_materials.has(key):
					var material := ShaderMaterial.new()
					material.shader = CitySurface
					material.set_shader_parameter("base_color",original.albedo_color)
					var kind := 0.0
					if key.begins_with("wood") or key == "trunk": kind = 1.0
					elif key.begins_with("red"): kind = 2.0
					elif key in ["iron","edge","gold"]: kind = 3.0
					elif key.begins_with("palm"): kind = 4.0
					elif key in ["fire","heart"]: kind = 5.0
					elif key in ["water","foam"]: kind = 6.0
					material.set_shader_parameter("kind",kind)
					city_materials[key] = material
				mesh_node.set_surface_override_material(i,city_materials[key])
	for child in node.get_children():
		_prepare_geometry(child)

func _update_time() -> void:
	if sun == null: return
	sun.rotation_degrees = Vector3(-30.0-18.0*sin(time_of_day/24.0*PI),-38,0)
	sun.light_energy = 0.25+1.25*maxf(0.0,sin(time_of_day/24.0*PI))

func _ready() -> void:
	super._ready()
	if not ready_for_play: return
	status_label.text = "WASD 行走 · 空格跳跃 · E 交谈 · M 地图 · V 俯瞰 · Esc 释放鼠标"
	status_label.position = Vector2(22,100)
	status_label.add_theme_color_override("font_color",Color("d7c399"))
	selection_label.position = Vector2(22,127)
	var layer := CanvasLayer.new()
	layer.name = "OrgrimmarGuide"
	add_child(layer)
	city_title = _city_label(layer,Vector2(22,17),30,Color("f1d09a"))
	city_title.text = "奥 格 瑞 玛"
	district_label = _city_label(layer,Vector2(24,59),17,Color("e8d0a8"))
	guide_label = _city_label(layer,Vector2(24,153),16,Color("f0d398"))
	message_label = _city_label(layer,Vector2(24,190),18,Color("fff0cd"))
	city_map = MapScript.new()
	city_map.city = self
	city_map.map_font = creation_font
	city_map.position = Vector2(22,232)
	city_map.mouse_filter = Control.MOUSE_FILTER_IGNORE
	city_map.visible = false
	layer.add_child(city_map)
	_add_guard("gate-west",Vector3(-6,0,-43),[],"欢迎来到奥格瑞玛。前方是力量谷；过篝火后登阶，可进入酋长大厅。")
	_add_guard("gate-east",Vector3(6,0,-43),[],"力量与荣耀！M 查看地图，V 从高空看全城。你的行走位置会保留。")
	_add_guard("strength-patrol-west",Vector3(-11,0,-57),[Vector3(-11,0,-57),Vector3(-11,0,-94)],"西面是暗巷集市。继续向北，石阶连接精神高地与峡谷吊桥。")
	_add_guard("strength-patrol-east",Vector3(11,0,-94),[Vector3(11,0,-94),Vector3(11,0,-57)],"东侧是荣誉高地。外侧吊桥通往峡谷哨塔，小心脚下。")
	_add_guard("hall-sentinel",Vector3(5,14,-145),[],"这里是酋长大厅。王座位于大厅深处，露台可以俯瞰整座城市。")
	_add_guard("honor-sentinel",Vector3(53,9,-136),[],"荣誉高地与力量谷由长阶相连。桥的另一端是我们的瞭望哨。")
	for p in [Vector3(0,4,-79),Vector3(-4,3,-31),Vector3(4,3,-31),Vector3(-12,17,-154),Vector3(12,17,-154),Vector3(-9,2.5,-66),Vector3(9,2.5,-94)]:
		var light := OmniLight3D.new()
		light.position = p
		light.light_color = Color("ff9c36")
		light.omni_range = 12 if p.z == -79 else 7
		light.light_energy = 2.0
		add_child(light)
		fire_lights.append(light)
	_show_message("点击画面开始探索。走过吊桥进入城门，沿主路寻找篝火广场。",9)

func _city_label(layer: CanvasLayer, p: Vector2, font_size: int, color: Color) -> Label:
	var label := Label.new()
	label.position = p
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.add_theme_font_override("font",creation_font)
	label.add_theme_font_size_override("font_size",font_size)
	label.add_theme_color_override("font_color",color)
	label.add_theme_color_override("font_shadow_color",Color(0.08,0.04,0.02,0.9))
	label.add_theme_constant_override("shadow_offset_x",1)
	label.add_theme_constant_override("shadow_offset_y",2)
	layer.add_child(label)
	return label

func _add_guard(id: String, at: Vector3, route: Array, words: String) -> void:
	var guard := CharacterBody3D.new()
	guard.set_script(GuardScript)
	guard.name = "Guard_" + id
	guard.set_meta("entity_id","org-guard-"+id)
	guard.position = at
	guard.visitor = player
	guard.greeting = words
	for p in route: guard.route.append(p)
	var visual := GuardModel.instantiate() as Node3D
	guard.visual = visual
	guard.add_child(visual)
	add_child(guard)
	guards.append(guard)

func _process(delta: float) -> void:
	if not ready_for_play or district_label == null: return
	elapsed += delta
	message_time = maxf(0.0,message_time-delta)
	message_label.visible = message_time > 0
	var district := "杜隆塔尔 · 城外吊桥"
	for place in PLACES:
		var pos: Vector3 = place.at
		if player.position.distance_to(pos+Vector3.UP) < float(place.radius):
			district = place.name
			if not inventory.has(place.id):
				inventory[place.id] = 1
				_show_message("发现：" + str(place.name),4)
	var count := 0
	for place in PLACES:
		if inventory.has(place.id): count += 1
	district_label.text = district + "  /  已探索 %d / 6" % count
	if overview.current:
		guide_label.text = "全城俯瞰 · V 返回原处步行"
	else:
		guide_label.text = "靠近守卫后按 E 交谈" if _near_guard() != null else ("已踏遍六个城区。还可以穿过吊桥，探索峡谷哨塔。" if count == 6 else "探索六个城区 · M 展开导览地图")
	for i in range(fire_lights.size()):
		fire_lights[i].light_energy = 1.7 + 0.22*sin(elapsed*7.0+i*2.4)+0.11*sin(elapsed*13.0+i)

func _physics_process(delta: float) -> void:
	super._physics_process(delta)
	if not ready_for_play: return
	if physics_tick == 90: _probe_routes()
	if player.position.y < -20:
		player.position = Vector3(0,0.95,6)
		player.velocity = Vector3.ZERO
		_show_message("你已返回城外安全落脚点。",4)

func _near_guard() -> CharacterBody3D:
	for guard in guards:
		if player.position.distance_to(guard.position+Vector3.UP) < 3.5:
			return guard
	return null

func _unhandled_input(event: InputEvent) -> void:
	if not ready_for_play: return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.physical_keycode == KEY_M:
			city_map.visible = not city_map.visible
			get_viewport().set_input_as_handled()
			return
		if event.physical_keycode == KEY_V:
			var enter := not overview.current
			player.set_movement_lock(self,enter)
			if enter: overview.make_current()
			else: player.camera_rig.camera.make_current()
			get_viewport().set_input_as_handled()
			return
	if event.is_action_pressed("interact"):
		var guard := _near_guard()
		if guard != null:
			_show_message(guard.greeting,8)
			get_viewport().set_input_as_handled()
			return
	super._unhandled_input(event)

func _show_message(words: String, duration: float) -> void:
	if message_label == null: return
	message_label.text = words
	message_time = duration

func _probe_routes() -> void:
	# Real physics surface samples, NOT an assertion of full route traversal.
	var anchors := [Vector3(0,0,6),Vector3(0,0,-15),Vector3(0,0,-35),Vector3(0,0,-55),Vector3(8,0,-79),Vector3(0,7,-112),Vector3(0,14,-129),Vector3(0,14,-147),Vector3(43,4.5,-114.5),Vector3(43,9,-128.5),Vector3(83,9,-136),Vector3(-83,9,-136)]
	for p in anchors:
		var query := PhysicsRayQueryParameters3D.create(p+Vector3.UP*2.0,p-Vector3.UP*2.0,1)
		var hit := get_world_3d().direct_space_state.intersect_ray(query)
		surface_probe.append({"at":[p.x,p.y,p.z],"surfaceHit":not hit.is_empty(),"height":hit.position.y if not hit.is_empty() else null})

func observe() -> Dictionary:
	var result := super.observe()
	var patrols := []
	for guard in guards:
		patrols.append({"id":guard.get_meta("entity_id"),"position":[guard.position.x,guard.position.y,guard.position.z],"moving":Vector2(guard.velocity.x,guard.velocity.z).length()>0.1})
	result["city"] = {"title":"奥格瑞玛","districts":6,"authoredBuildings":22,"colliderMeshes":collider_count,"surfaceSamples":surface_probe.duplicate(true),"guards":patrols,"overview":overview.current if overview != null else false}
	return result

func validate_progress(data: Variant) -> String:
	# Same progress contract as the original world; only the authored city bounds expand.
	if not Contract.fields(data,["format","worldId","baseVersion","player","timeOfDay","sourceTimeOfDay","inventory","openedChests","doors","rules"]) or data.format != "craftmine.creation-progress/1" or data.worldId != world_id or data.baseVersion != BASE_VERSION:
		return "Creation progress identity or fields do not match"
	if JSON.stringify(data).to_utf8_buffer().size() > 262144 or not _json_value(data,0): return "Creation progress exceeds safe JSON limits"
	if not Contract.finite(data.sourceTimeOfDay,0,24) or data.sourceTimeOfDay != scene_data.defaults.timeOfDay: return "Creation progress needs the current source time default"
	if not Contract.finite(data.timeOfDay,0,24): return "Invalid saved time"
	if not Contract.fields(data.player,["position","yaw","pitch","onFloor"]) or not data.player.onFloor is bool: return "Invalid saved player"
	var p: Variant = data.player.position
	if not p is Array or p.size()!=3 or not Contract.finite(p[0],-240,240) or not Contract.finite(p[1],-20,160) or not Contract.finite(p[2],-300,80) or not Contract.finite(data.player.yaw,-PI,PI) or not Contract.finite(data.player.pitch,-deg_to_rad(89),deg_to_rad(89)):
		return "Saved player pose is outside the authored city"
	for key in ["inventory","openedChests","doors","rules"]:
		if not data[key] is Dictionary or data[key].size()>4096: return "Invalid saved ledger: "+key
		for id in data[key]:
			if not Contract.identifier(id): return "Invalid saved stable ID"
	for id in data.inventory:
		if not Contract.integer(data.inventory[id],0,999999): return "Invalid inventory count"
	for id in data.openedChests:
		if not data.openedChests[id] is bool or data.openedChests[id]!=true: return "Invalid one-time chest ledger"
	for id in data.doors:
		if not data.doors[id] is bool: return "Invalid saved door state"
	for id in data.rules:
		if not data.rules[id] is Dictionary: return "Invalid saved rule state"
		if rule_nodes.has(id):
			var problem: Variant = rule_nodes[id].validate_state(data.rules[id])
			if not problem is String or not problem.is_empty(): return "Authored rule rejected progress: "+id+": "+str(problem)
	for id in entities:
		if entities[id].kind=="door" and not data.doors.has(id): return "Creation progress needs the new door default: "+id
	for definition in scene_data.get("rules",[]):
		if not data.rules.has(definition.id): return "Creation progress needs the new rule default: "+definition.id
		if definition.kind=="sequence-door" and data.rules[definition.id].get("completed",false) and not data.doors.get(definition.doorId,false): return "Completed rule requires its open door: "+definition.id
	var projected := _project_entity_states(data)
	if not projected.error.is_empty(): return projected.error
	var collision := _player_overlap(Vector3(p[0],p[1],p[2]),data.doors,projected.states)
	if not collision.is_empty(): return "Saved player overlaps candidate entity: "+collision
	return ""
