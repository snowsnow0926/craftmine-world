//! Local product service. Only the trusted plugin broker owns this stdio pipe.
use std::io::{self, BufRead, Read, Write};
use std::path::PathBuf;

use anyhow::{bail, Context, Result};
use craftmine_core::{TaskBinding, TaskJournal, WorldDocument};
use serde_json::{json, Value};

fn dispatch(journal: &mut TaskJournal, request: &Value) -> Result<Value> {
    let method = request["method"].as_str().context("METHOD_REQUIRED")?;
    if method == "hello" {
        return Ok(
            json!({"format":"craftmine.core/1","version":env!("CARGO_PKG_VERSION"),"storage":"sqlite","publishesWorlds":false}),
        );
    }
    let params = request.get("params").context("PARAMS_REQUIRED")?;
    match method {
        "legacy.capture" => {
            return journal.legacy_capture(
                params["id"].as_str().context("IMPORT_ID_REQUIRED")?,
                std::path::Path::new(params["source"].as_str().context("SOURCE_REQUIRED")?),
            )
        }
        "legacy.read" => {
            return journal.legacy_read(
                params["id"].as_str().context("IMPORT_ID_REQUIRED")?,
                params["path"].as_str().context("ARCHIVE_PATH_REQUIRED")?,
            )
        }
        "legacy.commit" => {
            let world: WorldDocument = serde_json::from_value(params["world"].clone())?;
            return Ok(serde_json::to_value(journal.legacy_commit(
                params["id"].as_str().context("IMPORT_ID_REQUIRED")?,
                params["title"].as_str().context("TITLE_REQUIRED")?,
                &world,
            )?)?);
        }
        "world.list" => return Ok(serde_json::to_value(journal.world_list()?)?),
        "world.read" => {
            return Ok(serde_json::to_value(journal.world_read(
                params["id"].as_str().context("WORLD_ID_REQUIRED")?,
            )?)?)
        }
        "world.create" => {
            let world: WorldDocument = serde_json::from_value(params["world"].clone())?;
            return Ok(serde_json::to_value(journal.world_create(
                params["id"].as_str().context("WORLD_ID_REQUIRED")?,
                params["title"].as_str().context("TITLE_REQUIRED")?,
                &world,
            )?)?);
        }
        "world.saveProgress" => {
            return Ok(serde_json::to_value(journal.world_save_progress(
                params["id"].as_str().context("WORLD_ID_REQUIRED")?,
                params["revision"].as_u64().context("REVISION_REQUIRED")?,
                params["baseBuild"].as_str().context("BUILD_REQUIRED")?,
                &params["snapshot"],
            )?)?)
        }
        _ if !method.starts_with("task.") => bail!("UNKNOWN_METHOD"),
        _ => {}
    }
    let binding: TaskBinding = serde_json::from_value(params["binding"].clone())?;
    match method {
        "task.start" => Ok(serde_json::to_value(
            journal.start(&binding, &params["draft"])?,
        )?),
        "task.inspect" => Ok(serde_json::to_value(journal.inspect(&binding)?)?),
        "task.cancel" => Ok(serde_json::to_value(journal.cancel(&binding)?)?),
        "task.commit" => Ok(serde_json::to_value(journal.commit_draft(
            &binding,
            params["toolCallId"].as_str().context("CALL_ID_REQUIRED")?,
            params["revision"].as_u64().context("REVISION_REQUIRED")?,
            &params["request"],
            &params["draft"],
        )?)?),
        _ => bail!("UNKNOWN_METHOD"),
    }
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 2 || args[0] != "--data-dir" {
        bail!("usage: craftmine-core --data-dir <isolated project service directory>");
    }
    let directory = PathBuf::from(&args[1]);
    if !directory.is_absolute() {
        bail!("data directory must be absolute");
    }
    let mut journal = TaskJournal::open(&directory.join("tasks.sqlite"))?;
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    loop {
        let mut line = Vec::new();
        const MAX_RPC_BYTES: u64 = 72 * 1024 * 1024;
        let size = (&mut input)
            .take(MAX_RPC_BYTES + 1)
            .read_until(b'\n', &mut line)?;
        if size == 0 {
            break;
        }
        if size as u64 > MAX_RPC_BYTES {
            bail!("RPC_DOCUMENT_TOO_LARGE");
        }
        let response = match serde_json::from_slice::<Value>(&line) {
            Ok(request) => match dispatch(&mut journal, &request) {
                Ok(result) => json!({"id":request["id"],"result":result}),
                Err(error) => json!({"id":request["id"],"error":{"message":error.to_string()}}),
            },
            Err(_) => json!({"id":null,"error":{"message":"INVALID_JSON"}}),
        };
        serde_json::to_writer(&mut output, &response)?;
        output.write_all(b"\n")?;
        output.flush()?;
    }
    Ok(())
}
