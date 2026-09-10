"""Archive only this report's fixed harness logs, without touching task state."""
import hashlib
import json
import pathlib
import shutil

report = pathlib.Path(__file__).resolve().parent
repo = report.parents[3]
tasks = (repo / "desktop/godot/sandbox/out/broker-cycle06").resolve()
evidence = report / "evidence"
records = []
for request_path in sorted(evidence.glob("g6-*.request.json")):
    request = json.loads(request_path.read_text(encoding="utf-8"))
    task_id = request["taskId"]
    assert task_id == request_path.name.removesuffix(".request.json")
    assert pathlib.Path(request["tasksRoot"]).resolve() == tasks
    log_root = (tasks / task_id / "logs").resolve()
    assert log_root.parent.parent == tasks
    for name in ("task.log", "preflight.json", "process-verification.json", "native-verification.json"):
        source = log_root / name
        if not source.exists():
            continue
        assert source.is_file() and not source.is_symlink()
        assert source.resolve().parent == log_root
        assert source.stat().st_size <= 4 * 1024 * 1024
        target = evidence / (task_id + "." + name)
        shutil.copyfile(source, target)
        data = target.read_bytes()
        records.append({"path": target.name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
(evidence / "archived-log-manifest.json").write_text(json.dumps(records, indent=2), encoding="utf-8")
print(json.dumps({"archivedLogCount": len(records)}))
