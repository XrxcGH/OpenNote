# opennote-diagnostics

The self-check, the beta feedback bundle, and the session record behind safe start: what OpenNote can tell a person about its own health, and what a person can share when something is wrong. All of it keeps private text out. The crate sends nothing.

## Contents

- [What it does](#what-it-does)
- [Public API](#public-api)
- [The self-check](#the-self-check)
- [The feedback bundle](#the-feedback-bundle)
- [Safe start](#safe-start)
- [Privacy rules](#privacy-rules)
- [How the app uses it](#how-the-app-uses-it)
- [Tests](#tests)

## What it does

- `selfcheck::run` answers "is everything in order?" with seven checks, each a status and the numbers behind it. It reads the notebook with the storage core's own check (`verify`), probes the notebook folder with a file it removes at once, and reads the updater's `state.json`. It changes nothing.
- `Bundle::build` collects a text document for a bug report: a description the person writes, a redacted system summary, the self-check, recent log lines, and, only if the person asks, their saved crash reports.
- `Bundle::review` gives the exact text and a digest of it. `Review::save` writes that text to a folder, but only when given the same digest, so the text that is saved is the text that was shown.
- `SessionLog` keeps a small record of how each session ended. After two crashes in a row it says to offer "Start in safe mode". It also counts recent sessions that ended without a crash.

## Public API

| Item | What it is for |
|---|---|
| `selfcheck::run(&Inputs, &dyn DiskProbe) -> SelfCheck` | Runs every check. It never fails: a check that cannot run says why. |
| `SelfCheck::overall`, `item`, `redacted` | The worst status, one check, and a copy without file names, for sharing. |
| `CheckId`, `Status`, `Detail`, `CheckItem` | The result. `Detail` is a tagged union: `freeSpace`, `unavailable`, `writable`, `storage`, `health`, `updates`, `reports`, `notApplicable`. |
| `NotebookProbe` | The open notebook as the check sees it. `NotebookHandle` from the storage core implements it. |
| `DiskProbe`, `SystemDisk`, `FixedDisk` | Free space. `SystemDisk` asks Windows (or the system, elsewhere). |
| `Bundle::build`, `render`, `review`, `section` | Collecting the bundle and rendering its text. |
| `BundleOptions`, `BundleInputs`, `Section`, `SectionId` | What goes in, and the parts. Crash reports are off by default. |
| `Review::text`, `digest`, `suggested_file_name`, `save` | The review step. `save` refuses a digest of anything else and never overwrites a file. |
| `SystemFacts`, `SystemSummary`, `OsFacts`, `NotebookCounts` | The redacted summary of the system. |
| `logs::collect`, `LogExcerpt` | The recent log lines, newest first, scrubbed, within a byte budget. |
| `SessionLog::new(dir)`, `begin`, `enter_safe_mode`, `end_clean`, `stats` | The session record. `begin` returns a `StartReport`. |
| `StartReport`, `PreviousEnd`, `SessionStats` | What start-up learns, and the counts of recent sessions. |

## The self-check

| Check | Looks at | Pass | Warn | Fail |
|---|---|---|---|---|
| `diskNotebook` | Free space where the notebook lives | 500 MiB or more | under 500 MiB | under 50 MiB |
| `diskApp` | Free space for updates and backups | 300 MiB or more | under 300 MiB | under 50 MiB |
| `notebookWritable` | Creating a file in the notebook folder | yes | | no |
| `notebookStorage` | The file system, network shares, sync folders | ordinary | a share, FAT, or a sync folder | |
| `notebookHealth` | `verify` on the open notebook | clean | unsaved changes | any problem, or the check could not run |
| `updates` | `updates\state.json` | ordinary | a rollback, a version stuck on its first starts, or no check in 14 days | |
| `crashReports` | Saved crash reports | the count | | |

A check with nothing to look at is `skipped`. Free-space limits are constants in `selfcheck.rs`. The updater's file can be written by any program, so every string read from it is checked field by field before it is repeated.

## The feedback bundle

The document starts with what it contains and how many things were removed from each part, then holds each part under a heading. A `SystemSummary` has at most 14 lines: the versions of OpenNote, Windows, and WebView2, the processor, the memory, the language, the display scale, the theme, the enabled feature flags, and counts of notebooks, sections, and pages. Log lines are cut to 400 characters and 256 KB in all. At most 3 crash reports are included, the newest first.

## Safe start

The app calls `SessionLog::begin` once, after it has made sure it is the only copy running, and `SessionLog::end_clean` when the person quits. A session that began and never ended cleanly is counted as a crash, whether the cause was a crash, a power cut, or the task being ended. The record is `sessions.json` in the local data folder.

- **The offer.** `StartReport::offer_safe_mode` is true after `SAFE_START_AFTER` (two) such sessions in a row. A clean end resets the count, in safe mode or not. The offer stays until then, so a third crash offers it again.
- **Safe mode.** When the person accepts, the app calls `enter_safe_mode` and turns off background work, embeds, and on-device models for the session. `previous_was_safe` tells the next start that safe mode did not help, and the dialog then points to the feedback file.
- **What the file holds.** Counts, times, and the last 50 endings (`clean` or `crashed`). No path, name, or text. It works with crash reports turned off, because it never leaves the computer.
- **Bad files.** A missing, damaged, or hand-edited file reads as a first start, with counts held to their limits, so it can never keep the app from opening. Writes go through a temporary file, so a crash while writing leaves the old record whole.
- **The beta figure.** `stats` gives the newest 50 endings as counts, for the line "9 of the last 10 sessions ended without a crash".

## Privacy rules

- Every value and every log line passes through the crash report `Scrubber`. A count of what it removed travels with each part, so the person can see the scrub worked without seeing what it took out.
- The self-check holds codes, counts, versions, and kinds of error. Problem file names appear only on the screen, relative to the notebook, and `SelfCheck::redacted` drops them for the bundle.
- The person's own description is theirs. It is kept as written, apart from control characters and a limit of 2,000 characters, and the screen says so.
- The bundle is built on this computer and shown in full. The crate has no network code, and the person attaches the saved file themselves.

## How the app uses it

The app's `hardening` module (`app/src-tauri/src/hardening`) does all of this:

- It calls `SessionLog::begin` early in `run`, after the instance lock, and `end_clean` when the app exits. Its commands `diagnostics_startup` and `diagnostics_enter_safe_mode` wrap the session record, and `hardening::safe_mode()` is the one value that features safe mode turns off should read.
- It keeps one `Review` between `diagnostics_build_feedback` and `diagnostics_save_feedback`. The save command opens the folder picker itself and returns only the file name.
- `diagnostics_self_check` passes the `NotebookHandle` of the notebook the core bridge opened, the app's folders, and the crash store.
- The system summary takes the versions and counts from the app and the theme, density, scale, and flags from the interface.
- The self-check screen and the feedback dialog are in `app/src/features/diagnostics`.

## Tests

`cargo test -p opennote-diagnostics` runs the unit tests, including a real storage core that makes a notebook, finds a damaged section file with its own check, and keeps the notebook's names out of the shared copy. `tests/contract.rs` checks the JSON in `tests/fixtures`, which the interface's contract test reads too. To rewrite the fixtures after a deliberate change, run it with `OPENNOTE_UPDATE_FIXTURES=1`.
