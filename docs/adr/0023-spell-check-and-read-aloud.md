# ADR 0023: Spell check and read aloud through Windows services

- Status: Proposed. Spike S2 passed in Edge 154; spike S1 waits for a run with NVDA and Narrator
- Date: 2026-10-03

## Context

DEVELOPMENT.md asks for "spell check using the Windows spelling service". FEATURES.md asks for several languages at once, a personal dictionary, and a read-aloud feature that uses only the voices installed on Windows, so the text never leaves the device, with a highlight on each spoken word. The forces:

- **WebView2's built-in spell checker** checks one language only (the environment's language), ignores `lang` attributes, and has no API to list, choose, or add words. `webview2-com-sys` 0.39.1 has no spell-check interface. ADR 0005 found that turning spell check off changed typing latency by nothing measurable.
- **Static blocks.** Most blocks on a page stay static until focused (ADR 0020), and squiggles and F7 must work there too.
- **Typing.** Nothing may run on the keystroke's task.
- **Speech in WebView2.** The Web Speech API lists local voices and online voices. Online voices send text to a cloud service.

## Decision

We will:

1. Turn WebView2's checker off in editors (`spellcheck="false"`) and check spelling with the Windows Spell Checking API (`ISpellCheckerFactory` and `ISpellChecker`). One Rust thread owns the Component Object Model (COM) objects in the multithreaded apartment and serves the commands over a channel. A range is an error only if every enabled language flags it. The personal dictionary lives in `settings.json`, so it belongs to the person. Words in all capitals and words with digits are skipped by default.
2. Draw squiggles with one CSS Custom Highlight (`type = 'spelling-error'`) on static and mounted blocks alike. Cache results by each textblock's text and the languages, check the textblocks in view first and the rest in idle time, and check typed text after typing pauses for 500 ms. The word at the caret isn't flagged until the caret leaves it. F7 and the spelling menu always work, whatever S1 finds.
3. Read aloud with the Web Speech API, filtered to voices whose `localService` is true, never falling back to an online voice. One utterance is one paragraph, and `boundary` events drive a CSS Custom Highlight on the spoken word.

## Spike results

**S2: Web Speech in WebView2's engine.** `spikes/phase4/s2-speech/probe.mjs` drives the installed Edge 154, the engine WebView2 154 uses, on Windows 11 (10.0.26200). It wrote `spikes/results/s2-speech.json`:

| Question | Result |
|---|---|
| Local voices | 3 (Microsoft David, Mark, and Zira, English (United States)), all with `localService` true |
| Word boundaries | 16 `word` events for the 16 words of the test sentence, with `charIndex` and `charLength` |
| Pause and resume | `pause()` set `paused` true, though in two headless runs 1 and 3 boundaries still arrived during the 1.5-second pause; `resume()` went on to the end |
| End | `end` fired once, with no error |

So read aloud uses Web Speech, and the Rust fallback over `Windows.Media.SpeechSynthesis` isn't built. The `speech_*` commands stay stubs that answer `notImplemented`. Headless Edge has no audio device, so the late boundaries may be text the engine had already rendered; the nightly `page.readAloud` spec checks inside the app's own WebView2, with audio, that the highlight holds while paused. If it doesn't, the fallback is the answer.

**S1: screen readers and highlight types.** Not measured yet: this machine has no NVDA, and Narrator needs a person listening. `spikes/phase4/s1-highlights/page.html` is the test: a paragraph with two misspellings marked by the highlight alone, and a checkbox that adds the `aria-invalid="spelling"` fallback. Until it runs, mounted editors don't add the fallback decorations. Keyboard and screen reader users reach every error through F7, which selects the word and announces it with its first suggestion.

## Options considered

| Option | For | Against |
|---|---|---|
| Windows Spell Checking API in Rust, with highlights (chosen) | Several languages, our own dictionary, nothing on the typing path, squiggles before editors mount | About 300 lines of Rust and a scheduler; screen reader reporting of highlight types needs a check (S1) |
| WebView2's built-in checker | No code | One language, no dictionary control, no API, and nothing on static blocks |
| ProseMirror decorations only | `aria-invalid` is well supported | Decorations change the document object model (DOM) and exist only in mounted editors |
| A JavaScript spell checker with bundled dictionaries | Works everywhere | Megabytes of dictionaries per language, and it ignores the languages people installed |
| Web Speech with local voices (chosen) | No Rust code; the browser plays audio and reports word boundaries | Boundary support depends on the voice; online voices must be filtered out |
| `Windows.Media.SpeechSynthesis` in Rust | Exact word timing | Synthesis, audio transfer, and a player; kept as the fallback S2 didn't need |

## Consequences

- Easier: spell check follows the languages Windows has and people's own words; read aloud never sends text anywhere; both sit behind small interfaces (`SpellingClient`, `SpeechEngine`) that other platforms can implement with their own services.
- Harder: we own the spelling menu, F7 navigation, and the personal dictionary settings; the highlight ranges must stay in step with edits.
- Follow-up: run S1 with NVDA and Narrator, and add the `aria-invalid` decorations to mounted editors if either stays silent.
- Revisit if WebView2 gains a spell-check API with language and dictionary control, if S1 fails, or if Windows changes the spelling or speech services. The Phase 4 owner checks after each WebView2 major update.
