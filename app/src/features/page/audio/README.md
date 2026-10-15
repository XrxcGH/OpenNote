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
- **Tap a word.** A pen or a finger tap on a stamped word plays from it: one tap while a recording is open for listening, two taps at other times, so a single tap still places the caret.
- **Split.** The More menu splits a recording at the listening position. The first half keeps the block, and the second becomes a new recording after it. Flags, typed-text marks, and the transcript go to the half they belong to.
- **Remove a part.** As before, and now the words spoken in it leave the transcript and the page's saved versions are deleted, so it can't be brought back.
- **Enhance voice.** The More menu makes a copy with the noise reduced and the voice leveled. The original stays, a switch under the player listens to either, and the transcript can be made from either.
- **Save as audio.** The More menu saves a recording as one WAV or Opus file. It is the enhanced voice when that is the one being listened to.
- **Recording storage.** Settings, Recording, Manage recordings (or the command) lists every recording with its length, size, page, and notebook. Compress writes a smaller copy, and Remove audio keeps the transcript and flags. Each asks first and says the space it frees.
- **Meeting prompt.** Off until Settings, Recording turns it on. It asks the host every five seconds which app uses the microphone, and offers Record this meeting, Not now, or Never for this app, once for each call. It never starts a recording itself.
- **Snap the screen.** While recording, Alt+Shift+X snaps the screen, Alt+Shift+W the window behind OpenNote, and Alt+Shift+Z a part of the screen. The picture goes on the page stamped to the moment, and tapping it plays from there.
- **Audio and video files.** Dropping one on a page makes a recording of its sound, written into the page's assets, with the same player, speed, flags, and notes. Windows' own codecs decode it, so MP3, M4A, MP4, and WAV work where the codec is installed.
- **Transcripts.** See [transcripts](./transcripts/README.md).
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
| `edits.ts`, `enhance.ts`, `exportAudio.ts`                 | Split, trim, and remove; the enhanced copy; saving as audio.                                                                                              |
| `storage.ts`, `StorageDialog.tsx`                          | The list of what recordings take, Compress, Remove audio.                                                                                                 |
| `meeting.tsx`, `snap.tsx`, `RegionDialog.tsx`              | The meeting prompt, and snapping the screen.                                                                                                              |
| `drop.ts`, `importFiles.ts`, `momentLinks.ts`              | Audio files dropped on a page, and links to a moment.                                                                                                     |
| `SettingsSection.tsx`                                      | The Recording section of Settings.                                                                                                                        |
| `moreClient.ts`                                            | The client of the later host commands (`core/audio/more.ts`, `app/src-tauri/src/audio_more`).                                                             |
| `transcripts/`                                             | The transcript block, speakers, quotes, action items, chapters, and the recap.                                                                            |
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

`audio.record`, `audio.stamps`, `audio.flags`, `audio.trim`, `audio.systemAudio`, `audio.meetingPrompt`, `audio.enhance`, `audio.storage`, `audio.snap`, `audio.import`, `audio.export`, `transcripts.block`, `transcripts.speakers`, `transcripts.notes`, `transcripts.actions`, `transcripts.recap` and `settings.recording` are on. The meeting prompt itself is off until the person turns it on in Settings.

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

- Strokes need no marks: each keeps its start time. `stamps.ts` adds `inkEntries` as a stamp source, reading the shown page's strokes through `seams/inkStrokes.ts` (the ink view sets the reader), and the "Play the recording from the selected ink" command plays from the first selected stroke. The highlight does not paint strokes yet.
- Making a transcript from speech needs the on-device transcriber, which is not registered yet (`transcripts/engine.ts` is the seam). Until then a transcript is added from captions or text.
- Speaker labels come from the engine when it can tell voices apart. A transcript added from text has none, and each line's speaker can be set by hand in edit mode.
- Embedded video and podcast players are not here, because the embeds block does not exist yet. A narrated video of the page is not here: it needs a video encoder.
- Saving as M4A or MP3 is not here. WAV and Opus are.
- Region snaps cut the picture in the interface, so the whole screen is captured first.
- The text marks follow the editor's own edits. An undo that comes back from the core restores the old marks only after the page reopens.
