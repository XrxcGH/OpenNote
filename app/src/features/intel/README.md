# On-device intelligence in the interface

How the Rust crate `opennote-intel` reaches the screen: OCR, handwriting recognition, read aloud, and summaries. Everything runs on this device, and every feature is off until the person turns it on. The [crate README](../../../../crates/intel/README.md) explains the engines, and the [client README](../../services/intel/README.md) explains the typed client.

## Contents

- [What the person gets](#what-the-person-gets)
- [Where things are](#where-things-are)
- [Opt-in](#opt-in)
- [Flags](#flags)
- [Missing pieces](#missing-pieces)
- [Seams for other parts of the app](#seams-for-other-parts-of-the-app)
- [Tests](#tests)

## What the person gets

| Feature       | Where it shows                                                                                          | Needs                                                |
| ------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Settings      | Settings, then On-device intelligence: a switch for each feature, what it does, and what it still needs | Nothing                                              |
| Text in image | A Copy text button on a selected image, the command palette, and the image's menu                       | A Windows text recognition language                  |
| Read aloud    | The page's existing read aloud (Ctrl+Shift+U) speaks with the Windows voices when the switch is on      | A Windows voice                                      |
| Summaries     | The Summarize this page command: key sentences that go to their place on the page, and keywords         | Nothing                                              |
| Handwriting   | The Convert handwriting to text command for selected strokes, which adds the words below the page       | A Windows handwriting recognizer, and the pen layer  |
| Search        | `searchTextInImage` and `searchTextInInk`, for the index to call                                        | The switch for the kind of text, and the search flag |

## Where things are

- `app/src-tauri/src/intel/` has the Tauri commands. Each goes through `Engines`, which refuses a feature that is off. The choices are saved in `intel.json` in this device's folder.
- `app/src/platform/intel.ts` picks the transport at build time: the Tauri commands, or the fake with the choices kept in the browser, for the web platform.
- `choices.ts` holds what the person has chosen. `runtime.ts` has the client, saving a choice, the offer to turn a feature on, and the messages for a missing pack or voice.
- `SettingsSection.tsx` is the Settings section. `summary.ts` and `SummaryDialog.tsx` are the summary. `imageText.ts` turns an image file into gray pixels. `ink.ts` and `search.ts` are the seams below. `speechEngine.ts` is the read-aloud engine.
- `index.ts` is the only file other features import. It stays small, because the page's read-aloud chunk imports it. `loadApi()` loads everything else on demand.
- `app/src/features/page/intel/` has what needs the page's own parts: the three commands and their registration. `registrations/intel.ts` registers the Settings section at start-up and the commands once start-up is done, so they add almost nothing to the start-up bundle.

## Opt-in

A feature that is off is never run. A command first calls `askToTurnOn`, which asks in a dialog and says it runs on this device. The Rust crate refuses a feature that is off as well, so a bug here cannot run one. Background work, such as the search seam, never asks: it gets `null` for a feature that is off.

Read aloud keeps the browser's voices while its switch is off. With it on, the page's reader asks `intelSpeechEngine()` when reading starts and speaks with the Windows voices and the word times from the crate.

## Flags

| Flag                | What it gates                                     | Default                  |
| ------------------- | ------------------------------------------------- | ------------------------ |
| `intel.ocr`         | Copy text from image, in all its places           | On                       |
| `intel.readAloud`   | The on-device engine for read aloud               | On                       |
| `intel.summaries`   | Summarize this page                               | On                       |
| `intel.handwriting` | Convert handwriting to text, and its Settings row | Off, until the pen layer |
| `intel.searchText`  | The seam for search                               | Development and nightly  |

## Missing pieces

- No language pack for text recognition: the Settings row says so, and the Copy text command shows a message with a button for the Windows language settings.
- No handwriting recognizer: the same, for handwriting.
- No voice: the Settings row says so, and the read-aloud bar says so and opens the Windows speech settings.

## Seams for other parts of the app

- The pen layer calls `registerInkStrokeSource({ strokes(ids) })` once it can turn stroke IDs into points, with each stroke's own transform applied. Then it turns on the `intel.handwriting` flag.
- Search calls `searchTextInImage(blob)` and `searchTextInInk(strokes)`. Each returns the text with a box for every word, or `null` when the feature is off, the flag is off, or the computer lacks what it needs. Neither asks the person anything.

## Tests

- `*.test.ts` run in Node with the fake transport: the choices, the image helpers, summaries, the speech engine, handwriting, and the search seam.
- `*.test.tsx` run in the browser: the Settings section and the two dialogs, with axe.
- `tests/ui/behavior/intel-*.spec.ts` run the web platform end to end: Settings, copying text from an image, summaries, and read aloud.
- `app/src-tauri/src/intel/tests.rs` covers the commands: the choices, the refusal of a feature that is off, and the errors the interface receives.
