//! Runs the notes commands over stdin and stdout, so the notes contract suite in Vitest can run against the real
//! bridge and core (app/src/services/notes/core/contract.test.ts). Each line in is one JSON request,
//! `{ "id": 1, "cmd": "notes_create", "args": { ... } }`, and each line out is a response, `{ "id": 1, "ok": ... }`
//! or `{ "id": 1, "err": { "code": ..., "message": ... } }`, or a notes event, `{ "event": { ... } }`. The command
//! `reset` starts over with a new core, an empty library, and a new notes folder in a temporary folder.

use std::{
    io::{self, BufRead, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use opennote_lib::core_bridge::CoreBridge;
use serde_json::{json, Value};

type Out = Arc<Mutex<io::Stdout>>;

fn write_line(out: &Out, value: &Value) {
    let mut out = out.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}

struct Library {
    bridge: CoreBridge,
    notes: PathBuf,
}

fn start(base: &Path, n: u32, out: &Out) -> Library {
    let dir = base.join(n.to_string());
    let bridge = CoreBridge::at(dir.join("local"));
    let events = out.clone();
    bridge.listen(Box::new(move |name, payload| {
        if name == "notes:event" {
            write_line(&events, &json!({ "event": payload }));
        }
    }));
    Library {
        bridge,
        notes: dir.join("Notes"),
    }
}

fn main() {
    let base = std::env::temp_dir().join(format!("opennote-notes-harness-{}", std::process::id()));
    let out: Out = Arc::new(Mutex::new(io::stdout()));
    let mut count = 0;
    let mut library = start(&base, count, &out);
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let Ok(request) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let command = request
            .get("cmd")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let args = request.get("args").cloned().unwrap_or_else(|| json!({}));
        if command == "reset" {
            library.bridge.shutdown();
            count += 1;
            library = start(&base, count, &out);
            write_line(&out, &json!({ "id": id, "ok": null }));
            continue;
        }
        let folder = Some(library.notes.clone());
        let result = library.bridge.notes(folder, |bridge| bridge.dispatch(&command, &args));
        let response = match result {
            Ok(value) => json!({ "id": id, "ok": value }),
            Err(error) => json!({ "id": id, "err": error }),
        };
        write_line(&out, &response);
    }
    library.bridge.shutdown();
    let _ = std::fs::remove_dir_all(&base);
}
