# 接口 A：受管理 Godot 构建任务的执行边界（供任务 B 消费）

crate：`craftmine-godot-sandbox-probe`（`desktop/godot/sandbox`，`crate-type` 默认 lib + 三个 bin）。
库入口：`craftmine_godot_sandbox_probe::task`。
本接口只做“在受控边界内运行固定类型的 Godot 操作”，**不接受任意命令行**。

## 1. 类型与签名

```rust
// 任务类型：只有这三种，参数集固定
pub enum TaskKind { Version, Import, ExportWeb }

// 资源预算（由调用方承担，不再有隐藏默认 512MiB）
pub struct TaskBudget {
    pub timeout: Duration,      // 默认 600s
    pub job: JobPolicy,         // 默认 active_process_limit=1, 4GiB 进程内存
}

// 固定输入：哈希由调用方给出，任务无权决定
pub struct PinnedInput { pub source: PathBuf, pub sha256: String, pub file_name: String }
pub struct EnginePins { pub editor: PinnedInput, pub templates: Vec<PinnedInput> }

pub enum TaskState { Prepared, Running, Succeeded, Failed, Cancelled }
pub struct TaskStatus { pub state: TaskState, pub exit_code: Option<u32>, pub message: String }
pub struct Artifact { pub name: String, pub bytes: u64, pub sha256: String }

pub struct TaskLayout {
    pub root: PathBuf, pub bin: PathBuf, pub work: PathBuf,
    pub logs: PathBuf, pub artifacts: PathBuf,
    pub project: PathBuf, pub export_dir: PathBuf,
}

impl Task {
    // 准备：校验 task_id、固定并复制引擎/模板、复制项目源、建 profile+桌面+目录授权
    pub fn prepare(
        tasks_root: &Path,
        task_id: &str,
        kind: TaskKind,
        project_source: Option<&Path>,
        pins: &EnginePins,
        budget: TaskBudget,
    ) -> Result<Task>;

    // 运行（阻塞）：同时遵守 timeout 与取消标志；取消会终止整个 Job
    pub fn run(&mut self, cancel: Option<Arc<AtomicBool>>) -> Result<&TaskStatus>;

    pub fn status(&self) -> &TaskStatus;
    pub fn log_path(&self) -> &Path;         // 父侧日志，任务无写权限
    pub fn sid(&self) -> &str;               // 本轮 AppContainer SID

    pub fn collect_artifacts(&self) -> Result<Vec<Artifact>>;
    pub fn hand_off_artifacts(&self) -> Result<Vec<Artifact>>; // 复制到父侧并复核哈希
    pub fn finish(self) -> Result<i32>;      // 删除 profile + 清空 work，保留 logs/artifacts
}

// 取消标志：另一线程 set(true) 即可让在跑的 run() 终止任务 Job
pub fn cancel_flag() -> Arc<AtomicBool>;

// task_id 规则：1..=96 字符，仅 ASCII 字母/数字/'.'/'_'/'-'，不以 '.' 开头或结尾
pub fn validate_task_id(task_id: &str) -> Result<()>;
```

底层原语（B 若需自建编排可直接用）：

```rust
pub fn start(spec: &LaunchSpec) -> Result<RunningProcess>;
impl RunningProcess {
    pub fn pid(&self) -> u32;                 // 字段 pid
    pub fn wait(&self, timeout: Duration) -> Result<Option<u32>>; // None = 超时
    pub fn terminate(&self, exit_code: u32) -> Result<()>;        // 终止整个 Job
    pub fn is_running(&self) -> bool;
    pub fn job(&self) -> Option<Arc<TaskJob>>; // active_processes() 可查残留
}
pub fn launch(spec: &LaunchSpec) -> Result<Outcome>; // 启动+限时等待+超时终止
```

## 2. 任务目录约定

```
<tasks_root>/<task_id>/
  bin/        引擎二进制（按哈希固定，任务只读/执行）
  work/       任务可写；含 project/（项目源副本）与 export/（导出输出）
  logs/       父侧日志（任务无写权限，故任务无法伪造日志）
  artifacts/  交接后的产物（父侧所有，内容不可信）
```

- 只对本轮新建的 `bin`（读/执行）与 `work`（读/写/执行/删除）授权给任务 SID；其它目录一律不授权。
- `work` 完整性标签 > Medium 时准备阶段直接失败。
- 引擎目录**不要**放 `_sc_`：自包含模式会让编辑器尝试在只读目录旁写 `editor_data`。
- 导出模板必须复制到 `<work>/Godot/export_templates/4.7.2.stable/`（任务的 `APPDATA` 指向 `work`）。

## 3. 状态与退出语义

| 状态 | 触发 | 说明 |
| --- | --- | --- |
| `Prepared` | `prepare` 成功 | 尚未创建受限进程 |
| `Running` | `run` 开始 | |
| `Succeeded` | 退出码 0 | |
| `Failed` | 非 0 退出或启动错误 | `exit_code` 为原始码（含 `0xC0000142` 这类 NTSTATUS） |
| `Cancelled` | 超时或取消标志 | 消息含 `job_active_processes`；若不为 0 则 `run` 直接返回错误 |

保证：取消/超时后 `job_active_processes == Some(0)` 且进程已不存在（证据 `evidence/cancellation.log`）。

## 4. 产物交接契约

1. 任务把产物写到 `work/export/`；父进程 `collect_artifacts()` 独立计算大小与 SHA-256。
2. `hand_off_artifacts()` 复制到 `artifacts/` 并**重新哈希**，不一致即报错。
3. 产物是**不可信模型输出**：只保证完整性与路径，不保证内容安全。下游（Web 预览、打包、发布）必须按不可信输入处理。
4. 建议 B 记录到自己的回执：任务 id、sid、状态、退出码、日志路径、产物 `name/bytes/sha256`、预算（超时、内存、活动进程上限）。

## 5. 构建接入（本任务未改共享入口，请由负责该文件的 Agent 或任务 I 执行）

当前 crate 自带 `[workspace]`，无共享脚本引用。若产品要把边界作为库依赖，需要新增 path 依赖：

```toml
# desktop/<产品 crate>/Cargo.toml
[dependencies]
craftmine-godot-sandbox-probe = { path = "../godot/sandbox" }
```

注意点（需该 Agent 确认）：

- 本 crate 目前既是 lib 又含三个 bin（`craftmine-godot-sandbox-probe`、`boundary-probe`、`sandbox-diag`）。若不希望把 bin 带进产品构建，可只依赖 lib 或在共享入口显式排除 bin。
- `Cargo.lock` 只有 `sha2` 与 `windows-sys 0.61.2`，需保持离线可构建（`cargo build --offline`）。
- 若共享入口有自己的 `[workspace]`，把本 crate 的 `[workspace]` 段移除并加入成员列表即可，不要复制依赖版本。

## 6. 使用示例

```rust
use craftmine_godot_sandbox_probe::task::{
    cancel_flag, EnginePins, PinnedInput, Task, TaskBudget, TaskKind,
};
use std::time::Duration;

let pins = EnginePins {
    editor: PinnedInput {
        source: engine_exe.clone(),
        sha256: "ab1824f85bfd8e0e4128182c000c4003a3e042245b2967848d089b2a04b22424".into(),
        file_name: "Godot_v4.7.2-stable_win64.exe".into(),
    },
    templates: web_templates, // version.txt + 3 个 web zip，逐个带 sha256
};

let mut task = Task::prepare(
    tasks_root,
    "build-0001",
    TaskKind::ExportWeb,
    Some(project_source),
    &pins,
    TaskBudget { timeout: Duration::from_secs(600), ..Default::default() },
)?;

let cancel = cancel_flag();
let status = task.run(Some(cancel.clone()))?.clone();   // 另一线程可 cancel.store(true)
if status.state == TaskState::Succeeded {
    let artifacts = task.hand_off_artifacts()?;         // 不可信产物 + 哈希
}
let cleanup_hresult = task.finish()?;                   // 必须调用：删除 profile
```

## 7. 调用方必须遵守

1. 不要绕过 `Task`/`start` 直接用 `CreateProcessW` 创建任务进程；边界只在 `launch.rs` 内建立。
2. 不要给 `LaunchSpec::child_process_policy` 赋 `Some(1)`：这是历史 `0xC0000142` 的根因。
3. 预算要诚实：Godot 编辑器需要 4 GiB 级别内存预算，512 MiB 会以 `alloc_static` 失败而非清晰报错。
4. `finish()` 必须调用，否则 AppContainer profile 会残留（删除 HRESULT 需记账）。
5. 回环网络当前**未被阻断**（见 `REPORT_A.md` 第 6 节）；不要把任务当作无法访问本机服务。
