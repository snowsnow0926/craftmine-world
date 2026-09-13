extends SceneTree
var failures: Array[String] = []
func verify(value: bool, label: String) -> void:
	if not value: failures.append(label)
	print(JSON.stringify({"check":label,"passed":value}))
func _initialize() -> void:
	run.call_deferred()
func run() -> void:
	change_scene_to_file("res://scenes/creation.tscn")
	for i in range(60): await process_frame
	var bridge: Node = root.get_node("CraftmineRuntime")
	var scope := {"worldId":"world-visual-test","buildId":"build-test","instanceId":"instance-test"}
	var req := scope.duplicate()
	req.merge({"id":1,"op":"load","args":{}})
	var loaded: Dictionary = await bridge.handle_request(req)
	verify(loaded.has("result"),"world loaded")
	var before: Dictionary = bridge.snapshot().duplicate(true)
	var args := {"action":"place","previewId":"preview-one","sequence":1,"kind":"tree","position":[6,0,0],"scale":[1,1,1],"rotationY":45,"color":"#ffffff"}
	req.merge({"id":2,"op":"creation-preview","args":args},true)
	var result: Dictionary = await bridge.handle_request(req)
	print(JSON.stringify(result))
	verify(result.get("result",{}).get("status")=="visible","actual preview geometry created")
	var ghost: Node = current_scene.get_node_or_null("CraftmineTemporaryPlacementPreview")
	verify(ghost!=null and ghost.get_child_count()==2,"tree uses actual trunk and canopy meshes")
	verify(current_scene.entities.size()==1,"preview never enters authored entity map")
	verify(bridge.snapshot()==before,"preview leaves complete saved state unchanged")
	if ghost != null:
		verify(ghost.get_children().all(func(node): return node is MeshInstance3D and node.get_script()==null),"preview contains meshes only, no scripts or collision bodies")
	args.position=[current_scene.player.position.x,0,current_scene.player.position.z];args.sequence=2
	result=await bridge.handle_request(req)
	verify(result.get("result",{}).get("valid")==false,"physical overlap rejected in live world")
	args.position=[27.9,0,0];args.sequence=3
	result=await bridge.handle_request(req)
	verify(result.get("result",{}).get("reason")=="CREATION_OUT_OF_BOUNDS","rotated bounds checked")
	req.args={"action":"cancel","previewId":"preview-one","sequence":4}
	result=await bridge.handle_request(req)
	verify(current_scene.get_node_or_null("CraftmineTemporaryPlacementPreview")==null,"cancel removes actual preview immediately")
	req.args=args;args.sequence=5;args.position=[6,0,0]
	await bridge.handle_request(req)
	req.op="observe-envelope";req.args={}
	await bridge.handle_request(req)
	verify(current_scene.get_node_or_null("CraftmineTemporaryPlacementPreview")==null,"authoritative observation cannot sample temporary meshes")
	verify(bridge.snapshot()==before,"repeated preview and cancellation preserve all progress")
	for kind in ["rock", "chest", "door", "marker"]:
		req.op="creation-preview";req.args={"action":"place","previewId":"preview-"+kind,"sequence":1,"kind":kind,"position":[6,0,0],"scale":[1,1,1],"rotationY":30,"color":"#ffffff"}
		result=await bridge.handle_request(req)
		verify(result.get("result",{}).get("status")=="visible",kind+" generator renders its actual geometry")
	var entity: Node3D = current_scene.entity_nodes["tree-existing"]
	var original_transform := entity.transform
	req.op="creation-preview";req.args={"action":"modify","previewId":"preview-move","sequence":1,"targetId":"tree-existing","position":[12,0,0],"scale":[1.5,1.5,1.5],"rotationY":90,"color":"#ffffff"}
	result=await bridge.handle_request(req)
	ghost=current_scene.get_node_or_null("CraftmineTemporaryPlacementPreview")
	verify(ghost!=null and ghost.position==Vector3(12,0,0) and ghost.get_child_count()==2,"modify previews actual selected meshes at the proposed transform")
	verify(entity.transform==original_transform,"modify preview leaves the real selected object unchanged")
	req.op="save";req.args={}
	await bridge.handle_request(req)
	verify(current_scene.get_node_or_null("CraftmineTemporaryPlacementPreview")==null,"save clears temporary geometry before producing progress")
	verify(bridge.snapshot()==before,"all five generators and move preview preserve saved state")
	print(JSON.stringify({"status":"passed" if failures.is_empty() else "failed","failures":failures}))
	quit(0 if failures.is_empty() else 1)
