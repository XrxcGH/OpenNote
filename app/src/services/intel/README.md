# Intel client

The TypeScript client for the Rust `opennote-intel` crate. It asks for text in images, handwriting, summaries, keywords, and read aloud. It has no React, imports no Tauri code, and sends nothing over a network. The [design notes](../../../../docs/intel.md) and the [crate README](../../../../crates/intel/README.md) explain the Rust side.

## Contents

- [What it does](#what-it-does)
- [Public API](#public-api)
- [Commands](#commands)
- [Opt-in and errors](#opt-in-and-errors)
- [Read aloud](#read-aloud)
- [Tests](#tests)
- [How it is wired](#how-it-is-wired)

## What it does

`createIntelClient(transport)` returns a client. The transport is the only thing that talks to the shell, so the client works the same against Tauri, the web platform's fake, and tests.

## Public API

| Name                                                                        | What it is                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `createIntelClient(transport)`                                              | Builds the client                                            |
| `client.status()`                                                           | Which features are on, and whether an engine exists for each |
| `client.recognizeImage(image, { language })`                                | Text and word boxes from pixels                              |
| `client.recognizeInk(strokes, { kind })`                                    | Words and the strokes behind each                            |
| `client.tidyInk(strokes, recognition, operation)`                           | Moves that level, space, or wrap recognized handwriting      |
| `client.summarize(text, options)`                                           | The sentences that best stand for the text                   |
| `client.keywords(text, options)`                                            | The words and phrases that best stand for the text           |
| `client.actionItems(transcript)` and `client.chapters(transcript, options)` | Suggested tasks and decisions, and titled chapters           |
| `client.vocabularyOffer(vocabulary, original, fixed)`                       | A term worth adding to the custom vocabulary                 |
| `client.voices()` and `client.speak(text, options)`                         | Installed voices, and one short text as a WAV file           |
| `client.readAloud(text, options)`                                           | A session that yields chunks to play                         |
| `wordAt(info, ms)` and `pageSpan(chunk, boundary)`                          | The word being spoken, and its place in the page             |
| `fromImageData(imageData)`                                                  | Canvas image data as pixels                                  |
| `createFakeIntelTransport(options)`                                         | A stand-in for tests and the web platform                    |
| `IntelClientError`, `isIntelError`, `toIntelError`                          | The one error type                                           |

Offsets into text count UTF-16 units, so they index a JavaScript string directly.

## Commands

The transport's `invoke(command, args)` must support these commands. Each takes one `request` argument, except where noted. `transport.ts` has the exact types.

| Command                                 | Result                                                |
| --------------------------------------- | ----------------------------------------------------- |
| `intel_status`                          | A status for each feature                             |
| `intel_ocr_languages`                   | Language tags                                         |
| `intel_ocr_recognize`                   | Lines and word boxes                                  |
| `intel_ink_recognize`                   | Lines of words with stroke keys                       |
| `intel_ink_tidy`                        | A tidy plan: a move for each stroke that changes      |
| `intel_summarize`                       | A summary                                             |
| `intel_keywords`                        | Keywords                                              |
| `intel_action_items`                    | Tasks and decisions                                   |
| `intel_chapters`                        | Titled chapters                                       |
| `intel_vocabulary_offer`                | A term to offer, or null                              |
| `intel_speech_voices`                   | Voices                                                |
| `intel_speech_synthesize`               | A clip ID and its word times                          |
| `intel_read_aloud_start`                | A session ID and the chunk count                      |
| `intel_read_aloud_next` (`sessionId`)   | The next notice: a chunk, `finished`, or `failed`     |
| `intel_read_aloud_cancel` (`sessionId`) | Nothing                                               |
| `intel_clip_audio` (`clipId`)           | The WAV bytes, after which the shell forgets the clip |

Read aloud is pulled, not pushed. The session asks for the next notice only when the player asks for the next chunk, and fetches the chunk's sound before it hands the chunk over. The Rust side therefore makes a few chunks ahead at most, and holds no sound the client will not fetch.

## Opt-in and errors

Every feature is off until the person turns it on. A call for a feature that is off rejects with the code `disabled` and the `feature` to offer. A feature with no engine rejects with `unsupported`. The message is for logs, and the interface picks its own words from the code.

Every method rejects only with `IntelClientError`. The client also reads the app's command error shape, where the feature arrives in `field`.

## Read aloud

`client.readAloud(text)` resolves to a session. Use `for await (const chunk of session)`. Each chunk has `span`, `info` with the word times, and `audio()`, which fetches the WAV once and keeps it. Leaving the loop early cancels the session.

To highlight words, find `wordAt(chunk.info, player.currentTime * 1000)` and map it with `pageSpan(chunk, boundary)`. The first chunk is one sentence, so playback starts quickly.

## Tests

- `contract.test.ts` compares the types with the JSON that the Rust tests write to `crates/intel/tests/fixtures/wire`, in both directions. After a deliberate change in Rust, rewrite the samples with `UPDATE_WIRE=1 cargo test -p opennote-intel --test wire`.
- `readAloud.test.ts` replays the Rust crate's own notices through a transport that answers one per pull.
- `client.test.ts` checks the opt-in rules and the fake transport.

## How it is wired

The app wires this client in `app/src/features/intel` (see its README). The Tauri commands are in `app/src-tauri/src/intel`, and the transport for each platform is in `app/src/platform/intel.ts`. Two commands beyond the list above keep the person's choices: `intel_settings_get` and `intel_settings_set`.

- Large images still arrive as pixels. The interface scales an image to at most 3200 pixels on a side and sends it as gray pixels. Reading a notebook's own file in Rust would need a new `OcrSource` kind.
- The first-run setup step for these features is not wired yet.
