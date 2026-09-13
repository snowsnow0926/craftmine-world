extends Node3D

var samples: Array = []
var camera: Camera3D
var callback: JavaScriptObject
var frame := 0

func _ready() -> void:
	var environment := WorldEnvironment.new()
	var settings := Environment.new()
	settings.background_mode = Environment.BG_COLOR
	settings.background_color = Color("bdd0d6")
	settings.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	settings.ambient_light_color = Color("e3dac8")
	settings.ambient_light_energy = 0.65
	environment.environment = settings
	add_child(environment)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48, -35, 0)
	sun.light_energy = 1.3
	sun.light_color = Color("ffebce")
	sun.shadow_enabled = true
	add_child(sun)
	var ground := MeshInstance3D.new()
	var mesh := PlaneMesh.new()
	mesh.size = Vector2(180, 180)
	ground.mesh = mesh
	ground.position.y = -0.035
	var material := StandardMaterial3D.new()
	material.albedo_color = Color("927257")
	ground.material_override = material
	add_child(ground)
	for slug in ["ward-building", "gate-section", "ward-street"]:
		var sample = load("res://addons/cw.city." + slug + "/fragment.tscn").instantiate()
		sample.entity_id = "visual-" + slug
		add_child(sample)
		samples.append(sample)
	camera = Camera3D.new()
	camera.current = true
	camera.fov = 42
	camera.far = 300
	add_child(camera)
	_select(0)
	if OS.has_feature("web"):
		callback = JavaScriptBridge.create_callback(_select_from_web)
		JavaScriptBridge.get_interface("window").selectCityFragment = callback
		JavaScriptBridge.eval("window.cityVisualReady=true")

func _process(_delta: float) -> void:
	frame += 1
	if OS.has_feature("web"): JavaScriptBridge.eval("window.cityVisualFrame=" + str(frame))

func _select_from_web(args: Array) -> void:
	_select(int(args[0]))

func _select(index: int) -> void:
	for i in range(samples.size()): samples[i].visible = i == index
	var positions := [Vector3(17, 13, 22), Vector3(45, 32, 48), Vector3(46, 35, 50)]
	var targets := [Vector3(0, 3, 1), Vector3(0, 8, 1), Vector3(0, 3, 0)]
	camera.position = positions[index]
	camera.look_at(targets[index])
