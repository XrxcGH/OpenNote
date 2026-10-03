# Spike S6: text input in WebView2

Owner: WP2. Phase 4 ARCHITECTURE.md section 10.4 and PLAN.md section 6.4 ask for this check.

## What it proves

Every way Windows types into a page ends as one undo step, and nothing reaches the core mid-composition. The text sync holds typing while `view.composing` is true. It sends the committed text as one typing batch 150 ms after `compositionend`.

## Automated part

`app/src/features/page/sync/ime.test.tsx` composes a Japanese word in Chromium through the DevTools Protocol. It uses `Input.imeSetComposition` and then `Input.insertText`. The page service gets no batch during the composition and one typing batch after it.

## Manual checklist

Run each row in the installed app on Windows 11, in a text box on a page. Then press Ctrl+Z once.

| Input | Steps | Expected | Result |
|---|---|---|---|
| Microsoft Japanese IME | Type `nihon`, convert with Space, commit with Enter | 日本 appears; one Ctrl+Z removes it | Not run yet |
| Microsoft Pinyin | Type `zhongwen`, pick 中文 with 1 | 中文 appears; one Ctrl+Z removes it | Not run yet |
| Microsoft Korean IME | Type 한국 with the 2-set layout | 한국 appears; one Ctrl+Z removes it | Not run yet |
| Emoji panel | Win+., pick 😀 | 😀 appears; one Ctrl+Z removes it | Not run yet |
| Touch keyboard suggestions | Tap letters, then a suggestion | The suggestion replaces the word; one Ctrl+Z | Not run yet |
| Voice typing | Win+H, say "hello world period" | "Hello world." appears; one Ctrl+Z removes it | Not run yet |
| Voice Access dictation | Dictate a sentence | The sentence appears; one Ctrl+Z removes it | Not run yet |
| Pen handwriting panel | Write a word in the panel, insert it | The word appears; one Ctrl+Z removes it | Not run yet |
| Pen in a plain field | Write in the palette's search field | The palette searches for the word | Not run yet |

For each row, also check that no shortcut fires mid-word, and that the page reloaded after a restart still has the text.

## Results

The automated check passes. The manual rows need a person with each input method. Record the date, the WebView2 version, and an issue link for any row that fails.

Owner decision 4 (ARCHITECTURE.md section 28.3) waits on the pen rows: whether a later setting should offer in-place handwriting on the page.
