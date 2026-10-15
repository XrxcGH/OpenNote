// checks-disable-file modifiability: one table of every command the API, the opennote tool, and MCP share

//! The command registry: every action the local API takes, once, with its ID, label, parameters, the access it
//! needs, and its names in the `opennote` tool and the MCP server. The API routes requests through it and names
//! access-log entries after it, the MCP server builds its tool list and checks arguments with it, and the tool
//! takes its command words from it, so the three can't drift apart (ADR 0046).
//!
//! [`check_args`] checks an assistant's arguments before anything reaches OpenNote, and says what to fix in words
//! an agent can act on.

use serde_json::{json, Map, Value};

use crate::grants::{Access, Scope};

/// What a command needs from the app's grant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Need {
    /// Any valid token. Names only: notebook and section titles, and the app's own grant.
    Token,
    Read,
    AddPages,
    /// Read and add to notes.
    Change,
    /// Read and add to notes, on every notebook.
    Backup,
}

impl Need {
    /// Whether a grant with `access` on `notebooks` may run a command that needs this.
    pub fn allows(self, access: Access, notebooks: &Scope) -> bool {
        match self {
            Need::Token => true,
            Need::Read => access.can_read(),
            Need::AddPages => access.can_add_pages(),
            Need::Change => access.can_change_pages(),
            Need::Backup => access.can_change_pages() && *notebooks == Scope::All,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Need::Token => "connected",
            Need::Read => "read",
            Need::AddPages => "addPages",
            Need::Change => "readWrite",
            Need::Backup => "readWriteAll",
        }
    }
}

/// What a parameter takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// An OpenNote ID: letters, digits, `-` and `_`, at most 64.
    Id,
    /// One line of text, at most this many characters.
    Line(usize),
    /// Markdown, at most 2 MB.
    Markdown,
    /// A whole number in this range.
    Int(i64, i64),
    /// One of these words.
    OneOf(&'static [&'static str]),
}

/// Where a parameter goes in the HTTP request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Place {
    /// The next `{}` in the path.
    Path,
    Query,
    Body,
}

/// One parameter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Param {
    /// Its name for the tool and MCP, in snake_case.
    pub name: &'static str,
    /// Its name in the HTTP query or JSON body.
    pub wire: &'static str,
    pub kind: Kind,
    pub required: bool,
    pub place: Place,
    pub doc: &'static str,
}

/// One command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Command {
    /// The ID the access log and `GET /v1/commands` use, such as `page.read`.
    pub id: &'static str,
    pub label: &'static str,
    pub doc: &'static str,
    pub method: &'static str,
    /// The path after `/v1/`, with `{}` for each [`Place::Path`] parameter in order.
    pub path: &'static [&'static str],
    pub params: &'static [Param],
    pub need: Need,
    /// It changes notes, so the person may be asked first.
    pub changes: bool,
    /// The `opennote` command word.
    pub cli: Option<&'static str>,
    /// The MCP tool name.
    pub mcp: Option<&'static str>,
}

const fn param(name: &'static str, wire: &'static str, kind: Kind, place: Place, doc: &'static str) -> Param {
    Param {
        name,
        wire,
        kind,
        required: true,
        place,
        doc,
    }
}

const fn optional(name: &'static str, wire: &'static str, kind: Kind, place: Place, doc: &'static str) -> Param {
    Param {
        name,
        wire,
        kind,
        required: false,
        place,
        doc,
    }
}

const PAGE_ID: Param = param("page_id", "page_id", Kind::Id, Place::Path, "The page's ID.");
const SECTION_ID: Param = param("section_id", "section_id", Kind::Id, Place::Path, "The section's ID.");
/// Who made a change, as page history shows it after the app's name, such as "Claude (copyedit)".
pub const AUTHOR: Param = optional(
    "author",
    "author",
    Kind::Line(MAX_AUTHOR),
    Place::Body,
    "Who is making the change, shown in page history after the app's name, such as \"Claude (copyedit)\".",
);

/// The longest author label.
pub const MAX_AUTHOR: usize = 60;

/// Every command, in the order `GET /v1/commands` lists them.
pub const COMMANDS: &[Command] = &[
    Command {
        id: "me",
        label: "This app's access",
        doc: "Shows the app's name, access, and notebooks.",
        method: "GET",
        path: &["me"],
        params: &[],
        need: Need::Token,
        changes: false,
        cli: Some("connect"),
        mcp: None,
    },
    Command {
        id: "commands.list",
        label: "List commands",
        doc: "Lists every command, with its parameters and whether this app's access lets it run.",
        method: "GET",
        path: &["commands"],
        params: &[],
        need: Need::Token,
        changes: false,
        cli: Some("commands"),
        mcp: Some("list_commands"),
    },
    Command {
        id: "notebooks.list",
        label: "List notebooks",
        doc: "Lists the notebooks this app may use.",
        method: "GET",
        path: &["notebooks"],
        params: &[],
        need: Need::Token,
        changes: false,
        cli: Some("notebooks"),
        mcp: Some("list_notebooks"),
    },
    Command {
        id: "sections.list",
        label: "List sections",
        doc: "Lists a notebook's sections. Locked sections are marked and can't be read.",
        method: "GET",
        path: &["notebooks", "{}", "sections"],
        params: &[param(
            "notebook_id",
            "notebook_id",
            Kind::Id,
            Place::Path,
            "The notebook's ID.",
        )],
        need: Need::Token,
        changes: false,
        cli: None,
        mcp: None,
    },
    Command {
        id: "pages.list",
        label: "List pages",
        doc: "Lists the pages in a section.",
        method: "GET",
        path: &["sections", "{}", "pages"],
        params: &[SECTION_ID],
        need: Need::Read,
        changes: false,
        cli: Some("pages"),
        mcp: Some("list_pages"),
    },
    Command {
        id: "page.read",
        label: "Read a page",
        doc: "Reads one page as Markdown.",
        method: "GET",
        path: &["pages", "{}"],
        params: &[
            PAGE_ID,
            optional(
                "format",
                "format",
                Kind::OneOf(&["md", "json"]),
                Place::Query,
                "md for Markdown only.",
            ),
        ],
        need: Need::Read,
        changes: false,
        cli: Some("read"),
        mcp: Some("read_page"),
    },
    Command {
        id: "page.inspect",
        label: "Inspect a page",
        doc: "Describes a page's parts: each block's kind and size, the headings, word count, and the latest \
              entries of page history with who made them. Use it to check a change landed as intended.",
        method: "GET",
        path: &["pages", "{}", "inspect"],
        params: &[PAGE_ID],
        need: Need::Read,
        changes: false,
        cli: Some("inspect"),
        mcp: Some("inspect_page"),
    },
    Command {
        id: "page.render",
        label: "Render a page's drawing",
        doc: "Draws the page's handwriting and drawings as a PNG picture. Text isn't drawn: read_page and \
              inspect_page give it.",
        method: "GET",
        path: &["pages", "{}", "render"],
        params: &[PAGE_ID],
        need: Need::Read,
        changes: false,
        cli: Some("render"),
        mcp: Some("render_page"),
    },
    Command {
        id: "search",
        label: "Search",
        doc: "Searches pages for words. Locked sections are never searched.",
        method: "GET",
        path: &["search"],
        params: &[
            param("query", "q", Kind::Line(500), Place::Query, "The words to look for."),
            optional(
                "limit",
                "limit",
                Kind::Int(1, 50),
                Place::Query,
                "At most this many results.",
            ),
        ],
        need: Need::Read,
        changes: false,
        cli: Some("search"),
        mcp: Some("search"),
    },
    Command {
        id: "section.export",
        label: "Export a section",
        doc: "Every page of a section as Markdown.",
        method: "GET",
        path: &["sections", "{}", "export"],
        params: &[SECTION_ID],
        need: Need::Read,
        changes: false,
        cli: Some("export"),
        mcp: None,
    },
    Command {
        id: "page.create",
        label: "Add a page",
        doc: "Adds a page at the end of a section. The person may be asked to allow it first.",
        method: "POST",
        path: &["sections", "{}", "pages"],
        params: &[
            SECTION_ID,
            param("title", "title", Kind::Line(200), Place::Body, "The page's title."),
            optional(
                "markdown",
                "markdown",
                Kind::Markdown,
                Place::Body,
                "The page's text as Markdown.",
            ),
            optional(
                "source_url",
                "sourceUrl",
                Kind::Line(2048),
                Place::Body,
                "The http or https address the text came from.",
            ),
            AUTHOR,
        ],
        need: Need::AddPages,
        changes: true,
        cli: Some("new"),
        mcp: Some("create_page"),
    },
    Command {
        id: "page.append",
        label: "Add to a page",
        doc: "Adds Markdown at the end of a page. The person may be asked to allow it first.",
        method: "POST",
        path: &["pages", "{}", "append"],
        params: &[
            PAGE_ID,
            param(
                "markdown",
                "markdown",
                Kind::Markdown,
                Place::Body,
                "The text to add, as Markdown.",
            ),
            AUTHOR,
        ],
        need: Need::Change,
        changes: true,
        cli: Some("append"),
        mcp: Some("append_to_page"),
    },
    Command {
        id: "daily.append",
        label: "Add to today's daily note",
        doc: "Adds Markdown to today's daily note, making it if needed. The person may be asked to allow it first.",
        method: "POST",
        path: &["daily"],
        params: &[
            param(
                "markdown",
                "markdown",
                Kind::Markdown,
                Place::Body,
                "The text to add, as Markdown.",
            ),
            AUTHOR,
        ],
        need: Need::Change,
        changes: true,
        cli: Some("daily"),
        mcp: Some("append_to_daily_note"),
    },
    Command {
        id: "backup",
        label: "Back up now",
        doc: "Backs up every notebook to the folder set in OpenNote. The person may be asked to allow it first.",
        method: "POST",
        path: &["backup"],
        params: &[],
        need: Need::Backup,
        changes: true,
        cli: Some("backup"),
        mcp: None,
    },
];

/// The largest Markdown a command takes.
pub const MAX_MARKDOWN: usize = 2 * 1024 * 1024;

/// A command by its ID.
pub fn by_id(id: &str) -> Option<&'static Command> {
    COMMANDS.iter().find(|command| command.id == id)
}

/// A command by its `opennote` word.
pub fn by_cli(word: &str) -> Option<&'static Command> {
    COMMANDS.iter().find(|command| command.cli == Some(word))
}

/// A command by its MCP tool name.
pub fn by_mcp(name: &str) -> Option<&'static Command> {
    COMMANDS.iter().find(|command| command.mcp == Some(name))
}

/// What a path matched.
#[derive(Debug, PartialEq, Eq)]
pub enum Routed<'p> {
    /// The command, and the path's IDs in order.
    Found(&'static Command, Vec<&'p str>),
    /// A command has this path, but not this method.
    WrongMethod,
    NotFound,
}

/// The command for a method and the path's segments after the version.
pub fn route<'p>(method: &str, parts: &[&'p str]) -> Routed<'p> {
    let mut path_matched = false;
    for command in COMMANDS {
        if command.path.len() != parts.len() {
            continue;
        }
        let mut ids = Vec::new();
        let matched = command.path.iter().zip(parts).all(|(shape, part)| {
            if *shape == "{}" {
                ids.push(*part);
                true
            } else {
                shape == part
            }
        });
        if !matched {
            continue;
        }
        if command.method == method {
            return Routed::Found(command, ids);
        }
        path_matched = true;
    }
    if path_matched {
        Routed::WrongMethod
    } else {
        Routed::NotFound
    }
}

/// An ID as OpenNote makes them.
pub fn id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Arguments that don't fit a command: which one, and what to do about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArgError {
    pub param: String,
    pub message: String,
}

impl std::fmt::Display for ArgError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.param, self.message)
    }
}

fn arg_error(param: &str, message: impl Into<String>) -> ArgError {
    ArgError {
        param: param.to_owned(),
        message: message.into(),
    }
}

/// Checks an assistant's arguments against a command, before anything reaches OpenNote: an object, no unknown
/// names, each required one there, each of the right kind and size.
pub fn check_args(command: &Command, args: &Value) -> Result<(), ArgError> {
    let Some(object) = args.as_object() else {
        return Err(arg_error("arguments", "Send the arguments as an object."));
    };
    for name in object.keys() {
        if !command.params.iter().any(|param| param.name == name) {
            let known: Vec<&str> = command.params.iter().map(|param| param.name).collect();
            let known = if known.is_empty() {
                "none".to_owned()
            } else {
                known.join(", ")
            };
            return Err(arg_error(
                &name.chars().take(64).collect::<String>(),
                format!("This tool has no such argument. It takes: {known}."),
            ));
        }
    }
    for param in command.params {
        match object.get(param.name) {
            None | Some(Value::Null) if param.required => {
                return Err(arg_error(param.name, format!("Required. {}", param.doc)));
            }
            None | Some(Value::Null) => {}
            Some(value) => check_value(param, value)?,
        }
    }
    Ok(())
}

fn check_value(param: &Param, value: &Value) -> Result<(), ArgError> {
    let text = || {
        value
            .as_str()
            .ok_or_else(|| arg_error(param.name, "Send it as a string."))
    };
    match param.kind {
        Kind::Id => {
            if !id_ok(text()?) {
                return Err(arg_error(
                    param.name,
                    "That isn't an OpenNote ID. Use list_notebooks, list_pages, or search to find one.",
                ));
            }
        }
        Kind::Line(max) => {
            let text = text()?;
            if text.chars().count() > max {
                return Err(arg_error(param.name, format!("Send at most {max} characters.")));
            }
            if text.chars().any(|c| c.is_control()) {
                return Err(arg_error(param.name, "Send one line, without control characters."));
            }
        }
        Kind::Markdown => {
            if text()?.len() > MAX_MARKDOWN {
                return Err(arg_error(param.name, "Send at most 2 MB of Markdown."));
            }
        }
        Kind::Int(min, max) => {
            let number = value
                .as_i64()
                .ok_or_else(|| arg_error(param.name, "Send a whole number."))?;
            if !(min..=max).contains(&number) {
                return Err(arg_error(param.name, format!("Send a number from {min} to {max}.")));
            }
        }
        Kind::OneOf(words) => {
            if !words.contains(&text()?) {
                return Err(arg_error(param.name, format!("Send one of: {}.", words.join(", "))));
            }
        }
    }
    Ok(())
}

/// A checked call as HTTP: the path, the query, and the JSON body (empty for a `GET`).
pub fn to_http(command: &Command, args: &Value) -> (String, Vec<(String, String)>, Value) {
    let mut ids = command
        .params
        .iter()
        .filter(|param| param.place == Place::Path)
        .map(|param| args[param.name].as_str().unwrap_or_default().to_owned());
    let path: Vec<String> = command
        .path
        .iter()
        .map(|part| {
            if *part == "{}" {
                ids.next().unwrap_or_default()
            } else {
                (*part).to_owned()
            }
        })
        .collect();
    let mut query = Vec::new();
    let mut body = Map::new();
    for param in command.params {
        let value = &args[param.name];
        if value.is_null() {
            continue;
        }
        match param.place {
            Place::Path => {}
            Place::Query => query.push((
                param.wire.to_owned(),
                value.as_str().map_or_else(|| value.to_string(), str::to_owned),
            )),
            Place::Body => {
                body.insert(param.wire.to_owned(), value.clone());
            }
        }
    }
    (format!("/v1/{}", path.join("/")), query, Value::Object(body))
}

fn schema_of(kind: Kind) -> Value {
    match kind {
        Kind::Id => json!({ "type": "string", "pattern": "^[A-Za-z0-9_-]{1,64}$" }),
        Kind::Line(max) => json!({ "type": "string", "maxLength": max }),
        Kind::Markdown => json!({ "type": "string", "maxLength": MAX_MARKDOWN }),
        Kind::Int(min, max) => json!({ "type": "integer", "minimum": min, "maximum": max }),
        Kind::OneOf(words) => json!({ "type": "string", "enum": words }),
    }
}

/// The MCP tool for a command.
pub fn mcp_tool(command: &Command) -> Option<Value> {
    let name = command.mcp?;
    let mut properties = Map::new();
    for param in command.params {
        let mut schema = schema_of(param.kind);
        schema["description"] = json!(param.doc);
        properties.insert(param.name.to_owned(), schema);
    }
    let required: Vec<&str> = command
        .params
        .iter()
        .filter(|param| param.required)
        .map(|param| param.name)
        .collect();
    Some(json!({
        "name": name,
        "description": command.doc,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": false
        },
        "annotations": {
            "title": command.label,
            "readOnlyHint": !command.changes,
            "destructiveHint": false,
            "openWorldHint": false
        }
    }))
}

/// Every command as `GET /v1/commands` and `list_commands` list it, each with whether `access` on `notebooks`
/// lets it run.
pub fn listing(access: Access, notebooks: &Scope) -> Value {
    let commands: Vec<Value> = COMMANDS
        .iter()
        .map(|command| {
            json!({
                "id": command.id,
                "label": command.label,
                "doc": command.doc,
                "method": command.method,
                "path": format!("/v1/{}", command.path.join("/")),
                "needs": command.need.name(),
                "changes": command.changes,
                "enabled": command.need.allows(access, notebooks),
                "cli": command.cli,
                "mcp": command.mcp,
                "params": command.params.iter().map(|param| json!({
                    "name": param.name,
                    "required": param.required,
                    "doc": param.doc,
                    "schema": schema_of(param.kind),
                })).collect::<Vec<_>>(),
            })
        })
        .collect();
    json!({ "commands": commands })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_command_has_a_unique_id_route_and_names() {
        for (i, command) in COMMANDS.iter().enumerate() {
            for other in &COMMANDS[i + 1..] {
                assert_ne!(command.id, other.id);
                assert!(command.cli.is_none() || command.cli != other.cli, "{}", command.id);
                assert!(command.mcp.is_none() || command.mcp != other.mcp, "{}", command.id);
                assert!(
                    command.method != other.method || command.path != other.path,
                    "{} and {} share a route",
                    command.id,
                    other.id
                );
            }
            let holes = command.path.iter().filter(|part| **part == "{}").count();
            let path_params = command.params.iter().filter(|param| param.place == Place::Path).count();
            assert_eq!(holes, path_params, "{}", command.id);
            assert_eq!(command.changes, command.method == "POST", "{}", command.id);
        }
    }

    #[test]
    fn routes_by_shape_and_method() {
        assert!(
            matches!(route("GET", &["pages", "p1"]), Routed::Found(command, ids) if command.id == "page.read" && ids == ["p1"])
        );
        assert!(
            matches!(route("GET", &["pages", "p1", "inspect"]), Routed::Found(command, _) if command.id == "page.inspect")
        );
        assert_eq!(route("DELETE", &["pages", "p1"]), Routed::WrongMethod);
        assert_eq!(route("GET", &["pages", "p1", "nope"]), Routed::NotFound);
    }

    #[test]
    fn checks_arguments_in_words_an_agent_can_act_on() {
        let create = by_mcp("create_page").expect("a tool");
        assert!(check_args(create, &json!({ "section_id": "s1", "title": "T" })).is_ok());
        let error = check_args(create, &json!({ "section_id": "../x", "title": "T" })).expect_err("refused");
        assert_eq!(error.param, "section_id");
        assert!(check_args(create, &json!({ "section_id": "s1" })).is_err());
        assert!(check_args(create, &json!({ "section_id": "s1", "title": "T", "extra": 1 })).is_err());
        assert!(check_args(create, &json!({ "section_id": "s1", "title": "a\nb" })).is_err());
        assert!(check_args(create, &json!([1])).is_err());
        let search = by_mcp("search").expect("a tool");
        assert!(check_args(search, &json!({ "query": "x", "limit": 51 })).is_err());
        assert!(check_args(search, &json!({ "query": "x", "limit": "5" })).is_err());
        let (path, query, _) = to_http(search, &json!({ "query": "cell wall", "limit": 5 }));
        assert_eq!(path, "/v1/search");
        assert_eq!(
            query,
            [
                ("q".to_owned(), "cell wall".to_owned()),
                ("limit".to_owned(), "5".to_owned())
            ]
        );
        let (path, _, body) = to_http(
            create,
            &json!({ "section_id": "s1", "title": "T", "source_url": "https://x.org" }),
        );
        assert_eq!(path, "/v1/sections/s1/pages");
        assert_eq!(body, json!({ "title": "T", "sourceUrl": "https://x.org" }));
    }

    #[test]
    fn says_which_commands_a_grant_can_run() {
        let listing = listing(Access::Read, &Scope::Notebooks(vec!["nb".into()]));
        let enabled = |id: &str| {
            listing["commands"]
                .as_array()
                .and_then(|all| all.iter().find(|command| command["id"] == id))
                .map(|command| command["enabled"] == true)
        };
        assert_eq!(enabled("page.read"), Some(true));
        assert_eq!(enabled("page.append"), Some(false));
        assert_eq!(enabled("backup"), Some(false));
    }
}
