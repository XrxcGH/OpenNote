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
| Share the lesson as a video | Choose Export as video in the More menu, or press Ctrl+K and choose Export the recording as a narrated video. |
| Free up disk space | Open the recording storage list. Compress a recording, or remove its audio and keep the transcript. |

Settings has a Recording section for the defaults.

### Export as video

A narrated video shows the page and draws your ink again at the moments you drew it, with the recording's sound underneath. Pauses are left out. Choose where to save it, and OpenNote makes an MP4 file with the video and sound encoders that come with Windows. Making it takes about as long as the recording. If Windows has no encoder (some "N" editions), OpenNote says so and nothing is saved.

### Upload to YouTube

Connect Google in Settings, then Connectors. In the recording's More menu, or from Ctrl+K, choose Upload to YouTube. Pick Private or Unlisted, name the video, and choose Upload. OpenNote makes the video, sends it in pieces, and puts the link on your clipboard. It never makes a video public. You can do that in YouTube Studio. A video you upload with an app that Google has not yet reviewed may stay private whatever you choose.

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
- The 64-bit download reads speech with whisper.cpp, which is several times faster than the built-in reader the other downloads use. Both read the same model files and run on the processor. A build made with Vulkan support can use the graphics card for whole recordings, and falls back to the processor if it cannot. NPU chips are not used.
- The audio is read from the page's own files. No copy is made.

### A transcript of every recording

To get a transcript and summary without asking each time, open Settings, then Recording, and turn on Make a transcript and summary of every recording. It is off until you turn it on.

When a recording stops, or you drop an audio file on a page, its transcript is made in the background and placed after the recording, with a short summary at the top. It shows in the activity panel, where you can pause or stop it. A recording that already has a transcript keeps it.



## Videos, podcasts, and live embeds

Paste a YouTube or Vimeo link, a podcast episode, or a Desmos, GeoGebra, Figma, Miro, or Lucidchart link into an empty text box, or press Ctrl+K and choose Insert video, podcast, or embed from link. The page keeps a card with the title and a saved picture. Nothing loads from the site until you press Play or Show the live view, so a page opens fast and works offline.

With a YouTube or Vimeo video playing, the notes you type are time-stamped to the playhead, the same way they are during a recording. Hold Alt and click a note to jump back to its moment. Only these sites can be shown on a page. Any other link stays a normal link.

### Captions as a transcript

Connect Google (for YouTube) or Vimeo in Settings, then Connectors. Open the page with the video, press Ctrl+K, and choose Add captions as a transcript. The captions are kept on the video's card, and a line in the transcript jumps the player to its time. YouTube lets only the owner of a video read its captions, so for other people's videos OpenNote says so and nothing is added.

Recording is built. Agents started a recording once and it worked. Nobody has tried the rest by hand.

### Live captions

To see the words while a recording runs, open Settings, then Recording, and turn on Show live captions while recording. A strip shows the last few phrases, and the one being said appears a little rough until the speaker pauses. The strip uses your Windows caption size, font, and colors, and sits at the bottom or the top of the window, as you choose. If this computer cannot keep up, the strip says it is running behind. The captions disappear when the recording stops, and the transcript is made as usual.
