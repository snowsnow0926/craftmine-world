extends SceneTree
# Trusted repository-authored reflection only. Never instantiate engine classes
# or load a player project to obtain this metadata.

func property_info(value: Dictionary) -> Dictionary:
	var result := value.duplicate(true)
	result["typeName"] = type_string(int(value.get("type", TYPE_NIL)))
	return result

func method_info(value: Dictionary) -> Dictionary:
	var result := value.duplicate(true)
	result.erase("id") # Registration IDs are not a portable API identity.
	var args: Array = []
	for arg in value.get("args", []):
		args.append(property_info(arg))
	result["args"] = args
	result["return"] = property_info(value.get("return", {}))
	var defaults: Array = []
	for item in value.get("default_args", []):
		defaults.append({"type": typeof(item), "typeName": type_string(typeof(item)),
			"representation": "object-default-not-serialized" if typeof(item) == TYPE_OBJECT else var_to_str(item)})
	result["default_args"] = defaults
	return result

func _initialize() -> void:
	if DisplayServer.get_name() != "headless":
		push_error("HEADLESS_REQUIRED")
		quit(1)
		return
	var classes: Array = []
	var names := ClassDB.get_class_list()
	names.sort()
	for class_name_value in names:
		var methods: Array = []
		for item in ClassDB.class_get_method_list(class_name_value, true):
			methods.append(method_info(item))
		var signals: Array = []
		for item in ClassDB.class_get_signal_list(class_name_value, true):
			signals.append(method_info(item))
		var properties: Array = []
		var sections: Array = []
		for item in ClassDB.class_get_property_list(class_name_value, true):
			if int(item.get("usage", 0)) & (PROPERTY_USAGE_CATEGORY | PROPERTY_USAGE_GROUP | PROPERTY_USAGE_SUBGROUP):
				sections.append(property_info(item))
			else:
				properties.append(property_info(item))
		var constants: Array = []
		for constant_name in ClassDB.class_get_integer_constant_list(class_name_value, true):
			constants.append({"name": constant_name,
				"value": str(ClassDB.class_get_integer_constant(class_name_value, constant_name)),
				"enum": ClassDB.class_get_integer_constant_enum(class_name_value, constant_name, true)})
		var enums: Array = []
		for enum_name in ClassDB.class_get_enum_list(class_name_value, true):
			enums.append({"name": enum_name, "constants": Array(ClassDB.class_get_enum_constants(class_name_value, enum_name, true)),
				"bitfield": ClassDB.is_class_enum_bitfield(class_name_value, enum_name, true)})
		classes.append({"name": class_name_value, "inherits": ClassDB.get_parent_class(class_name_value),
			"apiType": ClassDB.class_get_api_type(class_name_value), "enabled": ClassDB.is_class_enabled(class_name_value),
			"instantiable": ClassDB.can_instantiate(class_name_value), "methods": methods, "properties": properties,
			"propertySections": sections, "signals": signals, "enums": enums, "constants": constants})
	var output := FileAccess.open("res://classdb-raw.json", FileAccess.WRITE)
	if output == null:
		push_error("API_DUMP_WRITE_FAILED")
		quit(1)
		return
	output.store_string(JSON.stringify({"engine": Engine.get_version_info(), "headless": true, "classes": classes}))
	output.close()
	print("CRAFTMINE_ENGINE_API_CLASSES=" + str(classes.size()))
	quit(0)
