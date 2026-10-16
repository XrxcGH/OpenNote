# ADR 0042: Protected sections are sealed file by file, and open only in memory

- Status: Proposed
- Date: 2026-10-15

## Context

Password-protected sections (A1-39, A2-16, A4-47; docs/FEATURES.md "Password-protected sections" and "Protected sections lock again") need a format decision. Spec 5.7 reserves the `encryption` key in `section.json`. It lists what a protected section must never leave in plain text: `page.md`, `ink.svg`, history, the cache, journal payloads, the search index, and thumbnails. The section's title, color, and place stay readable, so the tree can show it while it is locked.

The cryptography must come from audited crates only, never from code written here. Keys must be wiped from memory, and Windows Hello must unlock through the operating system.

## Decision

A protected section's folder on disk holds two things:

- A public `section.json` with the section's title, color, group, and order, without its page list, and with the `encryption` header.
- A hidden `.sealed` folder. Its `manifest` lists the section's files and folders. Each file is one blob with a random name.

The header holds key slots. A slot wraps the section's random 256 bit content key with XChaCha20-Poly1305, under a key that Argon2id makes from a secret. The password slot costs 64 MiB and 3 passes. The Windows Hello slot's secret is the signature that Hello's key makes over the slot's random challenge. That key is bound to the PC's TPM and never leaves it.

Each blob and the manifest are sealed under the content key with a fresh random 192 bit nonce. Their associated data names the section and the blob, so blobs can't be swapped. The crates are RustCrypto's `argon2` and `chacha20poly1305`, as `crates/interop/src/lock.rs` uses, and keys sit in `zeroize` buffers.

The core reads and writes every file through a file system seam, and `SealedFs` wraps the real one. While a section is unlocked, every path inside its folder is served from the manifest and the blobs. Its pages' journals stay in memory. Its `section.json` reads with `"unlocked": true` in the header, which is never written. That lets the core change the section while it keeps every other rule of spec 5.7. The core already applies those rules to any section with an `encryption` key.

Protecting, unlocking, locking, and removing protection close the notebook and open it again, so its pages save and close first. A wrong password is found before anything closes. Closing a notebook locks its sections. The shell locks every section when Windows locks or the PC sleeps. The interface locks them after a chosen idle time, and when the person leaves the section.

Pages can't move or copy into or out of a protected section. Trash can't hold them either, because Trash is plain. Deleting a page there deletes it for good, after a warning. A locked section can go to Trash as a whole, sealed. Backups copy what is on disk, so they hold sealed files. Recordings write straight to disk, so a protected section has none for now.

## Options considered

| Option | For | Against |
|---|---|---|
| Sealed blobs per file, served by a file system seam (chosen) | Every core rule keeps working; each save seals one file; a crash leaves whole files | File count and sizes show on disk |
| One sealed archive of the whole section | Hides file count and sizes | Every save rewrites the whole section |
| Plain files on disk while unlocked, sealed on lock | Simplest | Plain text on disk while unlocked, and after a crash |
| Windows EFS or BitLocker | Done by the OS | Not per section, not portable, and not on every edition |

## Consequences

Nothing of a protected section is in plain text on disk, in backups made after it was protected, or in the search index. The files' count and sizes, and the section's title, stay visible. Backups made before the section was protected still hold its plain files. SSDs may keep old blocks of the removed plain files, and the help says so.

A crash while a section is unlocked, or an exit that gives up on a busy core before the final save, loses the edits since its last save, because its journals are in memory; the in-memory journal reports each write as durable, so the interface shows no warning. The interface also keeps a protected page's lines out of browser storage: no inline flashcards or Upcoming items are kept for it, and any made before are removed. A forgotten password can't be recovered, by design. Version 1 readers show a protected section as locked and never write into it, as spec 5.7 already says.

The owner reviews this design, the Windows Hello prompt on real hardware, and the optional `protected` field on the notes contract's `NodeSummary`.
