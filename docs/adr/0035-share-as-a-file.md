# ADR 0035: Share as a file is a ZIP of Markdown, optionally locked

- Status: Accepted
- Date: 2026-10-03

## Context

"Share as a file" packs a page, a section, or a notebook into one file that opens in OpenNote as a new notebook, with structure, tags, and properties, and an optional password. The note format (spec) stays at its current version. A shared file must open on a PC that already holds the original, so its pages cannot keep their IDs: two notebooks with the same page IDs would confuse the core, which finds a page by ID across notebooks. Recordings stored outside the notebook are not in the pages' folders, so a pack made from page folders would lose them.

## Decision

We will write the OpenNote Markdown export (spec 7: front matter with title, dates, and tags; sections as folders; pictures in `assets/`) into a ZIP archive with the extension `.opennote`, plus a manifest `opennote-share.json` (`format`, `version`, `title`, `scope`, `pages`, `locked`). The archive reads back through the Markdown importer, which makes every ID anew and rewrites links between pages.

A password locks the whole archive with audited RustCrypto crates:

- Argon2id (`argon2`; 64 MiB, 3 passes, 1 lane, 16 byte salt) makes a 256 bit key.
- XChaCha20-Poly1305 (`chacha20poly1305`) encrypts and authenticates the archive under a random 24 byte nonce from the operating system. The whole header is the associated data.
- The header stores the cost parameters. A reader refuses any outside 8 to 256 MiB, 1 to 10 passes, and 1 to 4 lanes before doing any work.
- Keys are zeroed after use. A wrong password and a damaged file give the same error.
- The locked file begins with `ONSHARE2`. Files that begin with `ONSHARE1` came from a hand-built SHA-256 construction in unreleased betas. They are not read, and the importer says so.

## Options considered

| Option | For | Against |
|---|---|---|
| ZIP of Markdown with a manifest (chosen) | Opens through code that is already tested; every ID is new; readable without OpenNote; no format change | Handwriting is a picture after opening; page history is not included |
| ZIP of notebook folders (`page.json`, strokes) | Keeps ink and history exactly | Needs ID remapping across pages, links, and history, which the core does not offer yet; page IDs would collide on the same PC |
| A construction built on SHA-256 alone (PBKDF2-HMAC-SHA256 and an HMAC keystream), used by unreleased betas | No new dependency | Hand-written cryptography; PBKDF2 is cheap to attack with graphics cards. Replaced before release |

## Consequences

Sharing keeps the readable parts of a notebook and loses editable ink and history; the export report says so. Recordings are not in the Markdown folders, so they are not shared yet. If the core gains a way to copy a notebook under new IDs, a second container with the exact folders can be added beside this one with a higher manifest `version`, and this reader stays. The lock's costs can rise in a later file without a new magic, since each file carries its own.
