# Diagnostics

The crash report, self-check, feedback, and safe start screens and the models under them. The models are plain functions and reducers. The screens are React components that load on first use, so none of them costs start-up time.

The Rust side is in [`crates/crashreport`](../../../../crates/crashreport/README.md) and [`crates/diagnostics`](../../../../crates/diagnostics/README.md). The screens are specified in [docs/design/SCREENS.md](../../../../docs/design/SCREENS.md) under Crash reports, Check OpenNote, and Send feedback.

## Contents

- [What it does](#what-it-does)
- [Public API](#public-api)
- [The rules the models keep](#the-rules-the-models-keep)
- [How it is wired](#how-it-is-wired)
- [Tests](#tests)

## What it does

- `consent.ts` decides when the consent screen shows (`prompt`), what a yes or a no stores (`accepted`, `declined`), and the screen's own states (`openConsent`, `reduceConsent`).
- `crashReview.ts` lists saved crash reports (`crashRows`) and steps from reading one to sending it (`reduceReview`).
- `selfCheck.ts` turns the Rust self-check into a headline and one row per check, in plain sentences (`selfCheckView`).
- `feedback.ts` holds the feedback form, the review, and the steps to a saved file (`reduceFeedback`), and says what each part holds and how much was removed (`sectionRows`, `removedLine`).
- `safeStart.ts` turns the Rust session record into the safe start offer (`openSafeStart`, `reduceSafeStart`), the notice shown while safe mode is on (`safeModeNotice`), and the line that counts recent sessions (`sessionStatsLine`).
- `client.ts` is the contract for the host: the `DiagnosticsClient` interface the Tauri commands will implement. `fake.ts` implements it in memory for the web platform, component tests, and Playwright.
- `types.ts` holds the JSON shapes. `contract.test.ts` reads fixtures that the Rust tests check, so the two sides cannot drift apart unnoticed.
- The text is in `app/src/strings/en/diagnostics.ts`.

## Public API

Everything is exported from `index.ts`.

| Name | Kind | Use |
|---|---|---|
| `prompt(consent)`, `savingAllowed(consent)` | functions | Show the consent screen at start-up when `prompt` is not `none`. Turn crash reports on only when `savingAllowed`. |
| `openConsent(reason)`, `reduceConsent(flow, event)` | reducer | The consent screen. `result` holds the `Consent` to store when `closed`. |
| `reduceReview(state, event)`, `canSend`, `sendRequest` | reducer | Review a report, then send the digest of the text that was shown. |
| `crashRows`, `crashListSummary`, `refusalMessage` | functions | The list and the messages for a refusal. |
| `selfCheckView(check)`, `formatBytes` | functions | The self-check screen's rows. |
| `openFeedback`, `reduceFeedback`, `canSave`, `saveRequest` | reducer | The feedback form, review, and save. |
| `sectionRows`, `removedLine` | functions | The review's list of parts and what was removed. |
| `openSafeStart(report)`, `reduceSafeStart`, `safeStartText`, `safeStartAnnouncement` | functions | At start-up, call `DiagnosticsClient.startup`. If `openSafeStart` returns a flow, show the offer. `result` holds `safe` or `normal` when `closed`. |
| `safeModeNotice(safeMode)`, `sessionStatsLine(stats)` | functions | The notice while safe mode is on, and the count of recent sessions for the self-check and Privacy panel. |
| `DiagnosticsClient`, `DiagnosticsError` | interface, class | What the host provides. Errors carry a code, never a message that could hold private text. |
| `createFakeDiagnostics` | function | The in-memory host. It follows the same rules as the Rust side. |

## The rules the models keep

- A report can be sent only from a state where its full text was shown, and the host gets the digest of that text. A send in progress cannot be closed away.
- A file can be saved only from the review step, with the digest of the text that was shown.
- A no is stored, so the consent screen does not nag. Escape on a screen that opened by itself is a no. Closing the screen from Settings changes nothing.
- A yes to older wording stops counting (`WORDING_VERSION`), and the screen asks again.
- Crash reports are not in the feedback file unless the person chooses them.
- Safe mode is offered, never forced. Escape is "Start normally". The offer needs the host to say so (two crashes in a row), and a choice is final.
- Every status shows as words as well as an icon, so color is never the only signal.

## How it is wired

- **Host.** `DiagnosticsClient` is on the platform seam as `platform.diagnostics`. `platform/tauri/diagnostics.ts` calls the commands in `app/src-tauri/src/hardening`, and `platform/web/diagnostics.ts` is the in-memory fake. The web fake takes its start from the address: `?crashes=2` offers safe mode, `?consent=accepted` turns crash reports on with two saved reports, and `?offline` starts with Work offline on.
- **Flags.** `flags.ts` defines six, all on in every channel: `privacy.panel`, `privacy.workOffline`, `diagnostics.crashReports`, `diagnostics.selfCheck`, `diagnostics.feedback`, and `diagnostics.safeStart`.
- **Settings.** `register.ts` adds the Privacy section (`PrivacySection.tsx`) and the Help section (`HelpSection.tsx`). Privacy lists each kind of network use and when it last ran, the Work offline switch, the crash report switch, and the saved reports. A later phase that adds a kind of network use adds a row to the list in `PrivacySection.tsx`, and reads `isOffline()` before it makes a request.
- **Commands.** "Check OpenNote", "Send feedback", "Privacy settings", and "Work offline" are in the palette.
- **Dialogs.** `dialogs.tsx` mounts the consent screen, the report review, Send feedback, and the safe start offer. `openers.ts` is the way in, and loads `dialogs.tsx` on first use.
- **Start-up.** `app/start.ts` calls `offerSafeStart` after the commands are configured and before the first screen renders, and `installDiagnostics` with the other installers. On the beta channel, `installDiagnostics` shows the consent screen once, after setup, to a person who was never asked or who answered under older wording.
- **Safe mode.** `isSafeMode()` and `useSafeMode()` are the one value that every feature that safe mode turns off should read. The Rust side has the same value as `hardening::safe_mode()`.
- **Title bar.** `StatusChips.tsx` says "Working offline" and "OpenNote is in safe mode" in words, and each opens a short explanation with the way out.
- **Screens.** `tests/ui/screens/hardening.ts` lists each screen state for axe and the screenshot matrix.

## Tests

`npm run app:test` runs the unit tests in this folder: the reducers, the sentences, the fake host, and the contract test. `npm run test:components` runs `screens.test.tsx`, which drives each screen on the fake host. `tests/ui/behavior` has one Playwright spec for each feature: `privacy`, `help`, `feedback`, and `safe-start`. A test reads `crates/crashreport/src/consent.rs` to keep `WORDING_VERSION` equal on both sides.
