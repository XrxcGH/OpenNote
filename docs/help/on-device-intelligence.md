# On-device intelligence

Some features read pictures, hear speech, or write for you. In OpenNote they run on your computer. Each one is off until you turn it on.

![On-device intelligence in Settings, with every feature off and each marked as running on this device](../screens/settings-intelligence-light.png)

## Turn features on

First-time setup has a step for this, and Not now is a fine answer.

![The setup step for on-device intelligence, with Not now selected](../screens/setup-intelligence-light.png)

Later, open Settings, then On-device intelligence. Each feature shows what it does. A feature that needs a model asks before it downloads one, and tells you its size.

## Models

Settings, then On-device intelligence, then Models lists everything that can be downloaded, with its size:

- Speech models, for transcripts, dictation, and live captions.
- A language model for Ask and the writing tools. A small one is fast and light. A balanced one writes better and needs more memory. If you downloaded both, choose which one to use.
- A meaning model, so Find by meaning reads what pages mean and not only their words. Turning it on rebuilds the index of your pages once.
- Translation packs, one for each pair of languages.

Nothing downloads until you press Download, and every file is checked against a checksum before it is kept. A stopped download resumes. Work offline and safe mode block downloads. Remove deletes the file, and the feature goes back to what it did before: rules for the writing tools, quotes for Ask, words for search. The language model runs only while you use Ask or a writing tool, and its memory goes back to your computer after a couple of minutes.

## What you can do

| Feature | How to use it |
|---|---|
| Text in pictures | Right-click a picture and choose Copy text from image. Turn on Search text in pictures to find the words with search. Once a picture or a scanned PDF page has been read, drag across its words to select just the ones you want, then press Ctrl+C. |
| Search in handwriting and transcripts | With Search text in pictures and handwriting on, search finds words in your ink and in recordings' transcripts. Opening a result in handwriting marks the matching words for a few seconds. Pages in locked sections are never read. |
| Read aloud | Select text, press Ctrl+K, and choose Read aloud. |
| Summaries | Ask for a summary of a page. |
| Handwriting to text | Lasso your writing and choose Convert to text. Tidy handwriting straightens it and evens the spacing. |
| Search by meaning | Search finds pages by what they mean. A Related pages list shows pages like this one. |
| Ask your notes | Press Ctrl+K and choose Ask. The answer lists the pages it used. With a language model downloaded it writes the answer in its own words, and without one it quotes your pages. |
| Writing tools | Select text, then proofread, rewrite, shorten, make a list, or tidy it. With a language model downloaded the suggestions are written by the model, and without one they come from rules. Nothing changes until you accept. |
| Transcription | Download a speech model, then choose Make a transcript on a recording. See [recording](recording.md). |
| Custom vocabulary | Add names and course terms for each notebook. |
| Translate | Choose Translate in the command list to translate the selection, the page, or a transcript. The translation is added below the original, and Undo takes it away. It needs a language pack for the pair of languages, which downloads once after you see its size and press Download. Code, math, and links are kept as they were. |
| Dictation | Click in a text block, then press Ctrl+Alt+V or the Dictate button. Your words are typed at the cursor. Say "period", "comma", "new line", "new paragraph", or "undo that". A bar stays on screen while the microphone is on; Escape or Stop turns it off. The sound is read on this device and never kept. |
| Live captions | In Settings, then Recording, turn on Show live captions while recording. Words appear on a strip as people speak and go away when the recording ends. They use your Windows caption size, font, and colors. |

Work that runs in the background shows in an activity panel. You can stop it there.

## What to know

- Nothing leaves your computer.
- Windows language packs and voices must be installed for text recognition and read aloud.
- Turning a feature off stops its work at once.

## What a build may not have

The 64-bit Windows download carries the full set of engines: whisper.cpp for fast speech to text, ONNX Runtime for translation and the meaning model, and llama.cpp for the language model. The 32-bit and ARM64 downloads read speech with the built-in reader, which is slower, and cannot translate or run a language model on this device. Where a model is not available, the screen says so. See the [feature list](../FEATURES.md).

On-device intelligence is built. Agents checked it with tests and by opening its settings. Nobody has tried it by hand.
