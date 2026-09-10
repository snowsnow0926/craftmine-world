extends RefCounted

const FORMAT := "craftmine.creation-scene/1"
const ID_PATTERN := "^[a-z][a-z0-9_-]{0,63}$"

static func identifier(value: Variant) -> bool:
	if not value is String:
		return false
	var pattern := RegEx.new()
	pattern.compile(ID_PATTERN)
	var found := pattern.search(value)
	return found != null and found.get_string() == value

static func finite(value: Variant, minimum: float, maximum: float) -> bool:
	return (value is float or value is int) and is_finite(float(value)) and value >= minimum and value <= maximum

static func integer(value: Variant, minimum: int, maximum: int) -> bool:
	return finite(value, minimum, maximum) and float(value) == floorf(float(value))

static func fields(value: Variant, required: Array, optional: Array = []) -> bool:
	if not value is Dictionary:
		return false
	for key in required:
		if not value.has(key):
			return false
	for key in value:
		if not key in required and not key in optional:
			return false
	return true

static func validate(scene: Variant) -> String:
	if not fields(scene, ["format", "revision", "defaults", "entities"], ["rules"]) or scene.format != FORMAT:
		return "Unsupported creation scene format or fields"
	if not integer(scene.revision, 1, 2147483647):
		return "Invalid creation scene revision"
	if not fields(scene.defaults, ["timeOfDay"]) or not finite(scene.defaults.timeOfDay, 0, 24):
		return "Invalid default timeOfDay"
	if not scene.entities is Array or scene.entities.size() > 128:
		return "Creation scene exceeds 128 entities"
	var entities := {}
	for entity in scene.entities:
		if not fields(entity, ["id", "kind", "position", "rotationY", "scale", "color", "parameters"]):
			return "Unsupported entity fields"
		if not identifier(entity.id) or entities.has(entity.id):
			return "Invalid or duplicate entity ID"
		entities[entity.id] = entity
		if not entity.kind in ["tree", "rock", "chest", "door", "marker"]:
			return "Unsupported entity kind"
		if not entity.position is Array or entity.position.size() != 3 or not finite(entity.position[0], -28, 28) or not finite(entity.position[1], 0, 16) or not finite(entity.position[2], -28, 28):
			return "Entity position is outside the creation bounds"
		if not finite(entity.rotationY, -180, 180) or not entity.scale is Array or entity.scale.size() != 3:
			return "Invalid entity transform"
		for value in entity.scale:
			if not finite(value, 0.25, 4):
				return "Invalid entity scale"
		var color_pattern := RegEx.new()
		color_pattern.compile("^#[a-fA-F0-9]{6}$")
		if not entity.color is String or entity.color.length() != 7 or color_pattern.search(entity.color) == null:
			return "Invalid entity color"
		var keys := []
		match entity.kind:
			"chest": keys = ["rewardId", "rewardCount"]
			"door": keys = ["initiallyOpen"]
			"marker": keys = ["label"]
		if not fields(entity.parameters, [], keys):
			return "Unsupported entity parameters"
		var p: Dictionary = entity.parameters
		if p.has("rewardId") and not identifier(p.rewardId):
			return "Invalid source-local reward ID"
		if p.has("rewardCount") and not integer(p.rewardCount, 1, 99):
			return "Invalid reward count"
		if p.has("initiallyOpen") and not p.initiallyOpen is bool:
			return "Invalid door initial state"
		if p.has("label") and (not p.label is String or p.label.length() > 80):
			return "Invalid marker label"
	var rules: Variant = scene.get("rules", [])
	if not rules is Array or rules.size() > 8:
		return "Creation scene exceeds eight rules"
	var rule_ids := {}
	for rule in rules:
		if not fields(rule, ["id", "kind", "doorId", "sequence", "script", "sha256"]):
			return "Unsupported authored rule fields"
		if not identifier(rule.id) or rule_ids.has(rule.id):
			return "Invalid or duplicate rule ID"
		rule_ids[rule.id] = true
		if rule.kind != "sequence-door" or not entities.has(rule.doorId) or entities[rule.doorId].kind != "door":
			return "Rule requires a declared door"
		if not rule.sequence is Array or rule.sequence.size() < 2 or rule.sequence.size() > 16:
			return "Rule requires 2..16 markers"
		var seen := {}
		for marker in rule.sequence:
			if not marker is String or seen.has(marker) or not entities.has(marker) or entities[marker].kind != "marker":
				return "Rule requires distinct declared markers"
			seen[marker] = true
		if rule.script != "scripts/creation/rules/" + rule.id + ".gd":
			return "Invalid rule script path"
		var hash_pattern := RegEx.new()
		hash_pattern.compile("^[a-f0-9]{64}$")
		if not rule.sha256 is String or rule.sha256.length() != 64 or hash_pattern.search(rule.sha256) == null:
			return "Invalid rule script hash"
	return ""
