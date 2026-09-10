//! Private line protocol. The parent keeps stdin open until the final response.
//! EOF/cancel closes the current task, and broker death closes all owned Jobs.
use craftmine_godot_sandbox_probe::{broker::{Request, execute}, preflight, Result};
use std::{io::{BufRead, Read, Write}, sync::{Arc, atomic::{AtomicBool, Ordering}}};

fn main() {
    if let Err(error) = run() {
        eprintln!("BROKER_ERROR: {error}");
        println!("{}", serde_json::json!({"schemaVersion":1,"state":"failed","error":error.to_string()}));
        std::process::exit(1);
    }
}
fn run() -> Result<()> {
    let args = std::env::args().collect::<Vec<_>>();
    if args.get(1).map(String::as_str) == Some("--native-preflight") {
        let observation = preflight::observe(&args[2..])?;
        println!("{}", serde_json::to_string(&observation)?);
        return Ok(());
    }
    if args.len() != 2 || args[1] != "run" { return Err("Expected private broker run command".into()); }
    let mut line = String::new();
    // Bounded first frame; a source cannot cause unbounded broker allocation.
    let count = std::io::stdin().lock().take(65537).read_line(&mut line)?;
    if count == 0 || count > 65536 || !line.ends_with('\n') { return Err("Invalid or oversized request frame".into()); }
    let request: Request = serde_json::from_str(&line)?;
    let cancel = Arc::new(AtomicBool::new(false));
    let control = cancel.clone();
    std::thread::spawn(move || {
        let mut line = String::new();
        let _ = std::io::stdin().lock().take(1025).read_line(&mut line);
        // The only subsequent valid operation is cancellation. EOF, malformed
        // input and unexpected control frames all fail closed by cancelling.
        control.store(true, Ordering::SeqCst);
    });
    let response = execute(request, cancel)?;
    println!("{}", serde_json::to_string(&response)?);
    std::io::stdout().flush()?;
    Ok(())
}
