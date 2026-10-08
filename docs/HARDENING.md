# Hardening

This guide covers the tools that keep OpenNote from losing work and help fix what goes wrong: the nightly tests, opt-in crash reports, the self-check, the feedback file, and safe start. It ends with the two test tools that later phases fill. The plan behind them is in [section 8 of the development plan](DEVELOPMENT.md#8-continuous-integration-and-releases) and in Phase 13.

## Contents

- [The nightly tests](#the-nightly-tests)
- [Running a nightly test yourself](#running-a-nightly-test-yourself)
- [When a nightly test fails](#when-a-nightly-test-fails)
- [Crash reports](#crash-reports)
- [What a crash report holds](#what-a-crash-report-holds)
- [How a report is sent](#how-a-report-is-sent)
- [Connecting crash reports to the app](#connecting-crash-reports-to-the-app)
- [The self-check](#the-self-check)
- [The feedback file](#the-feedback-file)
- [Safe start after crashes](#safe-start-after-crashes)
- [Screenshot matrix and component gallery](#screenshot-matrix-and-component-gallery)

## The nightly tests

The [nightly workflow](../.github/workflows/nightly.yml) runs every night on the main branch. You can also start it by hand from the Actions tab and change the sizes below. Each job runs on its own runner, so one failure never hides another.

| Job | What it runs | Default size |
|---|---|---|
| `fuzz` | One cargo-fuzz job for each file in `crates/core/fuzz/fuzz_targets` | 30 minutes each |
| `kill` | The kill harness in `tests/crash`, which stops a writer during saves and checks every page | 1,000 kills |
| `proptest` | All tests of `opennote-core`, with more random cases | 10,000 cases |
| `perf` | The benchmarks in `tests/perf/core`, with their budget check | A 1,000-page notebook |
| `soak` | A scripted person edits one long note at random in the web build (`tests/soak`) and the job holds memory, nodes, and typing time flat | 120 minutes |
| `nvda` | NVDA, driven by Guidepup, walks the keyboard and screen reader checklist in `tests/nvda` on Windows and records what it said | 6 checks |

The fuzz corpus is kept in the Actions cache, so each night starts from the inputs found the night before. A crashing input is uploaded with the run.

The soak types, deletes, undoes, formats, moves, scrolls, and switches pages for the whole time. Every minute it forces a garbage collection and reads the heap, the nodes, and the listeners, and it times a fixed burst of keys. It fails when memory or nodes grow by half from the first quarter to the last, when typing slows by half, or when the page crashes or throws. The seed is the run number. The samples are kept for 90 days, with the table in the run summary.

The NVDA job installs Guidepup and NVDA on the runner. It checks the phrases NVDA says, not its exact words: the names and roles the app sets, such as the notebook tree and the page text box. Each run keeps the table and everything NVDA said for 90 days. Add an item in `tests/nvda/checklist.ts`.

The performance job runs on a hosted runner. It catches large regressions. The budgets in BRAND.md still count only when they pass on the reference laptop.

## Running a nightly test yourself

Run these from the repository root. Fuzzing needs a nightly Rust toolchain and `cargo install cargo-fuzz`.

```sh
# One fuzz target for ten minutes, from the core crate
cd crates/core && cargo +nightly fuzz run segment -- -max_total_time=600

# The kill harness with the seed from a failed run
cargo run -p opennote-crashtest -- run --notebook ./kill-notebook --iterations 1000 --seed 123456

# Property tests with many cases. A failing case prints its seed.
PROPTEST_CASES=10000 cargo test -p opennote-core --all-features

# The benchmarks and their budget check
cargo run --release -p opennote-perf -- bench all --pages 1000 ./perf-scratch

# The soak for five minutes, with the seed from a failed run
OPENNOTE_SOAK_MINUTES=5 OPENNOTE_SOAK_SEED=123456 npm run soak

# The NVDA checklist, on Windows with NVDA set up by `npx @guidepup/setup setup`
npm install --no-save --no-package-lock @guidepup/guidepup@0.35.0
OPENNOTE_NVDA=1 npm run nvda
```

To replay a crash that fuzzing found, download the `fuzz-crash-<target>` artifact and run `cargo +nightly fuzz run <target> <file>`. Once the bug is fixed, copy the file to `crates/core/fuzz/regressions/<target>`. Every pull request replays that folder with stable Rust, so the bug can't return.

## When a nightly test fails

The last job of the workflow opens an issue labeled `nightly-failure`. If one is already open, it adds a comment with the run link instead. It lists the failed jobs, and the seed for the kill harness, which is the run number.

Fix the cause, and add a test that failed before the fix. Close the issue when a nightly run passes. The workflow never closes an issue itself.

That job is the only one that can write, and it can only write issues. It never checks out the code, and no job in the workflow uses a secret.

## Crash reports

The `opennote-crashreport` crate in `crates/crashreport` saves a report when the app crashes, and lets the person decide what happens to it. Three rules shape it:

- **Off until the person turns it on.** The handlers are installed at start-up but save nothing until `Settings::enabled` is true.
- **Saved on this computer only.** Reports go to `%LOCALAPPDATA%\OpenNote\crashes`. Saving never sends anything.
- **Sent only after review.** A report leaves the computer only if an address is set, and only after the person has read it and agreed.

## What a crash report holds

A report holds the app version, the Windows build, the time, the exception code, and the stack as function names and as module and offset pairs. Offsets need OpenNote's matching debug symbols to mean anything, so they say nothing about the person.

A report never holds note content, file names, folder names, or the names of the person or the computer. Two layers keep it that way, and each works without the other:

1. **Nothing private goes in.** A panic message is kept only when it is a string literal in the program. Messages built at run time, which can hold a page title or a line of text, are dropped. A backtrace has no values in it, only code positions.
2. **Everything that goes in is scrubbed.** The scrubber replaces quoted text, paths, web links, email addresses, the user name, the computer name, and any name the app registers as private. Source paths shrink to a Rust file name and line. A report is scrubbed when it is built, and again each time it is loaded, so an edited or older file is checked before it is shown or sent.

The tests in the crate prove this. They use real panics that carry note text in every form, random titles and folders, and a real access violation in a child process.

## How a report is sent

The crate has no network code. The app gives it a `Transport`, and the address comes from `Settings::endpoint`, which is empty by default.

1. `prepare` reads one report, scrubs it, and returns the exact text that would be sent. It fails if no address is set. The address must start with `https://`, or with `http://` for a collector on the same computer.
2. The interface shows that text, and asks the person whether to send it.
3. If they agree, the interface passes back the digest of the text it showed. `agree` accepts only the digest of the text that would be sent.
4. `send` needs the agreement. It sends the text that was shown, even if the file changed since.

## Connecting crash reports to the app

The app's `hardening` module (`app/src-tauri/src/hardening`) connects the crate:

- `Hardening::start` installs the hooks first thing in `run`, so a crash while the rest starts is saved too, once the person has said yes. It also records that a session began.
- The decision, the address, and Work offline are in `privacy.json` in the local data folder. A missing or damaged file reads as no consent and online. The address is empty by default, so nothing can be sent until someone sets it in that file.
- `HttpTransport` is the only place a report can leave the computer. It runs from `crash_send`, after the digest of the text the person read matches, and never while Work offline is on.
- The notebook's name is registered with the scrubber when the self-check or the feedback file first opens the notebook.
- The screens are in `app/src/features/diagnostics`.

## The self-check

"Check OpenNote" answers one question: is everything in order? It changes nothing. It runs seven checks:

- Free space for the notebook, and for updates.
- Whether the notebook folder can be written.
- Where the notebook lives, since a network share or a sync folder can cause trouble.
- The notebook itself, through the storage core's own `verify`.
- The updater's state.
- The saved crash reports.

A check that cannot run says why instead of failing the rest. The limits and the rules for each check are in [the crate's README](../crates/diagnostics/README.md#the-self-check). The screen is in [SCREENS.md](design/SCREENS.md#check-opennote).

## The feedback file

In the beta, "Send feedback" builds one text file that the person reads in full and then saves. It holds what they wrote, a short system summary, the self-check, recent log lines, and, only if they choose, their saved crash reports. Every part is scrubbed the same way as a crash report, with a count of what was removed, and the person sees the exact text before it is saved. OpenNote does not send the file. The person attaches it to a report or an email. See [the crate's README](../crates/diagnostics/README.md#the-feedback-bundle).

## Safe start after crashes

OpenNote keeps a small record of how each session ended: counts and times, with no paths and no text. After two sessions in a row that did not end cleanly, the next start offers "Start in safe mode", which turns off background work, embeds, and on-device models. The person can always start normally. A session that ends cleanly, in safe mode or not, resets the count. The same record gives the beta its local figure for sessions that ended without a crash, the number behind the Phase 13 goal of 99.5%. It works with crash reports turned off, because it never leaves the computer. See [the crate's README](../crates/diagnostics/README.md#safe-start).

## Screenshot matrix and component gallery

Two test tools are in place for the phases that build screens, and both start empty.

- The **screenshot matrix** takes every screen state that a package lists in `tests/ui/screens` at four window sizes and in both themes. Run `npm run test:matrix` to check its plan. See [the interface tests README](../tests/ui/README.md).
- The **component gallery** is a test-build page that shows each component state at its own address, and axe checks every entry on the day it is added. Run `npm run app:gallery` to see it. See [the gallery README](../app/src/dev/gallery/README.md).

Baselines for pictures come only from the update-screenshots workflow, so a picture without one is skipped and says so.
