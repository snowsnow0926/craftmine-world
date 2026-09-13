extends Node3D

# An authored input fixture, installed before the source-integrity baseline.
# Only normal engine events and polling change its visible behavior.
var _label: Label3D
var _material: StandardMaterial3D
var _was_w := false

func _ready() -> void:
	var box := MeshInstance3D.new()
	box.mesh = BoxMesh.new()
	box.position = Vector3(2, 1, 1)
	_material = StandardMaterial3D.new()
	_material.albedo_color = Color(0.1, 0.4, 0.9)
	box.material_override = _material
	add_child(box)
	_label = Label3D.new()
	_label.position = Vector3(2, 2, 1)
	_label.text = "F: READY"
	_label.font_size = 64
	add_child(_label)

func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.physical_keycode == KEY_F:
		print("FIXTURE_F ", event.pressed, " echo=", event.echo)
		if event.pressed:
			_label.text = "F: CONSUMED"
			_material.albedo_color = Color(0.95, 0.3, 0.15)
	if event is InputEventMouseButton:
		# This fixture owns its button control, so the base's unhandled
		# click-to-capture behavior is not invoked.
		get_viewport().set_input_as_handled()
		print("FIXTURE_BUTTON ", event.button_index, " ", event.pressed)
	if event is InputEventMouseMotion and event.relative.length() > 0:
		print("FIXTURE_MOTION ", event.relative)

func _physics_process(_delta: float) -> void:
	var held := Input.is_physical_key_pressed(KEY_W)
	if held != _was_w:
		print("FIXTURE_W_POLL ", held, " frame=", Engine.get_physics_frames())
		_was_w = held
