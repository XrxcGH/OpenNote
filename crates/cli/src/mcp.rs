//! `opennote mcp`: a Model Context Protocol server on standard input and output, one JSON-RPC message per line, so
//! an AI assistant the person chooses can use their notes. It has five tools: list_notebooks, search, read_page,
//! create_page, and append_to_page.
//!
//! The assistant gets its own access, separate from the command-line tool's: the first tool call asks the person
//! in OpenNote, read-only by default. Changes go through the same approval as any app, so OpenNote asks before each
//! one unless the person turned that off, and every call is in the access log. The server never prints anything
//! but protocol messages on standard output; what the person should know goes to standard error.

use std::io::{self, BufRead, BufReader, Read, Write};

use serde_json::{json, Value};

use crate::{
    session::{id_ok, CliError, Env, Identity, Session},
    store::assistant_token,
};

/// The protocol versions this server speaks, newest first.
pub const PROTOCOL_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

/// The longest line the server reads: a request bigger than this is refused.
const MAX_LINE: u64 = 4 * 1024 * 1024;

/// The tools, as `tools/list` describes them.
pub fn tools() -> Value {
    json!([
        {
            "name": "list_notebooks",
            "description": "List the OpenNote notebooks and sections this assistant may use, with their IDs. \
                            Locked sections are marked and can't be read.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "search",
            "description": "Search the person's OpenNote pages for words. Returns page IDs, titles, and a few words around each match.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "The words to look for.", "maxLength": 500 },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 50, "default": 10 }
                },
                "required": ["query"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "read_page",
            "description": "Read one OpenNote page as Markdown, by its ID.",
            "inputSchema": {
                "type": "object",
                "properties": { "page_id": { "type": "string" } },
                "required": ["page_id"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": true }
        },
        {
            "name": "create_page",
            "description": "Add a new page to a section. The person may be asked to allow it in OpenNote first.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "section_id": { "type": "string" },
                    "title": { "type": "string", "maxLength": 200 },
                    "markdown": { "type": "string" }
                },
                "required": ["section_id", "title"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false }
        },
        {
            "name": "append_to_page",
            "description": "Add Markdown to the end of a page. The person may be asked to allow it in OpenNote first.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "page_id": { "type": "string" },
                    "markdown": { "type": "string" }
                },
                "required": ["page_id", "markdown"],
                "additionalProperties": false
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false }
        }
    ])
}

/// One server: the session is opened on the first tool call, so starting the assistant never asks the person.
pub struct Server<'a> {
    env: &'a Env,
    identity: Identity,
    session: Option<Session>,
    log: &'a mut dyn Write,
}

fn reply(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn tool_text(text: &str, is_error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": is_error })
}

fn string_arg<'v>(args: &'v Value, name: &str) -> Result<&'v str, String> {
    args.get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("The tool needs {name} as a string."))
}

fn id_arg<'v>(args: &'v Value, name: &str) -> Result<&'v str, String> {
    let id = string_arg(args, name)?;
    if id_ok(id) {
        Ok(id)
    } else {
        Err(format!(
            "{name} isn't an OpenNote ID. Use list_notebooks or search to find one."
        ))
    }
}

impl<'a> Server<'a> {
    pub fn new(env: &'a Env, name: &str, log: &'a mut dyn Write) -> Server<'a> {
        let app_name = opennote_api::grants::clean_name(name);
        Server {
            env,
            identity: Identity {
                token_name: assistant_token(&app_name),
                app_name,
                kind: "assistant",
            },
            session: None,
            log,
        }
    }

    fn session(&mut self) -> Result<&Session, CliError> {
        if self.session.is_none() {
            let session = Session::open(self.env, self.identity.clone(), &mut *self.log)?;
            self.session = Some(session);
        }
        Ok(self.session.as_ref().expect("opened above"))
    }

    /// Answers one message; `None` for a notification.
    pub fn handle(&mut self, message: &Value) -> Option<Value> {
        let id = message.get("id").cloned();
        let method = message["method"].as_str().unwrap_or_default();
        let Some(id) = id else {
            // Notifications, such as notifications/initialized, need no answer.
            return None;
        };
        if message["jsonrpc"] != "2.0" || method.is_empty() {
            return Some(rpc_error(&id, -32600, "Not a JSON-RPC 2.0 request."));
        }
        Some(match method {
            "initialize" => {
                let asked = message["params"]["protocolVersion"].as_str().unwrap_or_default();
                let version = PROTOCOL_VERSIONS
                    .iter()
                    .find(|known| **known == asked)
                    .copied()
                    .unwrap_or(PROTOCOL_VERSIONS[0]);
                reply(
                    &id,
                    json!({
                        "protocolVersion": version,
                        "capabilities": { "tools": { "listChanged": false } },
                        "serverInfo": { "name": "opennote", "version": env!("CARGO_PKG_VERSION") },
                        "instructions": "Tools for the person's OpenNote notes. They see and approve what you may read and \
                            change in OpenNote; locked sections are never available."
                    }),
                )
            }
            "ping" => reply(&id, json!({})),
            "tools/list" => reply(&id, json!({ "tools": tools() })),
            "tools/call" => {
                let name = message["params"]["name"].as_str().unwrap_or_default();
                let empty = json!({});
                let args = message["params"].get("arguments").unwrap_or(&empty);
                if !args.is_object() {
                    return Some(rpc_error(&id, -32602, "The arguments must be an object."));
                }
                match self.call(name, args) {
                    Ok(result) => reply(&id, result),
                    Err(Unknown) => rpc_error(&id, -32602, &format!("There's no tool called {name}.")),
                }
            }
            _ => rpc_error(&id, -32601, "This server doesn't have that method."),
        })
    }

    fn call(&mut self, name: &str, args: &Value) -> Result<Value, Unknown> {
        if !tools()
            .as_array()
            .is_some_and(|all| all.iter().any(|tool| tool["name"] == name))
        {
            return Err(Unknown);
        }
        Ok(match self.run_tool(name, args) {
            Ok(text) => tool_text(&text, false),
            Err(text) => tool_text(&text, true),
        })
    }

    fn run_tool(&mut self, name: &str, args: &Value) -> Result<String, String> {
        // Check what the assistant sent before anything reaches OpenNote.
        let checked: Result<(), String> = match name {
            "search" => string_arg(args, "query").map(|_| ()),
            "read_page" => id_arg(args, "page_id").map(|_| ()),
            "create_page" => id_arg(args, "section_id")
                .and_then(|_| string_arg(args, "title"))
                .map(|_| ()),
            "append_to_page" => id_arg(args, "page_id")
                .and_then(|_| string_arg(args, "markdown"))
                .map(|_| ()),
            _ => Ok(()),
        };
        checked?;
        let session = self.session().map_err(|error| error.to_string())?;
        let shown = |value: Value| serde_json::to_string_pretty(&value).unwrap_or_default();
        let failed = |error: CliError| error.to_string();
        match name {
            "list_notebooks" => {
                let notebooks = session.get("/v1/notebooks", &[]).map_err(failed)?;
                let mut out = Vec::new();
                for notebook in notebooks["notebooks"].as_array().cloned().unwrap_or_default() {
                    let id = notebook["id"].as_str().unwrap_or_default().to_owned();
                    if !id_ok(&id) {
                        continue;
                    }
                    let sections = session
                        .get(&format!("/v1/notebooks/{id}/sections"), &[])
                        .map_err(failed)?;
                    out.push(json!({ "id": id, "title": notebook["title"], "sections": sections["sections"] }));
                }
                Ok(shown(Value::Array(out)))
            }
            "search" => {
                let query = string_arg(args, "query")?;
                let limit = args["limit"].as_u64().unwrap_or(10).clamp(1, 50).to_string();
                let hits = session
                    .get("/v1/search", &[("q", query), ("limit", &limit)])
                    .map_err(failed)?;
                Ok(shown(hits["hits"].clone()))
            }
            "read_page" => {
                let page = id_arg(args, "page_id")?;
                let text = session
                    .get(&format!("/v1/pages/{page}"), &[("format", "md")])
                    .map_err(failed)?;
                Ok(text.as_str().unwrap_or_default().to_owned())
            }
            "create_page" => {
                let section = id_arg(args, "section_id")?;
                let body = json!({
                    "title": string_arg(args, "title")?,
                    "markdown": args["markdown"].as_str().unwrap_or_default(),
                });
                let created = session
                    .post(&format!("/v1/sections/{section}/pages"), &body)
                    .map_err(failed)?;
                Ok(format!(
                    "Added the page \u{201c}{}\u{201d} with ID {}.",
                    created["page"]["title"].as_str().unwrap_or_default(),
                    created["page"]["id"].as_str().unwrap_or_default()
                ))
            }
            "append_to_page" => {
                let page = id_arg(args, "page_id")?;
                let body = json!({ "markdown": string_arg(args, "markdown")? });
                let changed = session
                    .post(&format!("/v1/pages/{page}/append"), &body)
                    .map_err(failed)?;
                Ok(format!(
                    "Added to \u{201c}{}\u{201d}.",
                    changed["page"]["title"].as_str().unwrap_or_default()
                ))
            }
            _ => Err("There's no such tool.".into()),
        }
    }
}

/// A tool name the server doesn't have.
pub struct Unknown;

/// Reads messages from `input` until it closes, and writes each answer as one line to `output`.
pub fn serve(env: &Env, name: &str, input: &mut dyn Read, output: &mut dyn Write) -> io::Result<()> {
    let mut log = io::stderr();
    let mut server = Server::new(env, name, &mut log);
    let mut reader = BufReader::new(input);
    loop {
        let mut line = String::new();
        let read = (&mut reader).take(MAX_LINE).read_line(&mut line)?;
        if read == 0 {
            return Ok(());
        }
        if !line.ends_with('\n') && read as u64 >= MAX_LINE {
            let answer = rpc_error(&Value::Null, -32600, "The message is too large.");
            writeln!(output, "{answer}")?;
            output.flush()?;
            // Skip the rest of the oversized line.
            let mut rest = Vec::new();
            reader.read_until(b'\n', &mut rest)?;
            continue;
        }
        if line.trim().is_empty() {
            continue;
        }
        let answer = match serde_json::from_str::<Value>(&line) {
            Ok(Value::Array(_)) => Some(rpc_error(&Value::Null, -32600, "Batches aren't supported.")),
            Ok(message) => server.handle(&message),
            Err(_) => Some(rpc_error(&Value::Null, -32700, "That isn't JSON.")),
        };
        if let Some(answer) = answer {
            writeln!(output, "{answer}")?;
            output.flush()?;
        }
    }
}
