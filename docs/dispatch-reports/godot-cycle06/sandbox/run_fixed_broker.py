"""Fixed, no-window broker acceptance harness; no user UI or arbitrary project."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import time
import shutil
import ctypes

parser = argparse.ArgumentParser()
parser.add_argument("case", choices=["version", "import", "exportWeb", "eof", "cancel", "terminate", "adversarial"])
args = parser.parse_args()
repo = pathlib.Path(__file__).resolve().parents[4]
sandbox = repo / "desktop/godot/sandbox"
binary = sandbox / "target/debug/godot-host-broker.exe"
evidence = pathlib.Path(__file__).parent / "evidence"
evidence.mkdir(exist_ok=True)
tasks = sandbox / "out/broker-cycle06"
tasks.mkdir(parents=True, exist_ok=True)
task_id = "g6-" + args.case.lower() + "-" + str(time.time_ns())
operation = "version" if args.case == "eof" else "import" if args.case in ("cancel", "terminate", "adversarial") else args.case
project = None if operation == "version" else sandbox / "fixtures/web-sample"
if args.case in ("cancel", "terminate"):
    project = sandbox / "out" / (task_id + "-fixed-sleep")
    shutil.copytree(sandbox / "fixtures/web-sample", project)
    (project / "probe_resource.gd").write_text('@tool\nextends Resource\n\nfunc _init():\n\tprint("G6_FIXED_SLEEP_READY")\n\tOS.delay_msec(30000)\n', encoding="utf-8")
if args.case == "adversarial":
    project = sandbox / "out" / (task_id + "-fixed-negative")
    shutil.copytree(sandbox / "fixtures/web-sample", project)
    denied_world = sandbox / "out" / (task_id + "-synthetic-world")
    denied_world.mkdir()
    sentinel = denied_world / "synthetic-sentinel.txt"
    sentinel.write_text("g6-private-synthetic-sentinel", encoding="utf-8")
    (project / "probe_targets.cfg").write_text('[probe]\nsentinel="' + sentinel.as_posix() + '"\nexternal_host="192.0.2.1"\nexternal_port=80\nloopback_host="127.0.0.1"\nloopback_port=0\n', encoding="utf-8")
    source = project / "sandbox_probe/probe.gd"
    text = source.read_text(encoding="utf-8")
    marker = '\tlines.append("%s_spawn=%s" % [label, _spawn()])'
    assert marker in text
    source.write_text(text.replace(marker, marker + '\n\tprint("G6_BOUNDARY_RESULT|" + "|".join(lines))'), encoding="utf-8")
request = {
    "schemaVersion": 1, "requestId": task_id, "taskId": task_id,
    "operation": operation,
    "projectRoot": str(project) if project else None,
    "tasksRoot": str(tasks),
    "engineRoot": "D:/Craftmine World/desktop/build/godot/4.7.2-stable",
    "sourceBinding": {"worldId": "fixed-g6-fixture", "buildId": task_id,
                      "sourceRevision": 1, "sourceDigest": "0" * 64},
    "inputHash": hashlib.sha256(task_id.encode()).hexdigest(),
}
prefix = evidence / task_id
prefix.with_suffix(".request.json").write_text(json.dumps(request, ensure_ascii=False), encoding="utf-8")
with prefix.with_suffix(".stdout.json").open("wb") as stdout, prefix.with_suffix(".stderr.log").open("wb") as stderr:
    process = subprocess.Popen([str(binary), "run"], stdin=subprocess.PIPE, stdout=stdout,
                               stderr=stderr, creationflags=subprocess.CREATE_NO_WINDOW)
    process.stdin.write((json.dumps(request, ensure_ascii=False) + "\n").encode("utf-8"))
    process.stdin.flush()
    if args.case == "eof":
        process.stdin.close()
    if args.case in ("cancel", "terminate"):
        task_log = tasks / task_id / "logs/task.log"
        deadline = time.monotonic() + 45
        marker_reached = False
        while time.monotonic() < deadline:
            if process.poll() is not None:
                break
            if task_log.exists() and "G6_FIXED_SLEEP_READY" in task_log.read_text(encoding="utf-8", errors="replace"):
                marker_reached = True
                break
            time.sleep(0.05)
        else:
            process.kill()
            process.wait(timeout=10)
            raise RuntimeError("Fixed Godot sleep marker was not reached")
        assert marker_reached, "Broker exited before the fixed running-child marker"
        if args.case == "cancel":
            process.stdin.write(b'{"cancel":true}\n')
            process.stdin.flush()
        else:
            process.kill()
    try:
        code = process.wait(timeout=120)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)
        raise
    finally:
        if not process.stdin.closed:
            process.stdin.close()
if args.case == "terminate":
    # The per-launch host receipt is persisted before resume. Its PID and
    # creation time identify the exact child; no user process enumeration.
    receipt_path = tasks / task_id / "logs/process-verification.json"
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    kernel.GetProcessTimes.argtypes = [ctypes.c_void_p] + [ctypes.POINTER(ctypes.c_ulonglong)] * 4
    handle = kernel.OpenProcess(0x00101000, 0, receipt["pid"])
    open_error = ctypes.get_last_error() if not handle else None
    identity_matches = None
    gone = False
    if handle:
        try:
            times = [ctypes.c_ulonglong() for _ in range(4)]
            assert kernel.GetProcessTimes(handle, *[ctypes.byref(value) for value in times]), ctypes.get_last_error()
            identity_matches = str(times[0].value) == receipt["creationTimeFiletime"]
            # A reused PID is not the recorded child. A live matching process
            # must become signalled; access denial is never evidence of exit.
            gone = not identity_matches or kernel.WaitForSingleObject(handle, 5000) == 0
        finally:
            kernel.CloseHandle(handle)
    elif open_error == 87:
        gone = True
    summary = {"case": args.case, "transportExit": code, "godotPid": receipt["pid"],
               "creationTimeFiletime": receipt["creationTimeFiletime"], "childTerminated": gone,
               "openProcessError": open_error, "processIdentityMatches": identity_matches,
               "evidencePrefix": str(prefix), "profileCleanup": "not-guaranteed-after-broker-kill"}
    prefix.with_suffix(".summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary))
    assert gone
    raise SystemExit(0)
result = json.loads(prefix.with_suffix(".stdout.json").read_text(encoding="utf-8"))
summary = {"case": args.case, "transportExit": code, "state": result.get("state"),
           "error": result.get("error"), "evidencePrefix": str(prefix),
           "processVerified": (result.get("processVerification") or {}).get("verified"),
           "networkVerified": (result.get("networkPreflight") or {}).get("verified"),
           "artifactCount": len(result.get("artifacts", [])), "cleanup": result.get("cleanup")}
print(json.dumps(summary, ensure_ascii=False))
prefix.with_suffix(".summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
if args.case in ("eof", "cancel"):
    assert result.get("state") == "cancelled", result
    if args.case == "eof":
        assert result.get("processVerification") is None, result
    else:
        assert result.get("processVerification", {}).get("verified") is True, result
else:
    assert result.get("state") == "succeeded", result
    assert result["processVerification"]["verified"] is True
    assert result["processVerification"]["verifiedBeforeResume"] is True
    assert result["processVerification"]["resumePreviousCount"] == 1
    assert result["networkPreflight"]["verified"] is True
    if args.case == "exportWeb":
        assert len(result["artifacts"]) >= 4
assert result["cleanup"]["verified"] is True
if args.case == "adversarial":
    assert sentinel.read_text(encoding="utf-8") == "g6-private-synthetic-sentinel"
    assert not (denied_world / "editor-escape.txt").exists()
    log = (pathlib.Path(result["logsRoot"]) / "task.log").read_text(encoding="utf-8", errors="replace")
    for label in ["plugin", "tool_init"]:
        for suffix in ["file_read=denied", "file_write=denied", "sibling_write=denied", "spawn=denied(error=-1)"]:
            assert label + "_" + suffix in log, (label, suffix)
    summary["fixedSyntheticWorldBoundaryVerified"] = True
    summary["ordinaryCoreCompilerGateMustStillRejectErrors"] = True
    prefix.with_suffix(".summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
