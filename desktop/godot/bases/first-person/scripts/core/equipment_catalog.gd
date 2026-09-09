@tool
class_name EquipmentCatalog
extends Resource

## Ordered list of equipment a world can equip. The order is the switch order,
## so the list is data a model can reorder without touching any script.

@export var default_id: StringName = &""
@export var items: Array[EquipmentDefinition] = []


func ids() -> Array[StringName]:
	var result: Array[StringName] = []
	for definition in items:
		if definition != null:
			result.append(definition.id)
	return result


func has_id(id: StringName) -> bool:
	return definition_for(id) != null


func definition_for(id: StringName) -> EquipmentDefinition:
	for definition in items:
		if definition != null and definition.id == id:
			return definition
	return null


func index_of(id: StringName) -> int:
	for index in items.size():
		var definition := items[index]
		if definition != null and definition.id == id:
			return index
	return -1


func next_id(id: StringName) -> StringName:
	if items.is_empty():
		return &""
	var index := index_of(id)
	if index < 0:
		return items[0].id if items[0] != null else &""
	for step in range(1, items.size() + 1):
		var candidate := items[(index + step) % items.size()]
		if candidate != null:
			return candidate.id
	return id


func validate() -> String:
	if items.is_empty():
		return "Equipment catalog is empty"
	var seen := {}
	for definition in items:
		if definition == null:
			return "Equipment catalog contains a null entry"
		var problem := definition.validate()
		if not problem.is_empty():
			return problem
		if seen.has(definition.id):
			return "Duplicate equipment id: " + String(definition.id)
		seen[definition.id] = true
	if not default_id.is_empty() and not seen.has(default_id):
		return "Default equipment is not in the catalog: " + String(default_id)
	return ""
