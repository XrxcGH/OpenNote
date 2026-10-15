# ADR 0046: One command registry for the local API, the opennote command, and MCP

- Status: Accepted
- Date: 2026-10-15

## Context

The local API, the `opennote` command, and the MCP server each listed the same actions by hand: the API matched paths, the command matched words, and the MCP server wrote its own tool schemas and argument checks. They had already drifted (the MCP server had five tools; the API had eleven endpoints). An agent also had no way to check its own work without a screenshot, files the command read or wrote could be anywhere, and changes an agent made showed only the app's name in page history. Storytold's WordCraft control channel (`docs/mcp.md`, `docs/control-protocol.md`) solves the same problems; this ADR takes the parts that fit OpenNote's permission model.

## Decision

- **One registry.** `crates/api/src/commands.rs` lists every command once: ID, label, description, method and path, typed parameters (ID, one line with a length, Markdown, number range, word list), the grant it needs, whether it changes notes, its `opennote` word, and its MCP tool name. The API routes and names access-log entries through it, `GET /v1/commands` lists it with whether the caller's grant lets each command run, the MCP server builds `tools/list` and checks arguments from it, and the `opennote` command takes its words from it. Tests fail when a command has no help line, two commands share a route, or a path has the wrong number of IDs.
- **Read-back commands.** `page.inspect` (`inspect_page`, `opennote inspect`) lists a page's parts, headings, word count, and latest page history with who made each change. `page.render` (`render_page`, `opennote render`) draws the page's strokes as a PNG. Text is not drawn, because the app's text layout lives in the web view; `read_page` and `inspect_page` give the text.
- **File roots.** The `opennote` command reads `--file` only inside `--read-root` and writes `export --out` and `render --out` only inside `--write-root`, each the current folder by default (`crates/api/src/sandbox.rs`). Links are followed before the check, folders compare by whole names, and network paths, device paths, Windows device names (`CON`, `NUL`, `COM1`...), and data streams are refused with a message that says what to change.
- **Listener key.** Each start of the listener makes a 256-bit key, kept in Credential Manager and in a per-instance file `api-instance.key` in the local data folder (0600 on other systems), removed at stop. Clients prove the listener knows it before they send a token. The client only ever connects to `127.0.0.1` or the named pipe.
- **Caps.** A request has 30 seconds in all to arrive, 10 seconds per read, a 16 KB head, a 25 MB body, and 16 connections at once; an MCP line is at most 4 MB (a 2 MB Markdown body escaped in JSON fits).
- **Authors.** Changes take an optional `author` (one line, 60 characters). Page history shows "Changed via <app> (<author>)". The app's name comes from its grant; the author label is the app's own claim and is shown after it.
- **`hostile_params_never_panic`.** One test sends every registry command junk IDs, queries, bodies, and methods through the real router; another sends every MCP tool junk arguments. Neither may panic, answer 5xx, or touch a locked page.

## Options considered

| Option | For | Against |
|---|---|---|
| A registry table in the API crate (chosen) | One place, no macro, the CLI and MCP already depend on the crate | Handlers are still matched by ID in `routes.rs` |
| A `Command` trait with one type per command | Handler and description side by side | Much more code for 14 commands; the table reads better |
| Render pages in the web view for `render_page` | Text and pictures drawn exactly | Needs a window for each request and a running interface; a later change can add it behind the same command |
| A WordCraft-style raw TCP JSON channel | Close bad JSON to stop HTTP requests | OpenNote's channel is HTTP already, guarded by `Host`, `Origin`, and tokens |

## Consequences

A new command is a row in the table plus a handler; the tool, MCP, the listing, and the hostile test pick it up. Scripts that passed `--out` or `--file` outside the current folder now need `--read-root` or `--write-root`. `render_page` shows handwriting only until a web-view renderer exists.
