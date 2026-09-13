extends RefCounted
# Read-only native clearance audit. No temporary controllers are inserted into
# the live scene. This proves support, grade, capsule clearance in both
# directions, and guard presence, NOT a real-time motor/input walkthrough.
func _v(p: Vector3) -> Array:
	return [p.x,p.y,p.z]

func _path(space: PhysicsDirectSpaceState3D, player: CharacterBody3D, path: Array, capsule: CapsuleShape3D) -> Dictionary:
	var samples := 0
	var sweeps := 0
	var highest_step := 0.0
	var previous := Vector3.ZERO
	var has_previous := false
	for leg in range(path.size()-1):
		var a: Vector3 = path[leg]
		var b: Vector3 = path[leg+1]
		var intervals := maxi(1,int(ceil(Vector2(a.x-b.x,a.z-b.z).length()/0.18)))
		for i in range(intervals+1):
			var p := a.lerp(b,float(i)/intervals)
			var ray := PhysicsRayQueryParameters3D.create(p+Vector3.UP*3,p-Vector3.UP*3,3,[player.get_rid()])
			var support := space.intersect_ray(ray)
			if support.is_empty(): return {"passed":false,"reason":"missing-support","at":_v(p),"samples":samples}
			var floor_point: Vector3 = support.position
			var normal: Vector3 = support.normal
			if normal.dot(Vector3.UP)<cos(deg_to_rad(40.0)):
				return {"passed":false,"reason":"steep-support","at":_v(floor_point),"normal":_v(normal)}
			var center := floor_point+Vector3.UP*0.94
			samples += 1
			if has_previous and previous.distance_to(center)>0.0001:
				var rise := absf(center.y-previous.y)
				highest_step = maxf(highest_step,rise)
				if rise>0.12: return {"passed":false,"reason":"support-discontinuity","at":_v(center),"rise":rise}
				for reverse in [false,true]:
					var query := PhysicsShapeQueryParameters3D.new()
					query.shape = capsule
					query.transform = Transform3D(Basis.IDENTITY,center if reverse else previous)
					query.motion = previous-center if reverse else center-previous
					query.collision_mask = 3
					query.exclude = [player.get_rid()]
					query.margin = 0.001
					var fractions := space.cast_motion(query)
					sweeps += 1
					if fractions.size()!=2 or fractions[0]<0.999:
						return {"passed":false,"reason":"capsule-sweep-blocked","from":_v(query.transform.origin),"motion":_v(query.motion),"fractions":Array(fractions),"samples":samples}
			previous = center
			has_previous = true
	return {"passed":true,"supportSamples":samples,"bidirectionalSweeps":sweeps,"maximumAdjacentRise":highest_step}

func run(city: Node3D) -> Dictionary:
	var before: Dictionary = city.player.snapshot().duplicate(true)
	var ledger: Dictionary = city.inventory.duplicate(true)
	var camera: Camera3D = city.get_viewport().get_camera_3d()
	var space := city.get_world_3d().direct_space_state
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.3
	capsule.height = 1.8
	var paths := []
	var passed := true
	for side in [-1,1]:
		var path := [Vector3(side*28,14,-171),Vector3(side*37,13.8,-171),Vector3(side*37,9,-152),Vector3(side*42,9,-152)]
		var result := _path(space,city.player,path,capsule)
		result["side"] = "east" if side==1 else "west"
		paths.append(result)
		passed = passed and result.passed
		path = [Vector3(side*36.4433136,13.8,-169.2212677),Vector3(side*36.4433136,9,-152)]
		result = _path(space,city.player,path,capsule)
		result["side"] = "east-reported-offset" if side==1 else "west-mirrored-offset"
		paths.append(result)
		passed = passed and result.passed
	var guards := []
	for side in [-1,1]:
		for segment in [[Vector3(side*32,14.8,-171),Vector3(side*32,14.8,-168)],[Vector3(side*37,14.8,-171),Vector3(side*37,14.8,-174)],[Vector3(side*37,12.45,-163),Vector3(side*40,12.45,-163)],[Vector3(side*37,12.45,-163),Vector3(side*34,12.45,-163)]]:
			var ray := PhysicsRayQueryParameters3D.create(segment[0],segment[1],1)
			var hit := space.intersect_ray(ray)
			guards.append(not hit.is_empty())
			passed = passed and not hit.is_empty()
	var preserved: bool = city.player.snapshot()==before and city.inventory==ledger and city.get_viewport().get_camera_3d()==camera
	var report := {"format":"orgrimmar.bridge-clearance-audit/1","passed":passed and preserved,"playerAndProgressUnchanged":preserved,"capsule":[0.3,1.8],"supportClearance":0.04,"paths":paths,"guardHits":guards,"realTimeWalk":"not-verified"}
	print("BRIDGE_CLEARANCE_AUDIT "+JSON.stringify(report))
	return report
