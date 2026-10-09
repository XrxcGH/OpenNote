# Local API threat notes

What can go wrong with the local API (crates/api), the `opennote` tool and MCP server (crates/cli), and outgoing webhooks, and what stops it. Each line names the code that holds it and the test that checks it.

| Threat | Defense | Where |
| --- | --- | --- |
| A web page calls `127.0.0.1` from the person's browser | Any request with an `Origin` is refused unless it comes from a paired browser extension or the one paired mail add-in origin | `guard.rs`, `tests/api.rs` |
| DNS rebinding points an attacker's name at this PC | Only `127.0.0.1:<port>`, `localhost:<port>` and the pipe host name are accepted as `Host` | `guard.rs` |
| Another Windows user, or a remote machine, reaches the listener | Loopback bind only. The named pipe is created with `PIPE_REJECT_REMOTE_CLIENTS` and is private to the user's account | `server.rs` |
| A local program reads notes with no permission | Every request needs a per-app bearer token. A new app triggers an in-app approval, and starts read-only on one notebook | `grants.rs`, `routes.rs` |
| A token is stolen from disk | Only a hash is kept, in Windows Credential Manager. Tokens come from the system random source and compare in constant time | `grants.rs` |
| A fake server on the port collects the tool's token | The tool checks that the answering program is OpenNote before it sends its token | `crates/cli/src/session.rs` |
| An app reads a locked (encrypted) section | Locked sections are refused in every endpoint, in search, in export and in backup, whatever the grant | `app/src-tauri/src/api/backend.rs` |
| An app writes without the person knowing | Writes need the read-and-add grant and an in-app approval, and each lands in page history as "via <app>" | `routes.rs`, `approver.rs` |
| Export writes outside the notes | Export takes a section ID, never a path from the client | `routes.rs` |
| Log injection or secrets in the access log | Titles are scrubbed of line breaks. Tokens and note text are never logged. The file rotates at about 3 MB | `access_log.rs` |
| A webhook leaks notes or goes to a hostile address | HTTPS addresses typed by the person only. Payloads name the page and hold no note text. Each is signed with HMAC-SHA256. Retries back off and stop | `webhooks.rs`, `hmac.rs` |
| Pairing code guessed | One use, 10 minutes, five wrong tries end it | `pairing.rs` |
| An assistant is told by a note to do something | MCP tools return text as data. Writes still need the person's approval in the app | `crates/cli/src/mcp.rs` |

Left for the owner: code-signing the `opennote` binary, and store registration for the mail add-in and clipper.
