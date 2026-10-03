# Audio recording on the page

This folder is the screens for [audio recording](../../../../../crates/media/README.md): the record control, the indicator, the recording block, playback, and the work behind them. The Rust side is `app/src-tauri/src/audio.rs`. The interface's client of the media crate is [`core/audio`](../../../core/audio/README.md).

## Contents

- [What works](#what-works)
- [Where things are](#where-things-are)
- [How a recording is kept](#how-a-recording-is-kept)
- [Keys](#keys)
- [Flags](#flags)
- [Testing](#testing)
- [Not done](#not-done)

## What works

- **Record.** The Record button in the command bar, or Alt+Shift+A, starts a recording in a new block after the block with the caret. Options picks the microphone and, for meetings, records the PC's sound too.
- **Indicator.** A red dot and the recorded time sit in the title bar while a recording runs, on every page. It opens the level meters, the warnings, and Pause, Flag, and Stop.
- **Recording block.** While recording, the block is the recording bar. After Stop, it is the player: play, 10-second skips, a slider, speed from 0.5x to 3x, skipping silence, and flags.
- **Time stamps.** Text typed while recording is marked with its time. Alt+click on a word, or Alt+Shift+C with the caret in it, plays from that moment. While a recording plays, the blocks written at that moment get a tint, and the words too when their editor is open.
- **Trim.** The More menu trims the silence at both ends, or removes a marked part after asking.
- **Crash recovery.** A block that still says `recording` when its page opens is rebuilt from its files.
- **Exit.** Closing the app stops the recording first and saves its entry.

## Where things are

| File                                                       | Holds                                                                                                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `../registrations/audio.ts`                                | Commands, keys, the command bar item, the title bar item, the block renderer, and the page-open hook. It loads at start-up, so it holds definitions only. |
| `state.ts`                                                 | The stores the start-up parts read.                                                                                                                       |
| `controller.ts`                                            | Starting, pausing, flagging, and stopping a recording.                                                                                                    |
| `blocks.ts`, `entry.ts`                                    | Reading and writing the recording block.                                                                                                                  |
| `playback.ts`, `highlight.ts`                              | The one open playback, and the moving highlight.                                                                                                          |
| `stamps.ts`, `watch.ts`                                    | Text marks, and Alt+click.                                                                                                                                |
| `edits.ts`, `flagEdits.ts`                                 | Trimming, and flags.                                                                                                                                      |
| `recover.ts`                                               | Recovery after a crash.                                                                                                                                   |
| `RecordControl.tsx`, `Indicator.tsx`, `RecordingBlock.tsx` | The screens.                                                                                                                                              |

## How a recording is kept

The note format has no place for a page's recordings yet. So the files live in `%LOCALAPPDATA%\OpenNote\phase9\recordings\<page>`. The page keeps each recording's entry in its view, under `recordings`, and a block of type `ext:org.opennote/recording` says where the recording sits. The block has a fallback ("Audio recording") for readers that don't know the type.

The core can't edit a block of a type it doesn't know, but it edits and keeps the view. So every change to an entry, such as a flag or the end of a recording, is a `setPage` step, which an undo takes back like any other. The text marks are different: they go in the `data.marks` of the text block, in the step that changes the text.

The block and the entry are saved before any audio file exists, and the page is saved to disk before the devices open. A crash then never leaves audio that no page knows about. An entry with no files is removed, with its block, when the page opens.

An edit writes new files and leaves the old ones. The new entry replaces the old one, the page is saved, and then the old files are deleted.

## Keys

| Keys                     | Does                       |
| ------------------------ | -------------------------- |
| Alt+Shift+A              | Start or stop recording    |
| Alt+Shift+S              | Stop                       |
| Alt+Shift+P              | Pause or resume recording  |
| Alt+Shift+K              | Play or pause              |
| Alt+Shift+J, Alt+Shift+L | Back or forward 10 seconds |
| Alt+Shift+M              | Flag this moment           |
| Alt+Shift+B, Alt+Shift+N | Previous or next flag      |
| Alt+Shift+C              | Play from the caret        |

They work while typing.

## Flags

`audio.record`, `audio.stamps`, `audio.flags`, `audio.trim`, and `audio.systemAudio` are on. `audio.meetingPrompt` is off, because nothing watches for meetings yet.

## Testing

```sh
npx vitest run --config app/vitest.config.ts --project unit app/src/features/page/audio
npx vitest run --config app/vitest.config.ts --project components app/src/features/page/audio
npx playwright test --config tests/ui/playwright.config.ts tests/ui/behavior/recording.spec.ts
cargo test -p opennote --lib audio
cargo test -p opennote --lib real_microphone -- --ignored
```

The web platform has a fake recorder and player, so the first three run with no microphone. The last records two seconds from the default microphone and plays them back.

## Not done

- Strokes carry no stamps, because the ink layer isn't here yet. When it is, it calls `addStampSource` in `playback.ts` with a function that returns `strokeEntries(recordings, strokes)`, and tapping a stroke and the highlight follow.
- Tapping a word works with Alt+click and a key. A touch or pen tap has no gesture yet.
- Splitting, compressing, and enhancing a recording, and the storage list, have no screens.
- The Recording section of Settings, and the meeting prompt.
- The text marks follow the editor's own edits. An undo that comes back from the core restores the old marks only after the page reopens.
