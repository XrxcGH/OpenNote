# opennote-crashreport

Opt-in crash reports that never hold note content. The crate saves a report on this computer when OpenNote crashes, shows the person what is in it, and lets them send it only after they have read it and agreed. It has no network code.

For the rules behind it, read [the hardening guide](../../docs/HARDENING.md). This page is the module reference.

## Contents

- [What it does](#what-it-does)
- [Public API](#public-api)
- [The report format](#the-report-format)
- [Consent](#consent)
- [Scrubbing](#scrubbing)
- [Symbols](#symbols)
- [How the app uses it](#how-the-app-uses-it)
- [Tests](#tests)

## What it does

1. `install` sets a panic hook and, on Windows, a handler for exceptions that nothing handled. Both do nothing until the person has said yes (`Settings::saving_allowed`).
2. When the app crashes, the hooks build a `Report`: the versions, the time, the exception code, the stack as module offsets, and the build each module came from. Every piece of text passes through the `Scrubber`.
3. `CrashStore` saves the report in `%LOCALAPPDATA%\OpenNote\crashes`. The file is written to a temporary name and renamed, so a crash while saving leaves no half-written report. At most 20 reports are kept, and a run saves at most 3.
4. The interface lists, shows, and deletes reports. To send one, it calls `prepare`, shows the exact text, and passes the digest of that text back through `PendingSend::agree` and `send`. The app supplies the `Transport`.
5. A maintainer, or a person with symbol files, turns offsets into function names with `SymbolSet` or the `opennote-symbolicate` tool.

## Public API

| Item | What it is for |
|---|---|
| `install(Config)`, `apply(&Settings)`, `set_enabled`, `is_enabled`, `add_private`, `store` | Start the hooks once, then follow the person's settings. `add_private` registers the open notebook's name so the scrubber removes it. |
| `Settings { enabled, consent, endpoint }` | The stored settings. `saving_allowed()` is true only while the switch is on and the person said yes to the current wording. `Settings::opted_in` builds one for tests. |
| `Consent`, `Decision`, `Prompt`, `WORDING_VERSION` | The person's decision and the wording they saw. `Consent::prompt()` says whether to show the consent screen. |
| `Report`, `Frame`, `Kind`, `FORMAT`, `Report::example` | The report as saved, shown, and sent. `example` builds a made-up report for the consent screen. |
| `CrashStore` | `standard`, `save`, `list`, `load`, `replace`, `delete`, `delete_all`, `sweep`, `symbols_dir`, `symbolicate_all`. |
| `prepare`, `PendingSend`, `Agreement`, `send`, `Transport`, `SendError` | The only way a report reaches the network. |
| `Scrubber`, `Redactions` | Removing private text, and counting what was removed. |
| `SymbolTable`, `SymbolSet`, `Symbolicated`, `pe::debug_id` | Build ids and symbols. |
| `os_description` | The Windows version and build, such as `Windows 10.0.26200 x86_64`. |

## The report format

A report is JSON with snake_case names, written by `Report::to_json`. `FORMAT` is 1. New fields are added with defaults, so older files still load, and a file written by this version loads in an older one with the new fields ignored.

Each frame holds `module` (a file name, never a folder), `offset` (hexadecimal), and, when known, `debug_id` (the build of the module) and `function` (added by symbolication). A report never holds a path, a note, a title, or a name. Two layers keep it that way, and each works without the other:

1. Nothing private goes in. A panic message is kept only when it is a string literal in the program, and a backtrace has no values in it.
2. Everything that goes in is scrubbed, when the report is built and again each time it is loaded.

## Consent

`Consent` stores `decision` (`unasked`, `declined`, or `accepted`), the `wording_version` the person saw, and when they decided. A yes counts only for `WORDING_VERSION`. Raise the constant whenever a report starts to hold anything new, and every earlier yes stops counting. A damaged or newer decision reads as `unasked`, never as a yes. The matching rules in TypeScript are in `app/src/features/diagnostics/consent.ts`, and a test keeps the two versions equal.

## Scrubbing

`Scrubber::text` removes, from any line of text:

- paths of every shape Windows uses, such as `%USERPROFILE%\...` and `notebooks\a.json`, and Unix paths. Paths go first, so a mark inside one doesn't cut it short.
- quoted text in straight, curly, French, German, Nordic, and Japanese quote marks. Single quotes count where they can't be an apostrophe. Backticks count unless they hold code such as `Option::unwrap()`. A quote runs from its first mark to its last, so a stray mark can't swap what is inside and outside.
- web links and email addresses
- GUIDs, account SIDs, MAC addresses, and IPv4 and IPv6 addresses
- the value after a word that names a secret, as in `password=...` or `Authorization: Bearer ...`
- long key-like strings, and JSON Web Tokens
- the person's and the computer's names, and every name registered with `add_private`

`Scrubber::source`, `symbol`, and `module` reduce a source location, a function name, and a module to the few forms that can only hold code. `Redactions::count` counts the placeholders in scrubbed text. Scrubbing twice changes nothing.

## Symbols

A release exe has no function names, so a report holds offsets. Each frame also holds the debug id of its module (the GUID and age in its debug information). A symbol table in Breakpad text format, which `dump_syms` writes from a `.pdb`, has the same id, so a report is matched only to symbols of the build that crashed. See `src/symbols.rs` for the format.

```text
opennote-symbolicate crash.json symbols/ > crash-named.json
```

The release workflow keeps the `.pdb` of every build. The app never downloads symbols. A person who has put a `.sym` file in `%LOCALAPPDATA%\OpenNote\symbols` can have `CrashStore::symbolicate_all` name their saved reports in place.

## How the app uses it

The app's `hardening` module (`app/src-tauri/src/hardening`) does all of this:

- It calls `install` first thing in `run`, with the app version and a `CrashStore` in the local data folder, and sweeps the store once at start-up.
- It keeps `Settings` in `privacy.json` and calls `apply` whenever the decision changes. The address is empty until someone sets it in that file.
- Its commands are `crash_consent_get`, `crash_consent_set`, `crash_example`, `crash_list`, `crash_prepare`, `crash_send`, `crash_delete`, and `crash_delete_all`.
- `HttpTransport` is the `Transport`. It refuses while Work offline is on.
- It calls `add_private` with the open notebook's name when the self-check or the feedback file first opens the notebook.
- The consent screen, the list, and the review dialog are in `app/src/features/diagnostics`.

## Tests

`cargo test -p opennote-crashreport` runs the unit tests, the generated-text property tests for the scrubber, a real access violation in a child process, a real panic hook, and the `opennote-symbolicate` tool on real files. `tests/contract.rs` checks the JSON in `tests/fixtures`, which the interface's contract test reads too. To rewrite the fixtures after a deliberate change, run it with `OPENNOTE_UPDATE_FIXTURES=1`.
