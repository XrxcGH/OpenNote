# ADR 0013: Settings and device state storage

- Status: Proposed
- Date: 2026-09-30

## Context

DEVELOPMENT.md section 9 puts settings in `%APPDATA%\OpenNote\settings.json`, requires backups before migrations, and requires that an older version opens newer files read-only, so going back to the previous version is safe. BRAND.md says the theme preference belongs to the person, not the device. Some state belongs to the device: window placement, pane widths, the last location, and per-page view state. So do the settings of this device's pens, and whether this device has been set up, because where the app lives is device-specific. Tauri's own path helpers would use `%APPDATA%\org.opennote.app`.

Settings must survive crashes during writes, rollbacks to older versions, and hand edits. The saved theme must be known before the window exists, so the first frame has the right color. Later phases add settings groups of their own (Phase 4's `editing` and Phase 5's `ink`), so adding a field must not be a breaking change.

## Decision

We will keep two files, both owned by Rust:

- `%APPDATA%\OpenNote\settings.json` holds personal preferences: appearance, shortcuts and the shortcut set, the update policy, the notes folder, completed person-scoped setup steps, experimental flags, and the `editing` and `ink` groups. It roams with a Windows profile and can sync later.
- `%LOCALAPPDATA%\OpenNote\state.json` holds device state: placement, panes, location, expanded rows, recent commands, and recent pages. It also holds device-scoped setup progress and its draft, the view state of the 500 most recently used pages, and the ink device state. It is disposable.

### Changes

The front end changes settings only through JSON merge patches, as Request for Comments (RFC) 7396 defines them. Rust applies a patch to a copy of the raw document, then parses and validates every field it touches. The checks cover enumerations, the text size list, ranges, absolute paths, and chords that are well formed and not reserved. An invalid patch changes nothing and fails with the field's path. The schema version fields change only through migrations.

The store keeps the raw document and a typed view parsed from it. Unknown keys and values stay in the raw document, so a newer version's keys survive every write. Each field parses on its own. A wrong type, an unknown enum value, or a value that fails its check falls back to that field's default and logs the path. The rest of the file is kept.

### Writes and recovery

Writes go through a writer thread that folds changes together (250 ms for settings, 500 ms for device state), then writes `<name>.tmp`, calls `sync_all`, and renames it over the file in the same folder. Theme changes and the exit handshake write at once. After each good load, the file is copied to `settings.json.bak`. A file that isn't valid JSON is renamed to `settings.corrupt-<timestamp>.json`, and the `.bak` copy or the defaults take its place, with a notice in the boot payload. A corrupt `state.json` is set aside and starts over.

### Versions

`schemaVersion` changes only when a field's meaning or shape changes, with a tested migration and a backup first. Backups go to `%LOCALAPPDATA%\OpenNote\backups\`, which keeps the three newest. Adding a field with a default keeps the version. `minWriterSchema` says which schema versions may still write. A normal migration leaves it alone, so older versions keep writing through merge patches and never lower either number. A breaking migration raises it, and older versions then open settings read-only.

### Types

TypeScript types for settings and state are generated from the Rust structs with ts-rs 12 in `cargo test`, together with the default values as JSON. CI fails when the committed files drift, and a Vitest test compares the interface's defaults with Rust's.

## Options considered

| Option | For | Against |
|---|---|---|
| Rust-owned roaming settings and local state, merge patches, `minWriterSchema` (chosen) | One writer; survives crashes, rollbacks, and roaming; older versions stay useful unless a change is truly breaking | More code than a plugin; migrations need discipline |
| One settings file for everything | Simpler | Device state would roam and fight across devices; a new device couldn't run its device-only setup step |
| Always read-only when a file is newer | Simplest rule for going back | Every "Go back" after any schema bump would freeze settings, even for compatible changes |
| `tauri-plugin-store` and `tauri-plugin-window-state` | Ready-made | Files under the identifier folder, without our schema, migrations, atomic writes, or unknown-key rules |
| Settings in WebView2 `localStorage` (Phase 0) | Already there | Not readable before the window exists, so the start-up theme can't come from it; not safe across data folder changes |

## Consequences

- Easier: the saved theme is known before the window is created, and going back to an older version keeps working. A new device with a roaming profile runs only its device setup step. Later phases add settings groups without a migration.
- Harder: every settings change needs a decision about `schemaVersion` and `minWriterSchema`, and each migration needs a fixture test in `app/src-tauri/tests/fixtures/`. The Phase 0 `localStorage` theme isn't migrated, because the WebView2 data folder moves to `%LOCALAPPDATA%\OpenNote\webview`. Phase 0 builds were pre-release test builds without an updater.
- Tests cover defaults, round trips that keep unknown keys, corrupt files, newer schemas, and migrations with backups. Property tests feed random JSON to the lenient parser and the merge patch. A kill test stops a writing child process 200 times and requires the old file or the new one each time.
- Revisit when sync arrives, which will need per-field merge rules and the account-versus-device choice BRAND.md section 4 describes.
