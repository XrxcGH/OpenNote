# Recording

Record a lecture or a meeting while you type or write. Your notes are stamped with the time, so you can tap one later and hear that moment.

![The recording options under the Record button, with the microphone and the PC sound choice](../screens/recording-light.png)

## Start and stop

1. Choose Record, or press Ctrl+K and choose Start recording. Allow the microphone if Windows asks.
2. Open Options to pick a microphone. Turn on Also record sound from this PC to capture the other people in a meeting.
3. Type or write your notes. Add a flag to mark a moment you want to find again.
4. Pause, resume, or stop. A recording block appears on the page.

OpenNote reminds you to tell everyone before you record a meeting. If the app stops while it records, it offers to recover the recording the next time you start.

## Play it back

Tap a stamped word or stroke and the recording plays from that moment. You can change the speed and skip back or forward.

## Tidy a recording

| To do this | Do this |
|---|---|
| Cut dead air at the start or end | Choose Trim. |
| Split a recording in two | Choose Split in the More menu. |
| Remove a part you marked off the record | Remove it. The audio, the transcript, and the search index all lose it. |
| Make a quiet voice clearer | Turn on Voice enhancement. |
| Share the audio | Export the recording as an audio file. |
| Free up disk space | Open the recording storage list. Compress a recording, or remove its audio and keep the transcript. |

Settings has a Recording section for the defaults.

## Transcripts and recaps

A transcript block lists each line with its time, and a click jumps to that moment. You can rename a speaker once, and every line updates. You can turn lines into notes, pull out action items and chapters, and copy a meeting recap.

### Make a transcript on this device

OpenNote turns speech into text with a Whisper speech model that runs on your computer. Nothing is sent anywhere.

1. Open Settings, then On-device intelligence, and turn on Transcription.
2. Under Models, download a speech model. Each one shows its size before it downloads. The base English model is the one most people want.
3. On a recording, open More and choose Make a transcript.

The transcript is made in the background, one recording at a time, and a note shows how far along it is. Choose Stop on that note to stop it. A long recording takes a few minutes.

- The notebook's custom vocabulary is given to the model first, and its spellings are fixed in the result. See [on-device intelligence](on-device-intelligence.md).
- If you used Enhance voice, you can choose to make the transcript from the original or the enhanced voice, in the recording's More menu.
- The model runs on the processor. Graphics and NPU chips are not used yet.
- The audio is read from the page's own files. No copy is made.

### A transcript of every recording

To get a transcript and summary without asking each time, open Settings, then Recording, and turn on Make a transcript and summary of every recording. It is off until you turn it on.

When a recording stops, or you drop an audio file on a page, its transcript is made in the background and placed after the recording, with a short summary at the top. It shows in the activity panel, where you can pause or stop it. A recording that already has a transcript keeps it.

Recording is built. Agents started a recording once and it worked. Nobody has tried the rest by hand.
