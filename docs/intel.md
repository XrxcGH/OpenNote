# On-device intelligence

The `opennote-intel` crate in `crates/intel` holds the Phase 12 engines: optical character recognition (OCR) for images, handwriting, read aloud, summaries, and speech. Everything runs on the device. The crate has no network client, and a test fails if one appears.

The crate takes plain data in and gives plain data out. It does not depend on the note model, so the app's wiring layer converts between the two. The crate's [README](../crates/intel/README.md) lists each module's API and what the interface wiring needs.

## Contents

- [Privacy and opt-in](#privacy-and-opt-in)
- [Text in images](#text-in-images)
- [Handwriting](#handwriting)
- [Read aloud](#read-aloud)
- [Summaries and keywords](#summaries-and-keywords)
- [Tasks and chapters](#tasks-and-chapters)
- [Tidying handwriting](#tidying-handwriting)
- [Custom vocabulary](#custom-vocabulary)
- [Transcription](#transcription)
- [Test engines and recordings](#test-engines-and-recordings)
- [The interface client](#the-interface-client)
- [Tests](#tests)
- [Checks to run by hand](#checks-to-run-by-hand)
- [Left for the UI stage](#left-for-the-ui-stage)

## Privacy and opt-in

Nothing leaves the device. The crate links no network client and turns on no networking part of the Windows API. It holds no URL, and it never stores or logs what it is given.

Every feature is off until the person turns it on, in first-run setup or in Settings. The `Engines` type is the one place the app asks for an engine.

- Each of its accessors fails with `Disabled` unless `IntelSettings` has that feature on. A setting missing from a settings file reads as off.
- The engines it hands out check the setting again on every call. Turning a feature off stops them, a page being read aloud, and the transcription jobs queued or running.
- Nothing else in the crate that reaches an engine is public, unless the crate's own tests turn on the `unstable-engines` feature.

`Engines::status` lists each feature with whether it is on and whether it can run here.

- For a feature that is on, it asks the engine once whether it has what it needs. That is an OCR language pack for the languages of the person's Windows profile, a handwriting recognizer, or a voice.
- The answer is kept until the settings change.
- The settings screen uses it to explain a feature that is on but unavailable, such as read aloud on a computer with no voices. Reading aloud there fails with the `voiceUnavailable` code rather than a raw system error.

The crate never downloads a model. The interface asks first, and the download code lives in the UI stage.

## Text in images

The `OcrEngine` trait takes an `OcrImage`, which is raw gray pixels or red, green, blue, and alpha (RGBA) pixels. It returns lines with word boxes in image pixels, plus the language. On Windows, `WindowsOcr` runs Windows.Media.Ocr.

- Transparent pixels are blended onto white, because the engine has no alpha channel.
- Images over 10,000 pixels on a side or 32 million pixels in all return `ImageTooLarge`. Scale them down or tile them first. Both the TypeScript client and `OcrRequest::into_parts` check the size before they encode or decode a byte, and the Rust side checks the length of the base64 text before decoding it.
- A language without a recognizer returns `LanguageUnavailable`. With no language set, the engine uses the profile languages.
- Calls block, so run them on a worker thread.

PDF pages need a page renderer first. That belongs to the import and PDF work, not to this crate.

## Handwriting

The `InkRecognizer` trait takes strokes and returns lines of words. Each word carries its best reading, alternatives, the keys of its strokes, and a box. On Windows, `WindowsInk` uses the Ink Analysis API, `Windows.UI.Input.Inking.Analysis`, which works from a desktop process.

- A `StrokeKey` holds the 16 bytes of a note stroke ID. In JSON it is the ID's 26-character text, so the wiring layer converts without a lookup.
- Points are in page units. Apply each stroke's own transform before passing it in.
- `StrokeKind::Auto` lets the recognizer tell writing from drawing, which suits indexing a page. `StrokeKind::Writing` skips that step, which suits the "Writing pen".
- The Ink Analysis API corrupts the heap when two analyzers run at once in one process. `WindowsInk` takes a process-wide lock, so calls queue up instead. Keep that lock if you change the code.

The recognizer reads in the handwriting languages the person has installed. The API has no way to choose one, so a language setting waits for a different engine.

## Read aloud

The `SpeechSynthesizer` trait turns text into a WAV file and the time and text position of every word and sentence. On Windows, `WindowsSpeech` uses the voices installed in Windows through Windows.Media.SpeechSynthesis, which needs no network.

- Text positions count UTF-16 units, the indexes of a JavaScript string. The interface highlights words with them directly.
- Windows reports the position of a cue's last character and gives cues no length. The engine converts both, so each boundary lasts until the next one of its kind starts.
- `plan_chunks` cuts a page into chunks of whole sentences. The first chunk is one sentence, so speech starts sooner. A chunk keeps its offsets one to one with the page: list markers become spaces, and a line with no punctuation gets a period.
- `ReadAloud` synthesizes a few chunks ahead of the one playing, and stops when dropped. A person who stops listening after a paragraph costs a paragraph of work. The interface pulls each chunk through `wire::SpeechHub`, so the bound holds across the command layer too, and a session's sound goes when it ends.
- A page may have a million characters at most.

The interface plays the WAV bytes. It follows the playing time with `wordAt`, and adds a chunk's start to a boundary to find the word in the page.

## Summaries and keywords

The `Summarizer` trait has one implementation that ships, `ExtractiveSummarizer`. It needs no model and no network, and it works on every platform.

- It picks whole sentences and returns them untouched with their positions, so a summary cannot say what the notes do not. The interface can link each sentence back to its place.
- A sentence scores higher when it holds terms the text repeats. The opening prose gets a small bonus. Sentences are then chosen one at a time with a penalty for repeating one already chosen, so the summary does not say one thing twice.
- Keywords are repeated words and phrases of up to four words. A longer phrase replaces a word it mostly explains. Plurals count as one term.
- English, Spanish, French, and German stop words are built in, and the language is detected when not given. East Asian text gets a summary by position, because those scripts need a word splitter this crate does not have.
- A line break ends a sentence, unless a line stops with no punctuation and the next starts in lowercase. List markers are dropped.

A model-backed summarizer can sit behind the same trait later.

## Tasks and chapters

These two tools work on a transcript and use plain rules, with no model. Their results are suggestions, and nothing is added to a page without a click.

- `find_action_items` marks a sentence as a task when it makes a commitment, such as "I'll", "we need to", or "Maria will". It marks a decision when the sentence records a choice, such as "we decided". It skips questions, hedges, and denials. It reports a named owner and the deadline as said, such as "by Friday".
- `make_chapters` finds where the talk changes topic. It compares the words before and after each gap between segments (the TextTiling method), keeps every chapter at least a minute long, and titles each chapter with its best keywords.

Both miss what is said in other words. A person can accept, edit, or ignore each suggestion.

## Tidying handwriting

The `tidy` module plans moves for recognized handwriting. It changes nothing itself, so the strokes stay ink, the originals are kept, and one undo reverses the change.

- **Straighten** turns each tilted line until its ink rows are sharpest. It needs no knowledge of the letters.
- **Even spacing** sets each gap to the line's median and scales words toward the usual width per letter, about their baselines.
- **Reflow** wraps the words to a new width and keeps each word's small offset from its line. A big gap between lines stays a paragraph break.

Each move is an `Affine` transform for one stroke. The geometry comes from the strokes' own points, and the recognition only says which strokes make which word.

## Custom vocabulary

The `vocabulary` module keeps a list of names, course terms, and acronyms. The list is plain text, with one term to a line. A bar after a term can add spellings the transcriber is known to mishear. People can edit the list, keep one for each notebook, and share it.

The list gives the speech engine a hint before it starts. Afterward it corrects what the engine still gets wrong, by replacing the listed mishearings and near misses of single-word terms. Common words and plurals of a term are never replaced. Each change is reported with its position, so the interface can show it and let the person undo it. After the person fixes a word, `offer` suggests adding it.

## Transcription

The `TranscriptionEngine` trait is the seam for whisper.cpp. An engine reads 16 kHz mono samples from an `AudioSource`, reports progress and finished segments through a `JobControl`, and stops when the job is canceled.

`TranscriptionQueue` runs jobs one at a time on a thread in Windows background mode, which lowers its processor, disk, and memory priority. Engines that start helper threads call `enter_background_mode` on each one.

- The device preference is `Auto`, `Npu`, or `Cpu`. `Auto` picks the neural processing unit (NPU) when the engine lists one, and the processor otherwise.
- If the NPU fails under `Auto`, the queue rewinds the audio and runs the job again on the processor. The `Started` event repeats, so the interface clears its partial text.
- A `JobHandle` reports status, cancels, and waits. Canceling a queued job removes it at once.
- An observer receives `JobEvent` values, which the app forwards to the interface. Progress events arrive about once per percent.
- A missing model is `ModelMissing`. The crate never downloads one.

`StubEngine` produces placeholder segments, so the queue and the interface can be built before the real engine exists.

## Test engines and recordings

CI on Linux has no Windows recognizers, so the `mock` module has stand-ins. The `winrt` Cargo feature, on by default, compiles the Windows engines. A Windows build with `--no-default-features` runs the stand-ins too.

- `ReplayInk` and `ReplayOcr` answer from recordings. A recording holds a fingerprint of the input and the answer the real engine gave. An input with no recording is an error, never a guess.
- `tests/fixtures/ink.json` and `ocr.json` hold recordings made on Windows. `tests/record.rs` checks that the live engines still agree with them. Run it with `OPENNOTE_RECORD=1` on a Windows computer to record them again.
- The test pen and the test font avoid `sin`, `cos`, and `hypot`, whose last bits differ between math libraries. A recording made on Windows therefore matches on Linux.
- `MockSpeech` makes silent clips with the timing of 300 ms a word, so read-aloud logic is tested anywhere.

## The interface client

`app/src/services/intel` is the TypeScript client. It has no React and imports no Tauri code. It takes a transport, which is `invoke` alone, so the Tauri layer can supply one later. The [client README](../app/src/services/intel/README.md) lists the commands.

`tests/wire.rs` writes a sample of every JSON shape to `tests/fixtures/wire`. The client's tests read those files and compare them with examples typed by the TypeScript types. A renamed field on either side fails a test. Rewrite the samples with `UPDATE_WIRE=1` after a deliberate change.

## Tests

| Test                            | What it proves                                                                                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/ocr.rs`                  | Text and word boxes come back from an image drawn at test time with a small bitmap font                                                                                                       |
| `tests/ink.rs`                  | Words, alternatives, and stroke keys come back from synthetic strokes                                                                                                                         |
| `tests/speech.rs`               | Windows makes a WAV file with word and sentence times at the right UTF-16 positions                                                                                                           |
| `tests/record.rs`               | The recordings match the live Windows engines                                                                                                                                                 |
| `tests/replay.rs`               | The replay engines give the recorded readings on every platform                                                                                                                               |
| `tests/summarize.rs`            | Summaries, keywords, tasks, and chapters of recorded texts, plus properties on any Unicode text                                                                                               |
| `tests/read_aloud.rs`           | A page is read in chunks that cover it, and every spoken word is found in the page                                                                                                            |
| `tests/tidy.rs`                 | Lines level, gaps even, and words wrap, on test strokes and on the readings recorded from Windows                                                                                             |
| `tests/engines.rs`              | Nothing runs until the person turns the feature on, and turning it off stops what is running                                                                                                  |
| `tests/gate.rs`                 | No other crate turns on `unstable-engines`, and the app imports only the gate and the wire types                                                                                              |
| `tests/wire.rs`                 | The JSON between the interface and the crate matches the samples                                                                                                                              |
| `tests/no_network.rs`           | The linked crates, the Windows features, and the Windows namespaces in the source are exactly the allowed sets, and the source holds no networking word, process launch, foreign link, or URL |
| `tests/no_sockets.rs`           | The process holds no socket while the Windows engines run, and the watch sees one the test opens                                                                                              |
| `tests/bench.rs`                | Timings, run on request with `--release --ignored`                                                                                                                                            |
| `src/transcribe/queue/tests.rs` | Order, cancel, fallback, panics, shutdown, and background priority                                                                                                                            |

The Windows tests need the English OCR, handwriting, and speech components that ship with Windows. They never record from the microphone or play sound, and they write nothing to disk.

## Checks to run by hand

Synthetic strokes are cleaner than a person's handwriting, so accuracy needs a real pen.

1. Write a paragraph in cursive and in print on a device with a pen.
2. Run the recognizer on the strokes and compare the text with what you wrote.
3. Record the error rate in the Phase 12 benchmark sheet.

Run the same check for OCR on a photo of a printed page, and for transcription once the whisper.cpp engine lands. For read aloud, listen to a page in each installed voice and check that the highlighted word follows the sound.

## Left for the UI stage

- Decode stored Opus audio into an `AudioSource`, and render PDF pages into `OcrImage` values.
- Before beta, add an `OcrSource` kind that names a file in the notebook, so a whole photo never travels as base64 in JSON.
- Convert note strokes into `InkStroke` values, and word boxes back into search entries.
- Write the Tauri commands that the client's transport calls. The speech commands map one to one onto `wire::SpeechHub`.
- Add the Phase 12 settings section and the first-run step. Both use `IntelSettings` and `Engines::status`.
- Probe for an NPU and report it from the whisper.cpp engine's `devices` method.
- Ask before downloading a model, and show progress from `JobEvent` values.
