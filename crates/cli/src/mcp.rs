//! `opennote mcp`: a Model Context Protocol server on standard input and output, one JSON-RPC message per line, so
//! an AI assistant the person chooses can use their notes. Its tools come from the command registry
//! ([`opennote_api::commands`]) that the local API and the `opennote` tool share: listing, reading, searching, adding,
//! and the read-back tools `inspect_page` and `render_page`, which let the assistant check its own work, and
//! `list_commands`. Arguments are checked against the registry before anything reaches OpenNote.
//!
//! `--author` names who makes the changes, such as "Claude (copyedit)": page history then shows
//! "Changed via <assistant> (Claude (copyedit))". An `author` argument on a call overrides it for that call.
//!
//! The assistant gets its own access, separate from the command-line tool's: the first tool call asks the person
//! in OpenNote, read-only by default. Changes go through the same approval as any app, so OpenNote asks before each
//! one unless the person turned that off, and every call is in the access log. The server never prints anything
//! but protocol messages on standard output; what the person should know goes to standard error.

use std::io::{self, BufRead, BufReader, Read, Write};

use serde_json::{json, Value};

use opennote_api::commands::{self, by_mcp, check_args, COMMANDS};

use crate::{
    session::{id_ok, CliError, Env, Identity, Session},
    store::assistant_token,
};

/// The protocol versions this server speaks, newest first.
pub const PROTOCOL_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

/// The longest line the server reads: a request bigger than this is refused.
const MAX_LINE: u64 = 4 * 1024 * 1024;

/// The tools, as `tools/list` describes them: every registry command with an MCP name.
pub fn tools() -> Value {
    Value::Array(COMMANDS.iter().filter_map(commands::mcp_tool).collect())
}

/// One server: the session is opened on the first tool call, so starting the assistant never asks the person.
pub struct Server<'a> {
    env: &'a Env,
    identity: Identity,
    session: Option<Session>,
    /// Who makes the changes, from `--author`.
    author: Option<String>,
    log: &'a mut dyn Write,
}

fn reply(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn text_content(text: &str) -> Value {
    json!({ "type": "text", "text": text })
}

fn tool_result(content: Vec<Value>, is_error: bool) -> Value {
    json!({ "content": content, "isError": is_error })
}

impl<'a> Server<'a> {
    pub fn new(env: &'a Env, name: &str, author: Option<&str>, log: &'a mut dyn Write) -> Server<'a> {
        let app_name = opennote_api::grants::clean_name(name);
        Server {
            env,
            identity: Identity {
                token_name: assistant_token(&app_name),
                app_name,
                kind: "assistant",
            },
            session: None,
            author: author
                .map(|text| text.chars().filter(|c| !c.is_control()).take(commands::MAX_AUTHOR).collect::<String>())
                .map(|text| text.trim().to_owned())
                .filter(|text| !text.is_empty()),
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
                    Err(Unknown) => {
                        let shown: String = name.chars().take(64).collect();
                        rpc_error(&id, -32602, &format!("There's no tool called {shown}."))
                    }
                }
            }
            _ => rpc_error(&id, -32601, "This server doesn't have that method."),
        })
    }

    fn call(&mut self, name: &str, args: &Value) -> Result<Value, Unknown> {
        let command = by_mcp(name).ok_or(Unknown)?;
        Ok(match self.run_tool(command, args) {
            Ok(content) => tool_result(content, false),
            Err(text) => tool_result(vec![text_content(&text)], true),
        })
    }

    fn run_tool(&mut self, command: &commands::Command, args: &Value) -> Result<Vec<Value>, String> {
        // Check what the assistant sent before anything reaches OpenNote.
        check_args(command, args).map_err(|error| error.to_string())?;
        let mut args = args.clone();
        if let Some(author) = &self.author {
            if command.params.contains(&commands::AUTHOR) && args.get("author").is_none_or(Value::is_null) {
                args["author"] = json!(author);
            }
        }
        if command.id == "page.read" && args.get("format").is_none_or(Value::is_null) {
            args["format"] = json!("md");
        }
        let session = self.session().map_err(|error| error.to_string())?;
        let shown = |value: &Value| serde_json::to_string_pretty(value).unwrap_or_default();
        let failed = |error: CliError| error.to_string();
        if command.id == "notebooks.list" {
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
            return Ok(vec![text_content(&shown(&Value::Array(out)))]);
        }
        let (path, query, body) = commands::to_http(command, &args);
        let query: Vec<(&str, &str)> = query.iter().map(|(key, value)| (key.as_str(), value.as_str())).collect();
        let answer = if command.method == "GET" {
            session.get(&path, &query)
        } else {
            session.post(&path, &body)
        }
        .map_err(failed)?;
        let title = |value: &Value| value["page"]["title"].as_str().unwrap_or_default().to_owned();
        Ok(match command.id {
            "page.read" => vec![text_content(
                &answer.as_str().map_or_else(|| shown(&answer), str::to_owned),
            )],
            "search" => vec![text_content(&shown(&answer["hits"]))],
            "page.render" => vec![
                json!({ "type": "image", "data": answer["png"], "mimeType": "image/png" }),
                text_content(&format!(
                    "The page's handwriting and drawings: {} strokes, {} by {} pixels. Text isn't drawn; read_page and inspect_page give it.",
                    answer["strokes"], answer["width"], answer["height"]
                )),
            ],
            "page.create" => vec![text_content(&format!(
                "Added the page \u{201c}{}\u{201d} with ID {}.",
                title(&answer),
                answer["page"]["id"].as_str().unwrap_or_default()
            ))],
            "page.append" => vec![text_content(&format!("Added to \u{201c}{}\u{201d}.", title(&answer)))],
            "daily.append" => vec![text_content(&format!(
                "Added to today's daily note, \u{201c}{}\u{201d}.",
                title(&answer)
            ))],
            _ => vec![text_content(&shown(&answer))],
        })
    }
}

/// A tool name the server doesn't have.
pub struct Unknown;

/// Reads messages from `input` until it closes, and writes each answer as one line to `output`.
pub fn serve(
    env: &Env,
    name: &str,
    author: Option<&str>,
    input: &mut dyn Read,
    output: &mut dyn Write,
) -> io::Result<()> {
    let mut log = io::stderr();
    let mut server = Server::new(env, name, author, &mut log);
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
