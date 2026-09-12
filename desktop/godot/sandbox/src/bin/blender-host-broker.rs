//! Private NDJSON broker: first frame runs; any next frame or EOF cancels.
use craftmine_godot_sandbox_probe::{blender::{Request,execute},preflight,recovery,Result};
use std::{io::{BufRead,Read,Write},path::Path,sync::{Arc,atomic::{AtomicBool,Ordering}}};
fn main() {
    if let Err(error)=run() {
        eprintln!("BLENDER_BROKER_ERROR: {error}");
        println!("{}",serde_json::json!({"schemaVersion":1,"state":"failed","error":error.to_string()}));
        std::process::exit(1);
    }
}
fn run()->Result<()> {
    let args=std::env::args().collect::<Vec<_>>();
    if args.get(1).map(String::as_str)==Some("--native-preflight") {println!("{}",serde_json::to_string(&preflight::observe(&args[2..])?)?);return Ok(());}
    if args.get(1).map(String::as_str)==Some("recover") {
        let report=recovery::recover(Path::new(args.get(2).ok_or("recover requires tasks root")?))?;
        println!("{}",serde_json::to_string(&report)?);
        if report.skipped_count>0 || !report.unreadable.is_empty(){std::process::exit(1);} return Ok(());
    }
    if args.len()!=2 || args[1]!="run" {return Err("Expected private Blender broker run command".into());}
    let mut line=String::new();let count=std::io::stdin().lock().take(65537).read_line(&mut line)?;
    if count==0 || count>65536 || !line.ends_with('\n'){return Err("Invalid or oversized request frame".into());}
    let request:Request=serde_json::from_str(&line)?;
    let cancel=Arc::new(AtomicBool::new(false));let control=cancel.clone();
    std::thread::spawn(move||{let mut line=String::new();let _=std::io::stdin().lock().take(1025).read_line(&mut line);control.store(true,Ordering::SeqCst);});
    let response=execute(request,cancel)?;println!("{}",serde_json::to_string(&response)?);std::io::stdout().flush()?;Ok(())
}
