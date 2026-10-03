# ADR 0011: Self-updater and where the app lives

- Status: Proposed
- Date: 2026-09-30

## Context

DEVELOPMENT.md section 9 says OpenNote ships as one exe per Windows architecture (`OpenNote_Windows64.exe`, `OpenNote_Windows32.exe`, and `OpenNote_WindowsARM64.exe`), updates itself from GitHub Releases, verifies each update's SHA-256 and minisign signature, keeps the previous version, and rolls back after two failed starts. Tauri's official updater expects an installer. The `release-naming` branch already builds the three exes and writes a manifest in Tauri's multi-platform format.

The updater is security-critical and must never leave the person without a working app. `%LOCALAPPDATA%` is writable by any program the person runs, so files there can be tampered with. The app may run from a folder it can't write to, or from another drive than `%LOCALAPPDATA%`. The first-run setup asks where to keep the app, and moving it must need no administrator rights.

## Decision

We will write the updater as a Tauri-free Rust crate, `crates/updater`, driven by a scheduler thread in the shell. It will:

- read manifest v2 (`platforms` map with `url`, `signature`, `size`, and `sha256` per platform key), with one table of platform keys, Rust targets, and file names in `app/release-files.json` shared by the release scripts, the workflow test, and the crate;
- fetch over HTTPS only with `ureq` 3.4.2 (`native-tls-no-default`, `win-system-proxy`), which uses Windows SChannel and the Windows certificate store, on a background-priority thread;
- verify the size, the SHA-256, the minisign signature with `minisign-verify` 0.3.0 against a list of built-in public keys (an active key and an offline backup), and the signed trusted comment's `version` and `file` fields against the manifest version and this architecture's release file name;
- keep the previous version as a hashed copy in `%LOCALAPPDATA%\OpenNote\previous\`, copy the staged update next to the exe before calling `self-replace` 1.5.0, and put the previous copy back if the swap fails after the running exe was renamed;
- apply only through the exit handshake (architecture decision record, or ADR, 0015), never with unsaved changes, a recording, or during Windows shutdown;
- count each start of a new version in a start guard that runs after the instance lock and before Tauri. A start is healthy 5 s after the last page is ready, or at a normal close after that. After two failed starts, the next launch checks the previous copy's hash and rolls back;
- read stable updates from `releases/latest/download/latest.json`, and beta updates from a fixed `channel-manifests` prerelease that is never marked latest (the beta control stays hidden until Phase 13).

Test endpoints (plain HTTP to 127.0.0.1) and the test key exist only behind the `test-endpoints` Cargo feature. Tests sign in memory or with a key generated in the CI job; no private key is ever committed. The release build job fails if an exe contains the test-endpoints marker or any public key other than the committed production keys. The release `upgrade-test` job updates each of the last three releases to the candidate by staging the signed file where a download would put it, so released builds need no manifest override.

Setup's "Add OpenNote to the Start menu" copies the exe to `%LOCALAPPDATA%\Programs\OpenNote\OpenNote.exe`, creates a Start menu shortcut with the app user model ID `org.opennote.app`, relaunches with `--wait-pid`, and deletes the downloaded copy. OpenNote never adds or removes Mark of the Web (`Zone.Identifier`); the copy keeps what the download had, and code signing, required before beta, prevents repeated SmartScreen warnings.

## Options considered

| Option | For | Against |
|---|---|---|
| Custom crate with `ureq`, `minisign-verify`, and `self-replace` (chosen) | Fits the single-exe model; small and testable with fakes; 18 new crates on Windows, 12 of them from `ureq` | We own security-critical code; `win-system-proxy` doesn't evaluate proxy auto-configuration scripts |
| The same with `reqwest` 0.13 | Well known; async-capable | Tauri 2.12 compiles `reqwest` only for Android and iOS (`cargo tree -i reqwest` for the Windows target prints nothing), so it would add about 30 crates, including `hyper`, `tower`, and `mio` |
| WinHTTP through the `windows` crate | No new crates; full proxy support | Unsafe code and a Windows-only fetcher; kept as the fallback behind the `Fetch` trait if proxy reports come in |
| `tauri-plugin-updater` | Official | Expects an installer, not a self-replacing exe; pulls in `reqwest`, `zip`, and more |
| A watchdog process that relaunches failed starts | Also catches crashes before `main` | Held the single-instance lock while the new exe started, so every restart could look like a failed start; deferred, with constraints, to Phase 13 |
| Removing `Zone.Identifier` when moving the exe | No second SmartScreen prompt for unsigned builds | Weakens SmartScreen and can trip antivirus heuristics |
| A manifest URL override in release builds, for upgrade tests | Simple tests | Extra attack surface in every shipped build |

## Consequences

- Easier: every update is verified against the exact version and architecture; a failed swap never leaves the app path empty; a bad release rolls back without the person doing anything; key rotation works without the leaked key.
- Harder: the owner must create and store the offline backup key before the first beta; the release workflow gains `sign`, `upgrade-test`, and `publish` jobs; the updater state file becomes a contract that older versions must read.
- A build that crashes before `main` can't count its own starts; the release `upgrade-test` job and the previous copy at a known path cover it for now.
- Follow-up work: the signature-format fixture from the pinned `@tauri-apps/cli`, the real-swap integration test on every pull request, the documentation changes in DEVELOPMENT.md section 9 and docs/RELEASING.md, and the release exe check.
- Revisit if an installer or the Microsoft Store becomes the main channel, if proxy reports show that proxy auto-configuration matters, or if differential updates become necessary. The release owner checks at each beta.
