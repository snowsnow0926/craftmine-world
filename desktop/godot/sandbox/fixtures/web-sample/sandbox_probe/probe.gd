extends RefCounted

# Shared probe used by editor-time code paths (@tool resource and editor plugin).# It only measures whether the execution boundary still holds while the editor
# runs model-adjacent code; it never attacks anything outside the task directory.

const RESULT_PATH := "res://probe_result.txt"
const TARGETS_PATH := "res://probe_targets.cfg"


static func run(label: String) -> void:
	var targets := ConfigFile.new()
	var sentinel := ""
	var external_host := "192.0.2.1"
	var external_port := 80
	var loopback_host := "127.0.0.1"
	var loopback_port := 0
	if targets.load(TARGETS_PATH) == OK:
		sentinel = str(targets.get_value("probe", "sentinel", ""))
		external_host = str(targets.get_value("probe", "external_host", external_host))
		external_port = int(targets.get_value("probe", "external_port", external_port))
		loopback_host = str(targets.get_value("probe", "loopback_host", loopback_host))
		loopback_port = int(targets.get_value("probe", "loopback_port", loopback_port))

	var lines: PackedStringArray = PackedStringArray()
	lines.append("%s_ran=true" % label)

	if sentinel != "":
		var read_handle := FileAccess.open(sentinel, FileAccess.READ)
		lines.append("%s_file_read=%s" % [label, "denied" if read_handle == null else "ALLOWED"])
		if read_handle != null:
			read_handle.close()
		var write_handle := FileAccess.open(sentinel, FileAccess.WRITE)
		lines.append("%s_file_write=%s" % [label, "denied" if write_handle == null else "ALLOWED"])
		if write_handle != null:
			write_handle.close()
		var escape := sentinel.get_base_dir().path_join("editor-escape.txt")
		var escape_handle := FileAccess.open(escape, FileAccess.WRITE)
		lines.append("%s_sibling_write=%s" % [label, "denied" if escape_handle == null else "ALLOWED"])
		if escape_handle != null:
			escape_handle.close()

	lines.append("%s_external_connect=%s" % [label, _connect(external_host, external_port, 1500)])
	lines.append("%s_loopback_connect=%s" % [label, _connect(loopback_host, loopback_port, 1500)])
	lines.append("%s_spawn=%s" % [label, _spawn()])

	var handle := FileAccess.open(RESULT_PATH, FileAccess.READ_WRITE)
	if handle == null:
		handle = FileAccess.open(RESULT_PATH, FileAccess.WRITE)
	if handle == null:
		push_error("sandbox probe cannot write its result file")
		return
	handle.seek_end()
	handle.store_line("\n".join(lines))
	handle.close()


static func _connect(host: String, port: int, timeout_ms: int) -> String:
	if port <= 0:
		return "not-configured"
	var peer := StreamPeerTCP.new()
	var error := peer.connect_to_host(host, port)
	# Only an explicit authorization error establishes denial. Generic socket
	# failure, refused connection and timeout cannot establish policy isolation.
	if error == ERR_UNAUTHORIZED:
		return "denied(unauthorized)"
	if error != OK:
		return "unknown(error=%d)" % error
	var started := Time.get_ticks_msec()
	while Time.get_ticks_msec() - started < timeout_ms:
		peer.poll()
		var status := peer.get_status()
		if status == StreamPeerTCP.STATUS_CONNECTED:
			peer.disconnect_from_host()
			return "ALLOWED"
		if status == StreamPeerTCP.STATUS_ERROR:
			return "unknown(status=error)"
	return "unknown(timeout)"


static func _spawn() -> String:
	var pid := OS.create_process(OS.get_executable_path(), ["--headless", "--version"])
	return "ALLOWED(pid=%d)" % pid if pid > 0 else "denied(error=%d)" % pid
