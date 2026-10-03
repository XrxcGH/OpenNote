# Transcripts

A recording's transcript, on the page. It is part of [audio recording](../README.md): a block of type `ext:org.opennote/transcript` after the recording, whose `data` is a `TranscriptData` (`model.ts`). Every time in it is a position in the recording's audio, in milliseconds, so a click on a line is a seek.

## Contents

- [What works](#what-works)
- [Where things are](#where-things-are)
- [How a transcript is kept](#how-a-transcript-is-kept)
- [Flags](#flags)
- [Testing](#testing)
- [Not done](#not-done)

## What works

- **The block.** A one-paragraph summary, then each line with its time and speaker. A time plays the recording from that line, and the line being spoken is marked while it plays. Edit turns the words into fields.
- **Speakers.** Lines carry a number (Speaker 1, 2, and so on). Renaming one speaker renames every line, and the names used before are suggested in the dialog. In edit mode each line's speaker can be changed.
- **Lines to notes.** Tick lines, then press Alt+Shift+O or Copy to notes. The quote goes in at the caret, each line's time links to its moment (`opennote:moment/<recording>#<ms>`), and the speaker's name is included if asked. With no note at the caret the quote is copied as Markdown.
- **Action items and chapters.** Find action items and Make chapters ask the on-device summaries, show what they find, and add nothing until a click. An action item becomes a checkbox with its due date and a link to its moment. Chapters can be kept with the transcript, and then list under the summary with jump points.
- **Copy recap.** Summary, decisions, and action items, as formatted text or Markdown, with a preview and a choice of parts. Without on-device summaries it offers the page's own headings and open checkboxes.
- **Making one.** The More menu of a recording makes a transcript with the registered speech engine, or adds one from captions (SRT, WebVTT), lines that start with a time, or plain text. Transcripts can be made from the original or the enhanced voice.
- **Edits to the audio.** A removed part takes its words out of the transcript, along with the summary and chapters, which could carry them. A split divides the transcript. A trim moves it earlier by what was cut from the start.

## Where things are

| File | Holds |
| --- | --- |
| `model.ts` | The data, and every change to it as a pure function. Parsing captions and text, quotes, the recap. |
| `store.ts` | Finding and saving the transcript block, the ticked lines, the saved speaker names. |
| `engine.ts` | The seam where the speech engine registers. |
| `actions.ts`, `commands.ts` | What the screens and commands do. |
| `TranscriptBlock.tsx`, `blockRenderer.tsx`, `dialogs.tsx` | The screens. |

## How a transcript is kept

The core can't edit a block of a type it doesn't know, but it patches one: a change is a `patchBlock` step with the new `data` and a new `fallback`. The fallback is the transcript as plain text, which is what search indexes and what a reader that doesn't know the block shows. So the words are searchable, and one undo takes a change back.

## Flags

`transcripts.block`, `transcripts.speakers`, `transcripts.notes`, `transcripts.actions` and `transcripts.recap` are on.

## Testing

```sh
npx vitest run --config app/vitest.config.ts --project unit app/src/features/page/audio/transcripts
```

## Not done

- No speech engine is registered. `registerTranscriptEngine` is where the on-device transcriber plugs in. It also needs to report speaker numbers for diarization to show.
- Custom vocabulary is not applied to a transcript.
