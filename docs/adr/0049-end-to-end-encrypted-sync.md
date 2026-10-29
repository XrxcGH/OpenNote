# ADR 0049: Optional end-to-end-encrypted sync over storage people already have

- Status: Proposed
- Date: 2026-10-28

## Context

People keep notebooks on more than one device. Today they can put the notes folder in OneDrive, Dropbox, iCloud Drive, or Syncthing, and the note format already expects it ([ADR 0008](0008-note-file-format.md), spec section 14): immutable ink and asset files, one commit point per page, and conflicts kept in `.conflicts/`. That works, but the sync service can read every note, and the person has to trust it.

The owner asked for an optional built-in sync with three rules:

- It is end-to-end encrypted. Only the person's devices hold the keys.
- It works with no server that the project must host or pay for.
- It never drops text silently, and it never decrypts a protected section ([ADR 0042](0042-protected-sections.md)).

ADR 0008 also asks the sync design to make garbage collection safe across devices.

## Decision

We will build a sync engine (`crates/sync`, the `opennote-sync` crate) that keeps an encrypted copy of the notes folder in "dumb" storage: storage that can only store, list, read, and delete named blobs. It ships with a **folder** backend (any synced or network folder, including the OneDrive, Dropbox, iCloud Drive, and Syncthing folders people already have, see [ADR 0036](0036-icloud-is-folder-based.md)) and a **WebDAV** backend. A backend for S3-compatible storage fits the same interface and is a follow-up. Sync is off until the person sets it up in Settings > Sync, and it is labeled Beta.

### What is stored

Every name in storage is random or a keyed hash. Nothing in storage names a notebook, a section, a page, or a file.

| Object | Name | Contents |
|---|---|---|
| Vault header | `vault` | Format version, vault ID, Argon2id cost and salt, and the vault key wrapped twice: under the passphrase and under the recovery key |
| Chunk | `c/<2 hex>/<64 hex>` | Up to 1 MiB of one file, padded to a size bucket and sealed. The name is a BLAKE2b MAC of the plain bytes under a key derived from the vault key, so equal chunks dedupe while the storage can't test a guess |
| Head | `h/<device tag>/<generation>` | One device's whole manifest: every path with its chunk list, size, version vector, and tombstone flag, compressed and sealed. A device writes only its own heads, and each generation is a new file |
| Device slot | `k/<device tag>` | The vault key wrapped under that device's own secret, and the device's name and date sealed under the vault key |
| Pairing slot | `j/<random tag>` | The vault key wrapped under a one-time pairing code, with an expiry, for adding a device by QR code or typed code |
| Revocation | `x/<device tag>` | A sealed note that a device was removed |

Sealing is XChaCha20-Poly1305 with a random 192 bit nonce, from RustCrypto's audited `chacha20poly1305`, as `crates/interop/src/lock.rs` does. The associated data binds each object to the vault ID, its kind, and its name, so objects can't be swapped, renamed, or moved between vaults. The storage backend sees only opaque blobs, their padded sizes, how many there are, and when they change. It sees how many devices sync and how often, but not their names.

### Keys

- The **vault key** is 256 random bits. Every object is sealed under keys derived from it with BLAKE2b.
- The **passphrase** unlocks it through Argon2id with lock.rs's cost (64 MiB, 3 passes, 1 lane), and the same bounds check refuses a hostile header before any work.
- The **recovery key** is 256 random bits, shown once as 13 groups of 4 characters, and confirmed by typing two groups back. It unlocks the vault when the passphrase is forgotten. OpenNote never stores it.
- Each **device** has its own random secret, kept in the operating system's credential store (Windows Credential Manager), and its own slot. Background sync uses the device slot, so the passphrase is typed only when a device joins.
- **Adding a device**: an existing device makes a one-time pairing code (120 bits, shown as a QR code and as text) and a pairing slot that expires in 24 hours. The new device types or scans the code, unwraps the vault key, writes its own slot, and deletes the pairing slot. The passphrase also works.
- **The header's generation and device list.** After the slots, the `vault` header carries a generation and the tags of the devices that may sync, under its MAC. Changing the passphrase, adding a device, and removing one each count the generation up; storage has no compare-and-swap, so the writer reads the header back and makes its change again if another device's write replaced it. Each device keeps the highest generation it saw in its state file, and a lower one is reported as a rollback. A device slot the list leaves out does not unlock, so putting back an old `k/<tag>` and deleting `x/<tag>` does not let a removed device in.
- **Removing a device** deletes its slot and writes a revocation. A removed device that is honest stops syncing and forgets its keys. A device that was stolen and kept a copy of the vault key can still read what it already had; locking it out of future changes needs a full re-key, which is a follow-up listed below.

Keys stay in `zeroize` buffers. No key, passphrase, or recovery key is ever logged, put in a crash report, or sent anywhere.

### Merging

Each file has a version vector. A device that changes a file increments its own counter, counting up from the highest count of its own that any head it merges already used for that path. So a round that published a head and stopped before saving its state, or a state restored from a backup, never gives a new edit a version vector that another version already has. When two devices changed a file concurrently, the engine resolves it with rules that give the same answer on every device, in any order, so all devices converge:

| File | Rule |
|---|---|
| `page.json` | If one revision lists the other in its `ancestors`, the newer one wins. Otherwise the copy saved later (then the one whose bytes sort later) stays as `page.json`, and the other goes to `.conflicts/<its revision ID>.json`, which the app already shows as "This page was also changed on another device. Compare the versions." The person keeps one, the other, or both as separate pages (spec 14.1). No text is dropped |
| `section.json`, `notebook.json`, `.history/versions.json` | The core's own commutative merges (spec 14.3 and 13): the union by ID, with the later change of each entry |
| Ink segments and assets | Immutable, so they never conflict. Equal bytes are one chunk |
| `page.md`, `ink.svg`, `index.md`, `README.md`, `.opennote/FORMAT.md` | Derived from the files above, so the copy whose bytes sort later wins and the app writes them again |
| A protected section's `.sealed/manifest` | Never decrypted. The `.sealed` folder is one unit: the later-sorting manifest stays, and the other version is kept whole beside it as `.sealed-conflict-<hash>/`, its manifest with a copy of every blob either version may name (blobs never change and equal bytes are one chunk, so copies cost no storage). The merge reports it as a conflict, the section shows "This protected section was changed on two devices" with Switch and Remove, and the core keeps these folders when it tidies a section on unlock |
| Anything else | The later-sorting copy stays, and the other is kept beside it as `<name> (conflicted copy <hash>)<extension>` |

An edit always beats a delete. When a page folder still has a live `page.json` an ink segment or asset that another device deleted without having seen that version comes back, so a merged page never points at missing ink. Sync can't read a sealed manifest, and each path has its own version vector, so a sealed blob's delete is never compared with the manifest's version: deleted blobs come back only when the manifest itself merged from concurrent versions, and otherwise the delete stands. Deleting a page moves it to the notebook's Trash, which is just more files, so Trash and its 30-day rule travel unchanged.

### Safety

- **Crash safety and resumable transfers.** Chunks are written first, then the head, then the local state. Folder writes go to a temporary name and are renamed. WebDAV writes go to `tmp/` and are moved. A transfer that stops is repeated from the first missing chunk, and a half-written blob fails its tag and is ignored.
- **Local changes are never overwritten.** Before a downloaded file replaces a local one, the engine checks that the local file still has the bytes it planned against. A file changed in the meantime waits for the next sync.
- **Tamper and rollback detection.** Every blob is authenticated. Each device remembers the newest generation it has seen from every device, and of the vault header. A head or header older than that is reported as a rollback. A changed blob is reported and skipped. Sync then pauses with a calm message instead of guessing.
- **Vault checks.** Every unlock, including a device's background unlock and a pairing, checks the header's MAC, in constant time, so a changed slot or cost shows. A passphrase is never checked at less than the 64 MiB, three-pass cost, whatever a header asks.
- **Bounded memory.** Files stream through one 1 MiB chunk at a time. The manifest is about 150 bytes a file.
- **Preview.** Every sync first builds a plan of uploads, downloads, deletions, and conflicts. "Preview changes" shows it without changing anything.
- **Garbage collection.** A chunk is removed only when no head of any device and no tombstone refers to it. Old heads of a device are removed once a newer one of the same device is in place. A marked chunk waits a week and two newer heads of every device that isn't removed, and a run stops if a head appears while it works. A round that found a chunk already stored checks it again after writing its head and sends it if it went. Turning sync off removes the device's slot, so it no longer holds collection up, and the device list shows when each device last synced so a lost one can be removed.
- **Work offline** pauses sync. Nothing leaves the device unless the person set sync up. There is no telemetry.

## Options considered

| Option | For | Against |
|---|---|---|
| Sync engine over pluggable dumb storage, with folder and WebDAV backends (chosen) | No server for the project to run. Works with storage people already have. The storage sees only sealed blobs | Each device must poll. Dumb storage has no locks, so every device writes only its own files |
| Plain folder sync with the existing format (today) | Already works, no new code | The sync service reads every note |
| A hosted relay run by the project | Push updates, easy pairing | A service to run, pay for, secure, and keep alive. **Open decision for the owner**; this build does not include one |
| A self-hostable relay | People who want push can run it | More code to secure. It fits later as one more backend |
| Operation log per page (CRDT) | Merges text at the character level | Needs every writer to log operations, a large change to the core, and a bigger attack surface. Block-level merge of `page.json` is a follow-up |
| A backend for S3-compatible storage | Cheap object storage | Needs request signing. Fits the same interface; a follow-up |

## Threat model

| Who | Can | Can't |
|---|---|---|
| The storage provider, or anyone who reads the folder or server | See blob count, padded sizes, timing, and the number of devices | Read any note, file name, title, or structure. Change a blob without being noticed |
| Someone who changes or deletes blobs | Stop sync, or withhold the newest changes from a device that never saw them | Make a device accept changed content, or roll back a device that already saw newer changes without a warning |
| Someone with the passphrase or recovery key and the storage | Read everything | Nothing; these are the keys |
| A removed device that kept the vault key | Read what it had and new blobs, until a re-key | Join again once its slot is gone, unless it kept the key |
| A storage writer who keeps old copies of the folder | Put back an older `vault` header, so an old passphrase or a removed device's slot works again. Until a re-key exists, changing the passphrase and removing a device are advisory against this writer | Do it without a warning on every device that saw the newer header: each reports a rollback and stops |
| Malware on a device | Everything that device can read | This is out of scope, as it is for the notes on that disk |

## Consequences

Sync is opt-in and off by default. The folder backend works with every sync tool, and the format's own conflict rules keep working beside it. People who forget both the passphrase and the recovery key, and have no device left, lose the synced copy, by design; each device still has its own notes.

Follow-ups: a full re-key when a device is removed; block-level merge of `page.json` when both copies changed different blocks; a backend for S3-compatible storage; and, if the owner decides, a relay.

The owner decides whether a hosted or self-hostable relay is ever offered, and reviews this design, the threat model, the pairing flow on two real devices, and the device secret's place in Windows Credential Manager.
