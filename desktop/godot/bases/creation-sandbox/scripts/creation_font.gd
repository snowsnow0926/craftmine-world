extends RefCounted

# Full regular-weight CJK coverage derived from the repository's OFL font.
# Text parts stay within the existing source transaction's 4 MiB file limit.
static func load_font() -> FontFile:
	var manifest_text := FileAccess.get_file_as_string("res://assets/fonts/font.json")
	var manifest: Variant = JSON.parse_string(manifest_text)
	if not manifest is Dictionary or manifest.get("format") != "craftmine.font/1" or not manifest.get("parts") is Array or manifest.parts.size() != 2:
		return null
	var encoded := ""
	for index in range(2):
		var info: Variant = manifest.parts[index]
		var name := "cjk-%d.json" % index
		if not info is Dictionary or info.get("path") != name:
			return null
		var file := FileAccess.open("res://assets/fonts/" + name, FileAccess.READ)
		if file == null or file.get_length() > 4194304 or file.get_length() != info.get("bytes"):
			return null
		var text := file.get_as_text()
		file.close()
		if text.sha256_text() != info.get("sha256"):
			return null
		var part: Variant = JSON.parse_string(text)
		if not part is Dictionary or part.get("format") != "craftmine.font-part/1" or part.get("index") != index or not part.get("data") is String:
			return null
		encoded += part.data
	if encoded.length() > 5700000:
		return null
	var data := Marshalls.base64_to_raw(encoded)
	if data.size() != manifest.get("bytes") or data.size() > 4194304:
		return null
	var hashing := HashingContext.new()
	hashing.start(HashingContext.HASH_SHA256)
	hashing.update(data)
	if hashing.finish().hex_encode() != manifest.get("sha256"):
		return null
	var font := FontFile.new()
	font.data = data
	if not font.has_char("移".unicode_at(0)) or not font.has_char("龘".unicode_at(0)):
		return null
	return font
