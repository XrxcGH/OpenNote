# On-device intelligence in the interface

How the Rust crate `opennote-intel` reaches the screen: OCR, handwriting recognition, read aloud, and summaries. Everything runs on this device, and every feature is off until the person turns it on. The [crate README](../../../../crates/intel/README.md) explains the engines, and the [client README](../../services/intel/README.md) explains the typed client.

## Contents

- [What the person gets](#what-the-person-gets)
- [Where things are](#where-things-are)
- [Opt-in](#opt-in)
- [Flags](#flags)
- [More on-device parts](#more-on-device-parts)
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
| `intel.handwriting` | Convert handwriting to text, and its Settings row | Development, nightly, and Beta |
| `intel.searchText`  | The seam for search (nothing in search calls it yet) | Development, nightly, and Beta |

The flags for the parts below are in [More on-device parts](#more-on-device-parts).

## More on-device parts

These came after the first set. Each has its own flag, on in development, nightly, and Beta builds, and each stays off in Settings until the person turns it on. Strings are in `strings/en/intelPlus.ts`, and styles in `plus.module.css`.

| Part | Flag | Where | What it does |
| --- | --- | --- | --- |
| Model downloads | `intel.models` | `models/`, `app-tauri/src/intel/models.rs` | Lists the speech models with sizes, asks before a download, resumes, checks the SHA-256, refuses while Work offline or safe mode is on, and lists when one last ran in Privacy |
| Setup step | `setup.smartFeatures` | `setup/` | Recommended, Custom, or Not now (selected in advance), with the model size and the statement that nothing leaves the device |
| Background work | `intel.background` | `background/` | The activity panel and the queue behind it: pause, only when idle or plugged in, only on request, and a cap on the processor |
| Text in new images | `intel.backgroundOcr` | `background/imageText.ts` | Queues new images a page shows, keeps the words on this device, and offers `onImageText` and `getImageText` to search |
| Custom vocabulary | `intel.vocabulary` | `vocabulary/` | One plain-text list for each notebook, the offer to add a fixed word, and a preview of fixes with Undo (`offerVocabularyTerm`, `fixWithVocabulary`) |
| Handwriting extras | `intel.handwritingExtras` | `handwriting/` | Signs, degrees, formulas with subscripts, and a review of unsure words with their other readings |
| Search by meaning | `intel.meaning` | `meaning/` | A vector index beside the text index, Find by meaning, and Related pages. The built-in embedder hashes words, word parts, and a short list of words that mean the same. It sits behind `Embedder`, so a trained model can replace it |
| Ask your notes | `intel.ask` | `ask/` | Answers from the best passages and lists the pages it used. The quoting engine sits behind `AnswerEngine`, so a local language model can replace it |
| Writing tools | `intel.writing` | `writing/`, `page/intel/writing.ts` | Proofread, Rewrite in plain words, Shorten, Make a list, and Tidy structure, as marked suggestions. The rules engine sits behind `WritingEngine` |

The device store and the downloads share one command, `intel_ext_call` (`services/intel/ext.ts`), so a new method adds no permission. Pages of an encrypted section are protected, and nothing of them is kept on this device: `protectedPages.ts` learns which pages they are from the tree (`NodeSummary.encrypted`, at start-up and as the tree changes, and for each page that opens), the meaning index and the words read in images refuse them, and each drops and re-saves its file the moment a page is found protected. A new index or cache of page text registers with `onPagesProtected` and asks `isProtectedPage` before it keeps anything. The feature that encrypts a section can call `setPagesProtected` from the API to drop its pages at once.

## Not built, and why

- **The whisper.cpp engine.** It needs a native build with CMake and a C++ toolchain, which is a heavy new dependency. The model picker, the downloads, and the queue are ready for it: an engine implements `TranscriptionEngine` and the app picks the model chosen in Settings.
- **Dictation and live captions** need that engine for streaming recognition. **Speaker separation** needs a voice model. **Translate on this device** needs a translation model and runtime for each language pack. None of them is useful without its engine, so none is shown.
- **Math from handwriting.** The Windows ink recognizer returns one line of text, and a fraction bar, a root sign, or a matrix comes back as dashes and letters, so the structure is lost. A real result needs the Windows math input control (a COM component that is missing from some Windows builds and needs its own window) or a trained model. Neither fits the crate's allow-listed dependencies. Typed signs, Greek letter names, and powers that the recognizer does return are handled by the handwriting extras.
- **A cloud key choice in setup.** It needs an account and a secret, so Custom offers only features that run on this device.

## Missing pieces

- No language pack for text recognition: the Settings row says so, and the Copy text command shows a message with a button for the Windows language settings.
- No handwriting recognizer: the same, for handwriting.
- No voice: the Settings row says so, and the read-aloud bar says so and opens the Windows speech settings.

## Seams for other parts of the app

- The Convert handwriting to text command (features/page/intel/handwriting.ts) registers the stroke source on first use: the shown page's strokes, each with its own transform applied, from features/page/seams/inkStrokes.ts.
- Search calls `searchTextInImage(blob)` and `searchTextInInk(strokes)`. Each returns the text with a box for every word, or `null` when the feature is off, the flag is off, or the computer lacks what it needs. Neither asks the person anything.

## Tests

- `*.test.ts` run in Node with the fake transport: the choices, the image helpers, summaries, the speech engine, handwriting, and the search seam.
- `*.test.tsx` run in the browser: the Settings section and the two dialogs, with axe.
- `tests/ui/behavior/intel-*.spec.ts` run the web platform end to end: Settings, copying text from an image, summaries, and read aloud.
- `app/src-tauri/src/intel/tests.rs` covers the commands: the choices, the refusal of a feature that is off, and the errors the interface receives.
