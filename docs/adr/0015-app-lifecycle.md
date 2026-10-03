# ADR 0015: App lifecycle: single instance, start-up order, and exit handshake

- Status: Proposed
- Date: 2026-09-30

## Context

Exactly one process may write the settings, the device state, and the exe. A second launch should focus the running window and hand over its arguments. Later phases open files and quick capture this way.

The updater's start guard counts starts of a new version to decide on rollback, so a second launch that only forwards its arguments must never count. Relaunches after an update or a move must not hand their arguments to the process that is exiting.

Every way of closing must save work first. These are the caption button, Alt+F4, the taskbar, restart to update, going back, moving the app, and Windows shutting down. None may apply an update with unsaved changes or during shutdown. End-to-end (E2E) tests run the app with separate profiles and must not collide with each other or with a developer's copy.

`tauri-plugin-single-instance` 2.5.1 keys its lock by the app identifier and runs inside Tauri setup, after the point where the guard must decide.

## Decision

### Start-up order

We will start in this order, in `main.rs`, before Tauri:

1. Parse arguments, and with `--wait-pid <pid>`, wait up to 30 s for that process to exit. Every relaunch passes it.
2. Acquire a named mutex keyed by the profile folder (`Local\OpenNote.<hash>`). If another process owns it, send it our arguments with `WM_COPYDATA` through its message-only window and exit, without reading settings or touching the update state. This follows the plugin's Windows technique in our own `instance.rs`.
3. Run the update start guard.
4. Check the WebView2 Runtime version, then read settings and start Tauri.

### Exit handshake

Every close goes through one exit handshake: Rust holds the close, emits `app://before-exit` with the reason, the front end runs its registered `beforeExit` hooks (flush notes, flush state, and later refuse while recording) and answers `ok` or `blocked`. On `ok`, Rust applies a staged update if the reason and policy allow, flushes its files, and exits. With no answer in 3 s, Rust flushes its own files and exits without applying. During Windows shutdown the front end gets 1 s, and updates never apply.

One handshake runs at a time, and Windows ending the session takes over from a slower one. Before the first paint the front end has nothing to save and isn't listening, so a close then exits at once. A relaunch that Rust planned itself, such as the moved copy of the app, starts even when the answer is late, because it needs nothing from the front end. A refusal cancels it.

### Show strategy

The window shows as soon as it is built, with `surface.app` of the resolved theme as both the window's and WebView2's background color. This is provisional, because the planned one-day spike that samples frames on the Phase 1 harness hasn't run.

If the spike finds a white or wrong-theme frame, `SHOW_EARLY` in `lifecycle.rs` flips to the hidden strategy. That shows the window at `app_first_paint` or after 700 ms, and costs up to the fallback delay, because a hidden WebView2 may not run animation frames. The perf log holds the window's color and the first painted theme, and the `startup.theme` spec checks both against the setting.

## Options considered

| Option | For | Against |
|---|---|---|
| Own per-profile instance lock before the guard, plus the exit handshake (chosen) | Correct guard counting; parallel test profiles; one safe path for every close | About 120 lines of Win32 to own |
| `tauri-plugin-single-instance` with the guard first | Official plugin | Second launches during an update's verification count as failed starts and can roll back a healthy version |
| The plugin plus our own mutex for the guard | Less code | Two locks with different keys; test profiles still collide on the plugin's lock |
| Closing without a handshake, flushing in Rust only | Simpler | Rust can't know whether the interface has unsaved work or a recording |

## Consequences

- Easier: the updater's rollback decision is trustworthy; tests can run several profiles side by side; later phases add exit checks by registering a hook.
- Harder: every relaunch must pass `--wait-pid`; a close can take up to 3 s when the interface hangs.
- Tests cover the order of the early steps (a forwarded launch never runs the guard), two profiles side by side, and forwarded arguments. They also cover the handshake's states: one at a time, refusal, timeout, and session end.
- Until the E2E set grows, a person checks by hand that a hung interface exits after 3 s, and that Alt+F4 and the taskbar run the `beforeExit` hooks.
- Revisit when multi-window support arrives, which will extend the forwarded-arguments handling and the handshake to several windows, and after the frame-sampling spike decides the show strategy.
