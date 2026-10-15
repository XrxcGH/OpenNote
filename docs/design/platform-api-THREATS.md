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
| A webhook leaks notes or goes to a hostile address | HTTPS addresses typed by the person only, never an IP address, or a `.local`, `.lan`, `.internal` or `.home.arpa` name, so a hook can't be aimed at a router or another PC. Redirects aren't followed. Payloads name the page and hold note text only when the person ticks that box. Each is signed with HMAC-SHA256, and the secret lives in Credential Manager. Retries back off and stop | `webhooks.rs`, `hmac.rs` |
| A host name that resolves to a LAN address (DNS rebinding of a webhook) | Not blocked: the address is resolved by the system at send time. The hook still needs HTTPS with a valid certificate for that name, and gets only the signed event | Known gap |
| Pairing code guessed | One use, 5 minutes, five wrong tries end it. At most five pairing questions in 10 minutes | `pairing.rs` |
| A web page opens an `opennote://clip` link | The app never acts on it alone: it offers to add a page with the title and address to Quick notes, and adds it only on **Add**. Only `http`/`https` addresses without user names pass, titles are cut to 200 characters and stripped of control characters, and the link is at most 512 characters | `app/src/features/integrations/clip/link.ts`, `deeplink.rs` |
| A share carries something hostile | Text and files are bounded (2 MB of text, 10 files of 15 MB); links must be web links; files land through the page's own paste, which treats them as data | `app/src-tauri/src/share` |
| Someone on the same Wi-Fi reaches Insert > From phone | The listener exists only while the dialog is open, 10 minutes at most, on the PC's private address only, and drops connections from non-private addresses. The QR token is 128 random bits, works once, and is exchanged for an HttpOnly, Secure, SameSite=Strict cookie bound to the phone's address. Ten wrong tokens close it; each address gets 60 requests a minute; four connections at once | `crates/api/src/phone.rs`, `tests/phone.rs` |
| A hostile file from the phone | JPEG or PNG only, checked by magic bytes against the declared type, up to 20 MB, decoded with a 12,000-pixel side and memory limits, then encoded again, which drops EXIF data such as location | `phone.rs` (`clean_photo`), `tests/phone.rs` |
| Someone intercepts the phone's upload | TLS with a certificate made for each session; the dialog shows its SHA-256 fingerprint to compare. A phone's browser warns about the unknown certificate, and the help page says why | `phone.rs`, `docs/help/phone-scan.md` |
| The phone page is used for script injection | The page has one inline script allowed by its hash in a strict Content-Security-Policy (`default-src 'none'`), no referrer, and no framing | `phone.rs` |
| An assistant is told by a note to do something | MCP tools return text as data. Writes still need the person's approval in the app | `crates/cli/src/mcp.rs` |

Left for the owner: code-signing the `opennote` binary, and store registration for the mail add-in and clipper.
