// checks-disable-file modifiability: one match over the command words; split it when it grows again

//! The commands. Each one goes through the local API under the tool's own access, so it can do only what the
//! person allowed in OpenNote, and every call is in OpenNote's access log.

use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

use serde_json::{json, Value};

use crate::session::{id_ok, CliError, Env, Identity, Session};

pub const HELP: &str = "\
opennote: add to and search your OpenNote notes from a terminal or a script.

OpenNote must be open, with Settings > App permissions > \"Let apps on this PC connect\" on. The first command
asks for access in the OpenNote window; it starts read-only on the notebooks you pick there.

Usage: opennote [--json] <command> [arguments]

Commands:
  notebooks                        List the notebooks and sections this tool may use.
  pages <section-id>               List the pages in a section.
  read <page-id>                   Print a page as Markdown.
  search <words> [--limit N]       Search pages (locked sections are never searched).
  new <section-id> <title> [TEXT]  Add a page. TEXT, --file F, or standard input gives its text.
  append <page-id> [TEXT]          Add text to the end of a page (TEXT, --file F, or standard input).
  daily [TEXT]                     Add text to today's daily note (TEXT, --file F, or standard input).
  export <section-id> [--out DIR]  Save each page of a section as a Markdown file (default: this folder).
  backup                           Back up every notebook to the backup folder set in OpenNote.
  connect                          Ask OpenNote for access now.
  disconnect                       Forget this tool's key. Revoke it in App permissions to end its access.
  mcp [--name NAME]                Run the MCP server for an AI assistant on standard input and output.

Options:
  --json        Print OpenNote's answers as JSON.
  -h, --help    Print this help.
  -V, --version Print the version.

Adding and changing pages needs \"Read and add to notes\" in App permissions, and OpenNote asks before each
change unless you turn that off. Exit codes: 0 done, 1 failed, 2 wrong arguments, 3 OpenNote not reachable,
4 no access.";

/// The largest text the tool sends.
const MAX_TEXT: usize = 2 * 1024 * 1024;

/// Parsed arguments.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Args {
    pub json: bool,
    pub command: String,
    pub positional: Vec<String>,
    pub file: Option<PathBuf>,
    pub out: Option<PathBuf>,
    pub limit: Option<usize>,
    pub name: Option<String>,
}

pub fn parse(raw: &[String]) -> Result<Args, CliError> {
    let mut args = Args::default();
    let mut iter = raw.iter();
    let value = |iter: &mut std::slice::Iter<'_, String>, flag: &str| {
        iter.next()
            .cloned()
            .ok_or_else(|| CliError::Usage(format!("{flag} needs a value.")))
    };
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--json" => args.json = true,
            "-h" | "--help" => args.command = "help".into(),
            "-V" | "--version" => args.command = "version".into(),
            "--file" | "-f" => args.file = Some(PathBuf::from(value(&mut iter, "--file")?)),
            "--out" | "-o" => args.out = Some(PathBuf::from(value(&mut iter, "--out")?)),
            "--name" => args.name = Some(value(&mut iter, "--name")?),
            "--limit" | "-n" => {
                let text = value(&mut iter, "--limit")?;
                args.limit = Some(
                    text.parse::<usize>()
                        .ok()
                        .filter(|limit| (1..=50).contains(limit))
                        .ok_or_else(|| CliError::Usage("--limit takes a number from 1 to 50.".into()))?,
                );
            }
            "--" => args.positional.extend(iter.by_ref().cloned()),
            flag if flag.starts_with("--") => return Err(CliError::Usage(format!("{flag} isn't an option."))),
            _ if args.command.is_empty() => args.command = arg.clone(),
            _ => args.positional.push(arg.clone()),
        }
    }
    if args.command.is_empty() {
        args.command = "help".into();
    }
    Ok(args)
}

/// The text a command adds: its argument, the file, or standard input.
fn text_of(args: &Args, from: usize, stdin: &mut dyn Read) -> Result<String, CliError> {
    let text = if let Some(file) = &args.file {
        let size =
            fs::metadata(file).map_err(|error| CliError::Io(format!("Can't read {}: {error}", file.display())))?;
        if size.len() > MAX_TEXT as u64 {
            return Err(CliError::Usage("The file is larger than 2 MB.".into()));
        }
        fs::read_to_string(file).map_err(|error| CliError::Io(format!("Can't read {}: {error}", file.display())))?
    } else if args.positional.len() > from {
        args.positional[from..].join(" ")
    } else {
        let mut text = String::new();
        stdin
            .take(MAX_TEXT as u64 + 1)
            .read_to_string(&mut text)
            .map_err(|error| CliError::Io(format!("Can't read standard input: {error}")))?;
        text
    };
    if text.len() > MAX_TEXT {
        return Err(CliError::Usage("The text is larger than 2 MB.".into()));
    }
    if text.trim().is_empty() {
        return Err(CliError::Usage("There's no text to add.".into()));
    }
    Ok(text)
}

fn need_id(args: &Args, at: usize, what: &str) -> Result<String, CliError> {
    let id = args
        .positional
        .get(at)
        .ok_or_else(|| CliError::Usage(format!("Name the {what}.")))?;
    if !id_ok(id) {
        return Err(CliError::Usage(format!(
            "That isn't a {what} ID. `opennote notebooks` lists them."
        )));
    }
    Ok(id.clone())
}

/// A file name for an exported page: no folders or characters Windows refuses.
pub fn export_name(title: &str, taken: &mut std::collections::HashSet<String>) -> String {
    let mut base: String = title
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .take(80)
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_owned();
    if base.is_empty() {
        base = "Untitled page".into();
    }
    // Windows keeps these names for devices.
    let upper = base.to_ascii_uppercase();
    if ["CON", "PRN", "AUX", "NUL"].contains(&upper.as_str())
        || (upper.len() == 4 && (upper.starts_with("COM") || upper.starts_with("LPT")))
    {
        base.push('_');
    }
    let mut name = format!("{base}.md");
    let mut n = 2;
    while !taken.insert(name.to_lowercase()) {
        name = format!("{base} ({n}).md");
        n += 1;
    }
    name
}

/// Runs one command. Returns the exit code.
pub fn run(raw: &[String], env: &Env, stdin: &mut dyn Read, out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    match run_inner(raw, env, stdin, out, err) {
        Ok(()) => 0,
        Err(error) => {
            let _ = writeln!(err, "{error}");
            error.exit_code()
        }
    }
}

fn print(
    out: &mut dyn Write,
    args: &Args,
    value: &Value,
    human: impl FnOnce(&mut dyn Write) -> std::io::Result<()>,
) -> Result<(), CliError> {
    let written = if args.json {
        writeln!(out, "{}", serde_json::to_string_pretty(value).unwrap_or_default())
    } else {
        human(out)
    };
    written.map_err(|error| CliError::Io(error.to_string()))
}

fn run_inner(
    raw: &[String],
    env: &Env,
    stdin: &mut dyn Read,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> Result<(), CliError> {
    let args = parse(raw)?;
    let io = |error: std::io::Error| CliError::Io(error.to_string());
    match args.command.as_str() {
        "help" => return writeln!(out, "{HELP}").map_err(io),
        "version" => return writeln!(out, "opennote {}", env!("CARGO_PKG_VERSION")).map_err(io),
        "disconnect" => {
            Session::forget(env, &Identity::cli());
            return writeln!(
                out,
                "This tool's key is forgotten. To end its access, revoke it in OpenNote's App permissions."
            )
            .map_err(io);
        }
        "mcp" => {
            let name = args.name.clone().unwrap_or_else(|| "AI assistant".into());
            return crate::mcp::serve(env, &name, stdin, out).map_err(io);
        }
        "notebooks" | "pages" | "read" | "search" | "new" | "append" | "daily" | "export" | "backup" | "connect" => {}
        other => return Err(CliError::Usage(format!("`{other}` isn't a command."))),
    }
    // Check the arguments before asking OpenNote for anything.
    let text = match args.command.as_str() {
        "new" => {
            need_id(&args, 0, "section")?;
            if args.positional.get(1).is_none_or(|title| title.trim().is_empty()) {
                return Err(CliError::Usage("Give the new page a title.".into()));
            }
            Some(text_of(&args, 2, stdin).unwrap_or_default())
        }
        "append" => {
            need_id(&args, 0, "page")?;
            Some(text_of(&args, 1, stdin)?)
        }
        "daily" => Some(text_of(&args, 0, stdin)?),
        "pages" | "export" => {
            need_id(&args, 0, "section")?;
            None
        }
        "read" => {
            need_id(&args, 0, "page")?;
            None
        }
        "search" if args.positional.join(" ").trim().is_empty() => {
            return Err(CliError::Usage("Give the words to search for.".into()))
        }
        _ => None,
    };
    let session = Session::open(env, Identity::cli(), err)?;
    match args.command.as_str() {
        "connect" => {
            let me = session.get("/v1/me", &[])?;
            print(out, &args, &me, |out| {
                writeln!(
                    out,
                    "Connected to OpenNote as \u{201c}{}\u{201d} ({}).",
                    me["name"].as_str().unwrap_or(""),
                    me["access"].as_str().unwrap_or("")
                )
            })
        }
        "notebooks" => {
            let notebooks = session.get("/v1/notebooks", &[])?;
            let mut all = Vec::new();
            for notebook in notebooks["notebooks"].as_array().cloned().unwrap_or_default() {
                let id = notebook["id"].as_str().unwrap_or_default().to_owned();
                let sections = session.get(&format!("/v1/notebooks/{id}/sections"), &[])?;
                all.push(json!({ "notebook": notebook, "sections": sections["sections"] }));
            }
            let value = Value::Array(all);
            print(out, &args, &value, |out| {
                if value.as_array().is_some_and(Vec::is_empty) {
                    writeln!(
                        out,
                        "No notebooks are shared with this tool. Pick some in OpenNote's App permissions."
                    )?;
                }
                for entry in value.as_array().into_iter().flatten() {
                    writeln!(
                        out,
                        "{}  {}",
                        entry["notebook"]["id"].as_str().unwrap_or(""),
                        entry["notebook"]["title"].as_str().unwrap_or("")
                    )?;
                    for section in entry["sections"].as_array().into_iter().flatten() {
                        let locked = if section["locked"].as_bool() == Some(true) {
                            " (locked)"
                        } else {
                            ""
                        };
                        writeln!(
                            out,
                            "  {}  {}{locked}",
                            section["id"].as_str().unwrap_or(""),
                            section["title"].as_str().unwrap_or("")
                        )?;
                    }
                }
                Ok(())
            })
        }
        "pages" => {
            let section = need_id(&args, 0, "section")?;
            let pages = session.get(&format!("/v1/sections/{section}/pages"), &[])?;
            print(out, &args, &pages, |out| {
                for page in pages["pages"].as_array().into_iter().flatten() {
                    writeln!(
                        out,
                        "{}  {}",
                        page["id"].as_str().unwrap_or(""),
                        page["title"].as_str().unwrap_or("")
                    )?;
                }
                Ok(())
            })
        }
        "read" => {
            let page = need_id(&args, 0, "page")?;
            if args.json {
                let value = session.get(&format!("/v1/pages/{page}"), &[])?;
                return print(out, &args, &value, |_| Ok(()));
            }
            let markdown = session.get(&format!("/v1/pages/{page}"), &[("format", "md")])?;
            writeln!(out, "{}", markdown.as_str().unwrap_or_default()).map_err(io)
        }
        "search" => {
            let words = args.positional.join(" ");
            let limit = args.limit.unwrap_or(20).to_string();
            let hits = session.get("/v1/search", &[("q", &words), ("limit", &limit)])?;
            print(out, &args, &hits, |out| {
                let list = hits["hits"].as_array().cloned().unwrap_or_default();
                if list.is_empty() {
                    writeln!(out, "Nothing found.")?;
                }
                for hit in list {
                    writeln!(
                        out,
                        "{}  {}",
                        hit["page"]["id"].as_str().unwrap_or(""),
                        hit["page"]["title"].as_str().unwrap_or("")
                    )?;
                    let snippet = hit["snippet"].as_str().unwrap_or("").trim();
                    if !snippet.is_empty() {
                        writeln!(out, "    {snippet}")?;
                    }
                }
                Ok(())
            })
        }
        "new" => {
            let section = need_id(&args, 0, "section")?;
            let title = args.positional[1].clone();
            let created = session.post(
                &format!("/v1/sections/{section}/pages"),
                &json!({ "title": title, "markdown": text.unwrap_or_default() }),
            )?;
            print(out, &args, &created, |out| {
                writeln!(
                    out,
                    "Added \u{201c}{}\u{201d} ({}).",
                    created["page"]["title"].as_str().unwrap_or(""),
                    created["page"]["id"].as_str().unwrap_or("")
                )
            })
        }
        "append" => {
            let page = need_id(&args, 0, "page")?;
            let changed = session.post(
                &format!("/v1/pages/{page}/append"),
                &json!({ "markdown": text.unwrap_or_default() }),
            )?;
            print(out, &args, &changed, |out| {
                writeln!(
                    out,
                    "Added to \u{201c}{}\u{201d}.",
                    changed["page"]["title"].as_str().unwrap_or("")
                )
            })
        }
        "daily" => {
            let changed = session.post("/v1/daily", &json!({ "markdown": text.unwrap_or_default() }))?;
            print(out, &args, &changed, |out| {
                writeln!(
                    out,
                    "Added to today's daily note, \u{201c}{}\u{201d}.",
                    changed["page"]["title"].as_str().unwrap_or("")
                )
            })
        }
        "export" => {
            let section = need_id(&args, 0, "section")?;
            let exported = session.get(&format!("/v1/sections/{section}/export"), &[])?;
            let folder = args.out.clone().unwrap_or_else(|| PathBuf::from("."));
            let written = write_export(&folder, &exported)?;
            print(
                out,
                &args,
                &json!({ "folder": folder.display().to_string(), "files": written }),
                |out| writeln!(out, "Saved {} pages to {}.", written.len(), folder.display()),
            )
        }
        "backup" => {
            let done = session.post("/v1/backup", &json!({}))?;
            print(out, &args, &done, |out| {
                writeln!(out, "{}", done["folder"].as_str().unwrap_or("Backed up."))
            })
        }
        _ => Err(CliError::Usage("Unknown command.".into())),
    }
}

/// Writes each exported page as a Markdown file in `folder`. Never overwrites a file that is already there.
fn write_export(folder: &Path, exported: &Value) -> Result<Vec<String>, CliError> {
    fs::create_dir_all(folder).map_err(|error| CliError::Io(format!("Can't make {}: {error}", folder.display())))?;
    let mut taken = std::collections::HashSet::new();
    if let Ok(entries) = fs::read_dir(folder) {
        for entry in entries.flatten() {
            taken.insert(entry.file_name().to_string_lossy().to_lowercase());
        }
    }
    let mut written = Vec::new();
    for page in exported["pages"].as_array().into_iter().flatten() {
        let name = export_name(page["page"]["title"].as_str().unwrap_or_default(), &mut taken);
        let path = folder.join(&name);
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|error| CliError::Io(format!("Can't write {}: {error}", path.display())))?;
        file.write_all(page["markdown"].as_str().unwrap_or_default().as_bytes())
            .map_err(|error| CliError::Io(format!("Can't write {}: {error}", path.display())))?;
        written.push(name);
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_owned()).collect()
    }

    #[test]
    fn reads_commands_options_and_text() {
        let args = parse(&strings(&["--json", "search", "cell", "wall", "--limit", "5"])).expect("parses");
        assert!(args.json);
        assert_eq!(args.command, "search");
        assert_eq!(args.positional, ["cell", "wall"]);
        assert_eq!(args.limit, Some(5));
        assert_eq!(parse(&[]).expect("parses").command, "help");
        assert!(parse(&strings(&["search", "--limit", "500", "x"])).is_err());
        assert!(parse(&strings(&["--frobnicate"])).is_err());
        assert_eq!(
            parse(&strings(&["append", "p1", "--", "--not-a-flag"]))
                .expect("parses")
                .positional,
            ["p1", "--not-a-flag"]
        );
    }

    #[test]
    fn export_names_are_safe_and_never_clash() {
        let mut taken = std::collections::HashSet::new();
        assert_eq!(export_name("Cells: part 1/2", &mut taken), "Cells_ part 1_2.md");
        assert_eq!(export_name("Cells: part 1/2", &mut taken), "Cells_ part 1_2 (2).md");
        assert_eq!(export_name("CON", &mut taken), "CON_.md");
        assert_eq!(export_name("...", &mut taken), "Untitled page.md");
        assert_eq!(export_name("..\\..\\evil", &mut taken), "_.._evil.md");
    }
}
