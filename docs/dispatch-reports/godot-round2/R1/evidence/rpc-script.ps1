# Real stdio RPC verification for the managed Git content history.
# Isolated data directory, several process runs, no GUI and no input simulation.
$ErrorActionPreference = "Stop"
$root = "D:\Craftmine World-worktrees\godot-round2-r1-20260910\vendor\pi-desktop"
$exe = Join-Path $root "target\debug\craftmine-core.exe"
if (-not (Test-Path $exe)) { throw "binary missing: $exe" }
$data = Join-Path $env:PI_SCRATCH_DIR "r1-rpc-data"
if (Test-Path $data) { Remove-Item -Recurse -Force $data }
New-Item -ItemType Directory -Path $data | Out-Null

$context = @{ projectId = "project-r1"; sessionId = "session-r1"; turnId = "turn-r1" }
$context2 = @{ projectId = "project-r1"; sessionId = "session-r1"; turnId = "turn-r2" }
$binding = @{ projectId = "project-r1"; sessionId = "session-r1"; turnId = "turn-r1"; taskId = "task-r1"; baseBuild = "base-a" }
$legacy = @{
  build = @{ id = "base-a"; scene = @{ format = "craftmine.scene/3"; objects = @() } }
  snapshot = @{ format = "craftmine.progress/1"; player = @{ x = 0.5; y = 7.6; z = 0.5; yaw = 0; pitch = 0 } }
  extensions = @()
}
$files = @(
  @{ path = "project.godot"; text = "config_version=5`n[application]`nrun/main_scene=`"res://main.tscn`"`n" },
  @{ path = "main.tscn"; text = "[gd_scene load_steps=2 format=3]`n[node name=`"Main`" type=`"Node3D`"]`n" },
  @{ path = "world.gd"; text = "extends Node3D`nvar damage := 12`n" }
)

function Write-Session([string]$name, [string[]]$lines) {
  $request = Join-Path $env:PI_SCRATCH_DIR "$name.requests.jsonl"
  $response = Join-Path $env:PI_SCRATCH_DIR "$name.responses.jsonl"
  [System.IO.File]::WriteAllText($request, ($lines -join "`n") + "`n")
  cmd /c "`"$exe`" --data-dir `"$data`" < `"$request`" > `"$response`" 2>&1"
  return $response
}
function J($method, $params) { (@{ method = $method; params = $params } | ConvertTo-Json -Compress -Depth 24) }
function Resp($file, [int]$index) { ((Get-Content $file) | Select-Object -Index $index) | ConvertFrom-Json }

# 1. Create the world and its legacy project, then migrate to Git.
$r1 = Write-Session "r1-a" @(
  (J "hello" @{}),
  (J "world.create" @{ id = "a"; title = "A"; world = $legacy }),
  (J "task.start" @{ binding = $binding; draft = @{} }),
  (J "workspace.open" @{ context = $context; selectedWorld = "a" }),
  (J "godotProject.create" @{ context = $context; worldId = "a"; toolCallId = "create-1"; baseBuild = "base-a"; baseId = "first-person"; files = $files }),
  (J "content.migrate.plan" @{ worldId = "a" }),
  (J "content.migrate.apply" @{ worldId = "a" }),
  (J "content.status" @{ worldId = "a" }),
  (J "godotProject.index" @{ context = $context; worldId = "a"; limit = 32 })
)
$status = (Resp $r1 7).result
$head = $status.headOid
$repo = $status.repoId
$project = (Resp $r1 4).result
$index = (Resp $r1 8).result
$worldGdHash = (@($index.files) | Where-Object { $_.path -eq "world.gd" })[0].sha256
if (-not $head) { throw "no head after migration" }
if (-not $worldGdHash) { throw "no world.gd hash in the project index" }

# 2. A new process must recover the interrupted task before it can write again.
$r2 = Write-Session "r1-b" @((J "task.recoverable" @{ projectId = "project-r1"; worldId = "a" }))
$items = @((Resp $r2 0).result.items)
if ($items.Count -lt 1) { throw "no recoverable task after restart" }
$interrupted = $items[0]

# 3. Discard the interrupted task, open a new turn, edit through Git and branch.
$r3 = Write-Session "r1-c" @(
  (J "task.discard" @{ taskId = $interrupted.taskId; projectId = "project-r1"; generation = $interrupted.generation }),
  (J "workspace.open" @{ context = $context2; selectedWorld = "a" }),
  (J "godotProject.patch" @{ context = $context2; worldId = "a"; toolCallId = "patch-1";
      revision = $project.revision; manifestHash = $project.manifestHash;
      operation = @{ operationId = "op-patch"; worldId = "a"; repoId = $repo; branchId = "main";
        expectedHeadOid = $head; expectedAppliedOid = $null; expectedProgressRevision = $null };
      operations = @(@{ op = "put"; path = "world.gd"; text = "extends Node3D`nvar damage := 99`n"; expectedHash = $worldGdHash }) }),
  (J "content.status" @{ worldId = "a" }),
  (J "content.history" @{ worldId = "a"; limit = 10 }),
  (J "content.readFile" @{ worldId = "a"; rev = "main"; path = "world.gd" })
)
$newHead = (Resp $r3 3).result.headOid
if ($newHead -eq $head) { throw "patch did not advance the commit" }

# 4. Two branches from the new commit, verified and read back.
$r4 = Write-Session "r1-d" @(
  (J "content.branch.create" @{ worldId = "a"; branchId = "idea-one"; fromRev = $newHead; title = "idea one" }),
  (J "content.branch.create" @{ worldId = "a"; branchId = "idea-two"; fromRev = $newHead; title = "idea two" }),
  (J "content.branch.list" @{ worldId = "a" }),
  (J "content.readFile" @{ worldId = "a"; rev = "idea-one"; path = "world.gd" }),
  (J "content.verify" @{ worldId = "a" }),
  (J "content.reclaim.plan" @{ worldId = "a" })
)

# 5. The Git-side apply reference transaction; one operation stays prepared.
$r5 = Write-Session "r1-e" @(
  (J "content.apply.prepare" @{ worldId = "a"; kind = "apply"; targetOid = $newHead; detail = "first apply";
      context = @{ operationId = "op-apply"; worldId = "a"; repoId = $repo; branchId = "main";
        expectedHeadOid = $newHead; expectedAppliedOid = $null; expectedProgressRevision = $null } }),
  (J "content.apply.advance" @{ operationId = "op-apply" }),
  (J "content.apply.confirm" @{ operationId = "op-apply"; appliedOid = $newHead; detail = "host committed deployment" }),
  (J "content.apply.prepare" @{ worldId = "a"; kind = "apply"; targetOid = $newHead; detail = "abandoned attempt";
      context = @{ operationId = "op-abandoned"; worldId = "a"; repoId = $repo; branchId = "main";
        expectedHeadOid = $newHead; expectedAppliedOid = $null; expectedProgressRevision = $null } }),
  (J "content.status" @{ worldId = "a" })
)

# 6. Restart proves history, branches and the applied reference survive, and that
# the abandoned operation is reported instead of being applied.
$r6 = Write-Session "r1-f" @(
  (J "content.status" @{ worldId = "a" }),
  (J "content.apply.recover" @{ worldId = "a" }),
  (J "content.branch.list" @{ worldId = "a" }),
  (J "content.history" @{ worldId = "a"; limit = 10 }),
  (J "content.migrate.verify" @{ worldId = "a" }),
  (J "content.verify" @{ worldId = "a" })
)

foreach ($file in @($r1, $r2, $r3, $r4, $r5, $r6)) {
  Write-Output ("### " + (Split-Path $file -Leaf))
  Get-Content $file | ForEach-Object { Write-Output $_ }
}
