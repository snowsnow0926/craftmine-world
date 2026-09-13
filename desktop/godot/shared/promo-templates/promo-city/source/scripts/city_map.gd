extends Control
var city: Node3D
var map_font: Font
func point(p: Vector3) -> Vector2:
	return Vector2(184 + p.x * 1.3, 320 + p.z * 1.3)
func _process(_delta: float) -> void:
	if visible: queue_redraw()
func _draw() -> void:
	draw_style_box(_panel(), Rect2(0,0,368,385))
	if map_font == null or city == null: return
	draw_string(map_font,Vector2(24,34),"奥格瑞玛 · 城区导览",HORIZONTAL_ALIGNMENT_LEFT,-1,21,Color("efd49b"))
	var boundary := PackedVector2Array()
	for i in range(32):
		var a := TAU * i / 32.0
		boundary.append(point(Vector3(74*cos(a),0,-94-65*sin(a))))
	draw_colored_polygon(boundary,Color("8b532e"))
	for side in [-1,1]:
		draw_rect(Rect2(point(Vector3(side*53-17,0,-170)),Vector2(44,55)),Color("ac6b36"))
		draw_line(point(Vector3(side*68,0,-136)),point(Vector3(side*106,0,-136)),Color("d8b272"),4)
	draw_rect(Rect2(point(Vector3(-27,0,-176)),Vector2(70,65)),Color("bf8447"))
	draw_line(point(Vector3(0,0,0)),point(Vector3(0,0,-128)),Color("efd69b"),5)
	draw_circle(point(Vector3(0,0,-79)),8,Color("ed7a2c"))
	for item in city.PLACES:
		var p: Vector3 = item["at"]
		var visited: bool = city.inventory.has(item["id"])
		draw_circle(point(p),4,Color("f5d17a") if visited else Color("38291d"))
		draw_string(map_font,point(p)+Vector2(7,-6),item["name"],HORIZONTAL_ALIGNMENT_LEFT,-1,12,Color("ffe8bb"))
	var here := point(city.player.global_position)
	draw_circle(here,5,Color("f7fbec"))
	var yaw: float = city.player.look().yaw
	draw_line(here,here+Vector2(-sin(yaw),-cos(yaw))*15,Color("ffffff"),2)
	draw_string(map_font,Vector2(24,362),"白点：你的位置    M 收起    V 全城俯瞰",HORIZONTAL_ALIGNMENT_LEFT,-1,14,Color("d6bb87"))
func _panel() -> StyleBoxFlat:
	var p := StyleBoxFlat.new()
	p.bg_color = Color(0.08,0.055,0.035,0.94)
	p.border_color = Color("b88a42")
	p.set_border_width_all(2)
	p.set_corner_radius_all(8)
	return p
