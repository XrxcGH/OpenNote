# opennote-intel

On-device intelligence for OpenNote: text in images, handwriting, read aloud, summaries, and transcription. Everything runs on the device. The crate sends nothing anywhere, and every feature is off until the person turns it on. The [design notes](../../docs/intel.md) explain why. This file lists each module, its public API, and what the interface wiring needs.

## Contents

- [Privacy](#privacy)
- [Features and building](#features-and-building)
- [Engines and settings](#engines-and-settings)
- [ocr](#ocr)
- [ink](#ink)
- [speech](#speech)
- [summarize](#summarize)
- [tidy](#tidy)
- [vocabulary](#vocabulary)
- [transcribe](#transcribe)
- [mock](#mock)
- [wire](#wire)
- [text and error](#text-and-error)

## Privacy

- The crate links only an allow-listed set of crates, turns on only the Windows features it needs, and names only allow-listed Windows namespaces. It holds no URL, no networking word, and no process launch. `tests/no_network.rs` fails the build if that changes, and `tests/no_sockets.rs` watches the process for sockets while the Windows engines run.
- It never stores, logs, or keeps the input after a call returns.
- It never downloads a model. A missing model is `IntelError::ModelMissing`, and the interface asks first.
- Every feature is off by default. `Engines` refuses a feature that is off with `IntelError::Disabled`.
- `Engines` is the only public way to an engine. The platform constructors (`default_engine`, `WindowsOcr`, and the like), `ReadAloud::start`, `TranscriptionQueue::new`, `tidy::plan`, and the summarize functions are private to the crate unless the `unstable-engines` feature is on. Only the crate's own tests turn it on, and `tests/gate.rs` fails if another crate does. The same test checks that the app imports only `Engines`, the settings, the errors, and `wire` from this crate.
- Turning a feature off stops the engines handed out before. Their next call fails with `Disabled`, a page being read aloud stops at its next chunk, and a transcription queue fails its waiting jobs and cancels the running one.

## Features and building

| Cargo feature      | Default | What it does                                                                                     |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------ |
| `winrt`            | on      | Compiles the Windows engines: OCR, Ink Analysis, and speech synthesis                            |
| `unstable-engines` | off     | Makes the engines and free functions public for the crate's own tests. The app never turns it on |

Without `winrt`, or on another platform, those features report `IntelError::Unsupported`. The `mock` module and the extractive summarizer work everywhere.

```text
cargo test -p opennote-intel                          # everything, with the Windows engines on Windows
cargo test -p opennote-intel --no-default-features    # the path Linux CI takes
cargo test -p opennote-intel --release --test bench -- --ignored --nocapture --test-threads 1
```

## Engines and settings

**What it does.** `Engines` is the one place the app asks for an engine. `IntelSettings` holds the person's choices.

**API.**

- `IntelSettings` has `ocr`, `handwriting`, `read_aloud`, `summaries`, and `transcription` flags. All default to off, and `IntelSettings::recommended()` turns them all on for first-run setup.
- `Engines::platform(settings)` builds the engines of this platform. `Engines::mock(settings, ink, ocr)` builds replay engines.
- `ocr()`, `ink()`, `speech()`, `summarizer()`, and `transcription()` return an engine, or `Disabled` when the feature is off.
- `tidy()` needs `handwriting`. `action_items()` and `chapters()` need `summaries`. `vocabulary_offer()` needs `transcription`.
- `read_aloud(text, options)` starts a read-aloud session.
- `status()` lists a `FeatureStatus` for each feature: `enabled`, `available`, and a reason when it is not available.
- `set_settings` changes the choices. Turning a feature off takes effect at the next request.

**UI wiring needs.** Store `IntelSettings` in the app settings, and call `set_settings` when it changes. Show `status()` on the settings screen. Ask `Engines` for an engine on every request, and never cache one past a settings change.

## ocr

**What it does.** Finds lines of text, and a box for each word, in one image.

**API.** `OcrEngine::{available_languages, recognize}`, `OcrImage::new(width, height, PixelFormat, pixels)`, `OcrOptions { language }`, and `OcrResult { language, lines, angle }`. `Engines::ocr` hands out the engine, which is `WindowsOcr` on Windows.

**UI wiring needs.** Decode the image file into pixels, because the crate decodes nothing. Scale down or tile an image over 10,000 pixels on a side or 32 million pixels in all (`MAX_IMAGE_SIDE`, `MAX_IMAGE_PIXELS`). Render PDF pages into images first. Run calls on a worker thread. Turn word boxes back into search entries.

## ink

**What it does.** Reads handwriting. Each word comes with other readings, a box, and the keys of the strokes that make it.

**API.** `InkRecognizer::recognize(strokes, options)`, `InkStroke { key, points }`, `StrokeKey` (16 bytes, 26-character text in JSON), `InkOptions { kind }`, `StrokeKind::{Auto, Writing}`, and `InkRecognition { lines }`. On Windows, `Engines::ink` returns `WindowsInk`.

**UI wiring needs.** Apply each stroke's own transform before passing it in. Use `Auto` to index a page and `Writing` for a writing pen. Run calls on a worker thread, because a page of a dozen words takes about a second. The recognizer reads the handwriting languages installed in Windows, and the crate cannot choose one.

## speech

**What it does.** Turns text into a WAV file with the time and UTF-16 position of every word and sentence. `ReadAloud` reads a whole page chunk by chunk.

**API.**

- `SpeechSynthesizer::{voices, synthesize}`, `SpeakOptions { voice, rate, pitch, volume }`, `SpeechAudio { wav, info }`, and `SpeechInfo { duration_ms, boundaries }`. Speech comes from `Engines::speech`, backed by `WindowsSpeech` there.
- `plan_chunks(text, max_chars)` returns `Chunk { span, text }` values whose offsets line up with the page.
- `Engines::read_aloud(text, options)` returns a session. Take events with `next_event(timeout)`. `ReadAloudEvent` is `Chunk`, `Finished`, or `Failed`. Dropping the session stops it, after the chunk being made finishes, so drop it off the interface thread.
- `SpeechInfo::word_at(ms)` finds the word being spoken.
- `wav::{read_info, write_pcm16_mono}` reads and writes the WAV header.

**UI wiring needs.** Write the commands in the client README on top of one `wire::SpeechHub`, which keeps the sessions and the sound of each clip. Read aloud is pulled, not pushed: each `intel_read_aloud_next` call takes one chunk, so the engine stays a few chunks ahead of the player. Play chunks in order with Web Audio or an audio element, and highlight `wordAt(info, currentTime)` shifted by the chunk's start. Show the voice list from `voices()`.

## summarize

**What it does.** Chooses the sentences that best stand for a text, and finds its keywords. For a transcript it also suggests tasks and decisions, and cuts the talk into titled chapters. It uses no model.

**API.**

- `Summarizer::{summarize, keywords}`, `SummaryOptions { max_sentences, max_chars, language }`, `Summary { language, sentences, input_sentences }`, `SummarySentence { text, span, score }`, `KeywordOptions { max_keywords, max_words, language }`, `Keyword { text, score, count }`, `ExtractiveSummarizer`, and `default_summarizer()`. The text limit is 4 MiB.
- `find_action_items(transcript)` returns `ActionItem { kind, text, segment, start_ms, owner, due }` values. The kind is `Task` or `Decision`. The deadline is the phrase as said, such as "by Friday".
- `make_chapters(transcript, options)` returns `Chapter { start_ms, end_ms, first_segment, last_segment, title, keywords }` values that cover the talk. `ChapterOptions` sets the most chapters and the shortest length.

**UI wiring needs.** Join the page's blocks with line breaks before calling, so each block ends a sentence. Link each summary sentence to its `span` in that text, and map the span back to a block. Run calls on a worker thread for long texts. A page takes a few milliseconds. Show action items and chapters as suggestions, add nothing without a click, and parse each `due` phrase with the date parser from the Upcoming list. An empty chapter title means the interface supplies its own, such as "Part 2".

## tidy

**What it does.** Plans moves that level the lines of recognized handwriting, even out word gaps and sizes, or wrap the words to a new width. It changes nothing itself.

**API.** `tidy::plan(strokes, recognition, operation)` returns a `TidyPlan { moves, bounds }`. `TidyOperation` is `Straighten`, `EvenSpacing`, or `Reflow { width }`. Each `StrokeMove` has a stroke key and an `Affine` transform, written in JSON as the six numbers `[a, b, c, d, e, f]` of the note format. `TidyPlan::apply(strokes)` returns the moved strokes, for a preview.

**UI wiring needs.** Run recognition first, with `Writing` or `Auto`, and pass the same strokes. Combine each move with the stroke's own transform, `old.then(move)`. Keep the original strokes, so one undo reverses the change. Use `bounds` to update the selection. The reflow width comes from the drag of the side handle, in page units.

## vocabulary

**What it does.** Keeps the custom list of names, course terms, and acronyms that the transcriber should spell. It builds the hint for the speech engine and corrects transcripts afterward.

**API.**

- `Vocabulary::{parse, to_text, add, remove, contains, entries}` reads and writes the plain-text list. It has one term to a line, with optional `| heard as` spellings.
- `prompt(max_chars)` is the hint for the engine.
- `correct(text)` and `correct_transcript(transcript)` replace mishearings. Each `Change` has the old text, the new text, and its position in UTF-16 units.
- `offer(original, fixed)` suggests a term to add after the person fixes a word.

**UI wiring needs.** Store one list for each notebook as a text file the person can edit and share. Pass `prompt()` to the whisper.cpp engine as its initial prompt, and run `correct_transcript` on the result. Show the changes and let the person undo them. After a fix in the transcript, call `offer` and ask before adding the term.

## transcribe

**What it does.** Defines the engine seam for whisper.cpp and runs transcription jobs one at a time in the background.

**API.** `TranscriptionEngine`, `Engines::transcription_queue(observer)`, `TranscriptionQueue::submit`, `JobRequest`, `JobHandle::{status, cancel, wait}`, `JobEvent`, `AudioSource`, `MemoryAudio`, `StubEngine`, and `enter_background_mode`.

**UI wiring needs.** Decode stored Opus audio into an `AudioSource`. Forward `JobEvent` values to the interface. Probe for a neural processing unit (NPU) and report it from the engine's `devices` method. Ask before downloading a model.

## mock

**What it does.** Stand-in engines for tests, so Linux CI covers the same code paths as Windows.

**API.** `ReplayInk` and `ReplayOcr` (built from `InkRecording` and `OcrRecording` values, or from JSON), `ink_fingerprint`, `ocr_fingerprint`, and `MockSpeech` (silent clips, with `failing_on` to test errors).

**UI wiring needs.** Use `Engines::mock` in the app's end-to-end tests on Linux, or `with_fallback` on `ReplayInk` to answer any strokes with fixed text.

## wire

**What it does.** Holds the request shapes the interface sends, the result types it receives, and the speech hub behind the read-aloud commands.

**API.** `OcrRequest`, `InkRequest`, `TidyRequest`, `SummarizeRequest`, `KeywordsRequest`, `ActionItemsRequest`, `ChaptersRequest`, `VocabularyOfferRequest`, `SynthesizeRequest`, `SpeechClip`, `ReadAloudRequest`, `ReadAloudStarted`, `ReadAloudNotice`, and `encode_pixels`. The result types are re-exported here, so the app imports only `wire` and the gate. Field names are camelCase.

`SpeechHub::{synthesize, start, next, clip_audio, cancel}` serves the speech commands one to one. It keeps at most 2 unfetched clips a session, 16 clips and 4 sessions in all, and drops a session's clips when it is canceled, finishes, or fails.

**UI wiring needs.** Each Tauri command takes one of these requests, calls `Engines` or the hub, and returns the result. Run `next` off the interface thread, because it waits for the chunk. Map `IntelError::info()` to the app's command error, which has `code`, `message`, and a `field` that carries the feature.

## text and error

`text` has `split_sentences`, `words`, `utf16_spans`, and `Span`. Offsets that leave the crate are UTF-16 units. `IntelError` is `Clone`, and `info()` gives the `{ code, message, feature }` form for the interface.
