# ADR 0035: Share as a file is a ZIP of Markdown, optionally locked

- Status: Accepted
- Date: 2026-10-03

## Context

"Share as a file" packs a page, a section, or a notebook into one file that opens in OpenNote as a new notebook, with structure, tags, and properties, and an optional password. The note format (spec) stays at its current version. A shared file must open on a PC that already holds the original, so its pages cannot keep their IDs: two notebooks with the same page IDs would confuse the core, which finds a page by ID across notebooks. Recordings stored outside the notebook are not in the pages' folders, so a pack made from page folders would lose them.

## Decision

We will write the OpenNote Markdown export (spec 7: front matter with title, dates, and tags; sections as folders; pictures in `assets/`) into a ZIP archive with the extension `.opennote`, plus a manifest `opennote-share.json` (`format`, `version`, `title`, `scope`, `pages`, `locked`). The archive reads back through the Markdown importer, which makes every ID anew and rewrites links between pages. A password locks the whole archive: PBKDF2-HMAC-SHA256 (200,000 rounds, 16 byte salt) makes an encryption key and a tag key, HMAC-SHA256 in counter mode makes the keystream, and an HMAC-SHA256 tag over the header and ciphertext authenticates it (encrypt, then authenticate). The locked file begins with `ONSHARE1`. A wrong password and a damaged file give the same error. Only SHA-256 is used, which the crate already depends on.

## Options considered

| Option | For | Against |
|---|---|---|
| ZIP of Markdown with a manifest (chosen) | Opens through code that is already tested; every ID is new; readable without OpenNote; no format change | Handwriting is a picture after opening; page history is not included |
| ZIP of notebook folders (`page.json`, strokes) | Keeps ink and history exactly | Needs ID remapping across pages, links, and history, which the core does not offer yet; page IDs would collide on the same PC |
| An AEAD crate (AES-GCM, ChaCha20-Poly1305) for the lock | One reviewed primitive | A new dependency for one feature; the HMAC construction is standard and checked against the RFC 4231 and RFC 7914 vectors |

## Consequences

Sharing keeps the readable parts of a notebook and loses editable ink and history; the export report says so. Recordings are not in the Markdown folders, so they are not shared yet. If the core gains a way to copy a notebook under new IDs, a second container with the exact folders can be added beside this one with a higher manifest `version`, and this reader stays. Revisit the lock if a dependency on an AEAD crate becomes acceptable.
