# OpenNote beta 4 (0.1.0-beta.4): hand test checklist

Agents only started this exe and opened each main entry point once. Everything below is untested by hand.
This exe was built from commit `907d90f1` (the pushed branch head adds only these docs).
Tick each step; when one fails, stop that section, report it (see "Reporting a failure"), and go on to the next section.

## Contents

- [Before you start: run with a throwaway profile and notes folder](#before-you-start-run-with-a-throwaway-profile-and-notes-folder)
- [Reporting a failure](#reporting-a-failure)
- [1. Riskiest first](#1-riskiest-first): save and restart, ink with the palm down, export, recording
- [2. Shell](#2-shell-phase-2), [3. Storage](#3-storage-phase-3), [4. Typed notes](#4-typed-notes-phase-4)
- [5. Ink](#5-ink-and-palm-rejection-phase-5-the-rest), [6. Page views and export](#6-page-views-and-export-phase-6)
- [7. Smart tables and charts](#7-smart-tables-and-charts-phase-7), [8. Search and links](#8-search-and-links-phase-8)
- [9. Audio](#9-audio-phase-9-the-rest), [10. Math and the grapher](#10-math-and-the-grapher-phase-10), [Study tools](#study-tools)
- [11. Import and export](#11-import-and-export-phase-11), [12. On-device intelligence](#12-on-device-intelligence-phase-12)
- [13. Hardening and privacy](#13-hardening-and-privacy-phase-13), [The brand look](#the-brand-look), [Connectors](#connectors)

## Before you start: run with a throwaway profile and notes folder

Your real notes stay safe if you do this every time you test beta 4:

1. Make a test folder and copy the exe into it (setup's Start menu option moves the file it was started from):

   ```powershell
   $t = "$env:TEMP\OpenNote-beta4-test"; New-Item -ItemType Directory -Force $t | Out-Null
   Copy-Item "$HOME\Downloads\OpenNote_Windows64.exe" $t
   $env:OPENNOTE_PROFILE_DIR = $t; & "$t\OpenNote_Windows64.exe"
   ```

2. Windows SmartScreen warns (the exe is unsigned): choose **More info**, then **Run anyway**.
3. In setup, keep the proposed notes folder. With `OPENNOTE_PROFILE_DIR` set it is inside the test folder
   (`...\OpenNote-beta4-test\Documents\OpenNote`), never your real Documents. Settings, caches, and the log are in
   `...\OpenNote-beta4-test\local` and `...\roaming`.
4. To start again from nothing: quit OpenNote and delete `%TEMP%\OpenNote-beta4-test`.
5. Always start the test copy from a PowerShell window where `$env:OPENNOTE_PROFILE_DIR` is set (step 1's last line).

## Reporting a failure

- The log: `%LOCALAPPDATA%\OpenNote\logs\opennote.log` for a normal run; for the test profile it is
  `%TEMP%\OpenNote-beta4-test\local\logs\opennote.log`. Attach it.
- In the app: **Help > Send feedback** (or Ctrl+K, type "feedback"). It builds a file with the log and a self-check,
  with note titles removed; save it and attach it.
- Say which step number failed, what you did, what you expected, and what happened. A screenshot helps.

---

## 1. Riskiest first

### 1a. Save and restart (Phase 3 storage)

1. Finish setup. A notebook, a section, and a page appear. The status reads "Saved".
2. Type a heading, a bulleted list, a paragraph with **bold** (Ctrl+B), and a checklist item. Wait for "Saved".
3. Make a second page (**New page** in the page list, or Ctrl+N). Check the new page shows only the title and a
   gray "Changed ..." subtitle under it, and **no** separate date text box on the page.
4. Rename the first page in the page list (F2). The big heading changes to match. Type in the heading: the list name changes.
5. Close the window (Alt+F4) right after typing a few more words, without waiting.
6. Start the test copy again. Both pages, the rename, and every word you typed (including the last ones) are there.
7. Delete a page (right-click > Delete), open **Trash** (bottom of the notebook list), choose **Restore**. It is back.
8. Open the notes folder in File Explorer: one folder per notebook, with `page.md` files you can read.

### 1b. Ink with a real pen while your palm rests on the screen (Phase 5)

1. Open the **Draw** tab. Pick a pen. Rest the side of your hand on the screen and write a line with the Surface Pen.
   Only the pen writes; your palm leaves no marks and does not scroll or select.
2. Write fast and slowly; the line follows the pen with no gaps and pressure changes the thickness.
3. Lift your hand, touch the page with one finger: it scrolls (it does not draw unless touch drawing is on).
4. Use the pen's eraser end (or the Eraser tool): stroke eraser removes whole strokes; partial eraser cuts strokes.
5. Lasso a few strokes, move them, then Ctrl+Z and Ctrl+Y. Undo and redo put them back and forward.
6. Draw a rough rectangle and hold the pen still at the end: it becomes a clean shape.
7. Close and restart: the ink is still there in the same place.

### 1c. Export (Phases 6 and 11)

1. On a page with text, a picture, and ink, open **Share > Export...** (or Ctrl+K, "export").
2. Export as PDF (from the page's Export / Print): the PDF opens, has the text (you can select it), the ink, and the
   picture, at the right page size.
3. Export the page as Markdown, as Word (.docx) and as single-file HTML. Open each file; text, headings, and pictures
   are there. (The PDF choice in the Import/Export dialog's format list is hidden on purpose in this build.)
4. **Print** (Ctrl+P): the print preview shows the page as it looks on screen.

### 1d. Recording (Phase 9)

1. Ctrl+K, "Start recording" (or the **Record** button). Allow the microphone if Windows asks.
2. Speak and type notes for 30 seconds, then stop. A recording block appears on the page.
3. Play it: you hear yourself. Tap a word you typed during the recording: playback jumps to that moment.
4. Trim the start of the recording; play again.
5. Close the app while a second recording is running. Restart: the app offers to recover it, and it plays.

---

## 2. Shell (Phase 2)

1. Resize the window from wide to narrow and back. The panes follow, nothing is cut off, and no horizontal scroll bar
   appears under the page, at full width too (it did on a 150 percent display; fixed in this build).
2. Drag each pane splitter (notebook list, page list) left and right. The page area follows. Restart: the widths stay.
3. Ctrl+K opens the command palette; type "settings" and press Enter. Settings opens. Escape closes it.
4. Zoom with Ctrl+= and Ctrl+-; Ctrl+0 resets.
5. Snap the window to half the screen (Win+Left). The layout switches to the compact one without overlapping parts.

Quality-of-life features in this build (shell lane):

1. Select several pages: Ctrl+click two pages in the list. Delete or move them together.
2. Pin, sort, duplicate, copy, and archive: right-click a page, choose **Pin**; it moves to the top. Try **Duplicate**,
   **Copy to...**, **Archive**, and the **Sort** menu above the page list.
3. Tabs and windows: middle-click (or right-click > Open in new tab) a page. Ctrl+Tab switches tabs. Close one with
   Ctrl+W and reopen it with Ctrl+Shift+T.
4. Focus mode (Ctrl+K, "Focus mode"): the panes hide; Escape brings them back.
5. Window modes: Ctrl+K, "Mini window" (stays on top) and "Dock" (to a screen edge).
6. Quick capture: Ctrl+K, "Quick capture": a small window; type a note and save it; it lands in the notebook.
7. Home page: Ctrl+K, "Home": recent and pinned pages.
8. Scheduled backups: Settings > Backups (or Ctrl+K "backup"): set a schedule, run one now, find the backup file.
9. Edits from other apps: edit a page's `page.md` in Notepad and save; the page in OpenNote updates (or offers a
   side-by-side conflict if you edited the same page in both).
10. Open a notebook from any folder: Ctrl+K, "Open notebook folder", pick a folder elsewhere.
11. Check notebook: Ctrl+K, "Check notebook": it reports no problems on a healthy notebook.
12. Low-power mode, page shortcuts, and jump list, OneNote shortcut set, accessibility checker: each is in Ctrl+K by
    name; open each once.
13. Portable mode: put an empty file named `portable` next to the exe and start it (without `OPENNOTE_PROFILE_DIR`):
    settings and caches go beside the program. (Delete that file afterwards.)
14. The tree **Sort** menu was stopped mid-feature: check it does not break the tree.

## 3. Storage (Phase 3)

1. Copy the whole test notes folder somewhere else, start a second throwaway profile pointed at the copy (setup's
   "choose folder"): the notebooks and pages are all there.
2. Open the same page in two tabs or windows and type in one: the other updates.
3. Page history: right-click a page > **Page history**. Restore an older version.
4. Make a section group and move a section into it; move a page to another notebook (drag, or right-click > Move).

## 4. Typed notes (Phase 4)

1. Type `/` on an empty line: the slash menu opens; insert a table, a code block, a callout, a divider, a date.
2. Headings (Ctrl+Alt+1, 2, 3), lists, checklist, quote, code with highlighting, links (Ctrl+K inside text if offered,
   or the Insert tab).
3. Paste a picture and text from a web page. Paste a screenshot (Win+Shift+S then Ctrl+V).
4. Spell check marks a misspelled word; right-click offers fixes.
5. Fold a heading's outline (the arrow beside it) and unfold it.
6. Read aloud: select text, Ctrl+K "Read aloud".

Quality-of-life features (typed-notes lane):

1. Reading lock: Ctrl+K "Lock page": typing and ink are blocked until you unlock.
2. Word count and reading time: shown in the status bar or Ctrl+K "Word count".
3. Find on page (Ctrl+F) and Replace (Ctrl+H).
4. Table of contents pane: Ctrl+K "Contents": it lists headings; click one to jump.
5. Checklist extras: Ctrl+Enter toggles an item; "Check all"; finished items move down; counts show.
6. Caret extras: Settings > Typing: thicker caret, typewriter scrolling (off by default), screenshot paste size.
7. Page templates and series pages: New page from a template; "Next in series" makes the next numbered page.
8. Alt text draft: right-click a picture with text in it > Alt text: a first draft is filled in.
9. Extract, merge, and split pages: select blocks > "Extract to new page"; select two pages > "Merge".
10. Wrap text around images in flow pages: picture > Wrap > Left/Right.
11. Attachments that save back: drop a .docx on a page, open it, edit it in Word, and save; the page's copy updates.
12. Drag and drop files, PDFs and links onto a page.
13. Markdown source view: Ctrl+K "Markdown source": edit the source; the page updates.
14. Page embeds: type `![[` and pick a page: its content shows inline.
15. Link titles on paste: paste a web address; it becomes the page's title (Settings > Privacy lists the sites asked).

## 5. Ink and palm rejection (Phase 5), the rest

1. Try the highlighter, each pen color and width, and the ink color in dark mode.
2. Shapes: line, arrow, circle; with shape snapping off they stay freehand.
3. Ink on top of typed text, scrolling with the page.
4. Docs: `docs/testing/palm-rejection.md` has the full palm test.

Quality-of-life features (ink lane):

1. Eraser and lasso filters (erase only highlighter, select only ink); pen hover circle shows where the pen will
   write; canvas lock; Describe drawing (alt text for ink).
2. Pen gestures: scribble over words to erase; circle then tap to select; two-finger double tap undoes, three-finger
   double tap redoes. Per-pen buttons, pressure curves, and the steady pen in Settings > Pen and touch.
3. Insert space tool: drag down to push everything below further down. Ruler, protractor, snap to grid.
4. More shapes: polygon, star, arc, curved, and double arrows; hold then reshape.
5. Shape handles, attached connectors (move a shape, the arrow follows), shape libraries, text in shapes.
6. Ink replay: Ctrl+K "Replay ink": a play bar with a slider and speeds; with a recording, audio plays along.
7. Handwriting tools: lasso handwriting > Convert to text, Straighten, Even spacing; the writing pen converts as you write.
8. Draw a grid with the pen: it becomes a table. Pen editing of typed text: strike through a typed word to delete it.
9. Zoom writing box: Ctrl+K "Zoom writing box": write big, it lands small on the line.
10. Ink stays with its text: write beside a word, then add text before it: the ink follows the word.

## 6. Page views and export (Phase 6)

1. View > Page view: switch between flow, paginated (Letter/A4), and infinite canvas.
2. Paper: View > Background > Lined. Type three lines: letters sit just above the rule beneath them, with no rule
   cutting through text. Try Grid and Dotted too.

Your requests in this build (owner fixes):

1. New page: only the title and the gray "Changed ..." subtitle; no date text box. "Next in series" pages too.
2. Lined paper: letters sit just above the rule beneath them, the rules begin below the page title, and highlights
   and inline code leave the rule visible. Check the title and the "Changed" date under it (Grid and Dotted too),
   body text, a heading, a bulleted list, and a checklist; the rules are a whole number of units apart. A checklist
   item shows one checkbox and no second box beside it (a stray one showed in the earlier build). Highlight a word
   and make another word inline code: each colored box ends above the rule under its line. Change the line spacing
   (View > Paper > spacing): the text follows the new rules.
3. Text boxes on lined paper: click on the canvas to make a text box, type two lines, drag it up, and down: it moves
   rule to rule and its text stays on the rules. Nudge it with the arrow keys: one rule per press. Drag its width
   handle narrower: the text rewraps and the box grows by whole rules.
4. Print or export the lined page as PDF: the text sits on the rules there too (only checked in code, not printed).
5. Resizing: drag both pane splitters, then make the window narrow (half the screen) and wide again: the page area
   shrinks and grows with it, with no sideways scrolling into an empty strip.
6. Present as slides (Ctrl+K "Present"): arrow keys move; Escape ends.
7. Gallery view of a section, reading aids (line focus, colors), the immersive reader.

Quality-of-life features (pages lane):

1. Layout presets: lab notebook, planner, storyboard, custom line spacing; set one as the notebook default; save a layout.
2. Sheet navigator: in the paginated view, the strip of sheets at the side; click to jump.
3. Accessible PDF export: tags, a language, and bookmarks from the headings (check in a PDF reader's bookmarks pane).
4. Elements library: select something > Save as element; insert it from the Elements pane.
5. Lasso selection: Export or copy as PDF, PNG, SVG, Word, or an image.
6. Present a whole page with a laser pointer (hold the pen button) and ink that fades.
7. Syllable marks in the reading view.

## 7. Smart tables and charts (Phase 7)

1. Insert > Smart table. Add columns of type number, date, choice; sort and filter.
2. Insert a chart from the table; change its type; edit a number: the chart updates.

Quality-of-life features (tables lane):

1. Calculated columns: add a column with a formula (`=Price * Qty`).
2. Board, calendar, gallery, and timeline views of a smart table.
3. Accessible charts: Tab to a chart; a screen reader (Narrator, Win+Ctrl+Enter) reads its summary; there is a data table.

## 8. Search and links (Phase 8)

1. Ctrl+Shift+F: search panel. A word typed a minute ago is found; `in:` limits to a notebook.
2. Ctrl+K quick switcher: type part of a page name, Enter opens it.
3. Type `[[` and pick a page: a link. Open the target page: its Backlinks list shows the first page.
4. Tags: type `#todo`; the tag is listed and searchable.

Quality-of-life features (search lane):

1. Paragraph links (right-click a paragraph > Copy link) and `opennote://` links from another app.
2. Line tags and the Tags pane.
3. Daily note (Ctrl+K "Daily note") and the daily notes calendar.
4. Replace across notebooks (Ctrl+K "Replace in all notebooks"): preview, then replace.
5. Text read from pictures shows up in search (paste a screenshot with words, wait a minute, search a word in it).
6. Page properties, collections, graph view, and the Connections list, the canvas of cards.
7. Some of this lane was stopped mid-feature: report anything half-done.

## 9. Audio (Phase 9), the rest

1. Record system audio (play a video while recording with "Include computer audio").
2. Flags on the timeline (mark a moment while recording).

Quality-of-life features (audio lane):

1. Tap a stamped word with the pen or a finger: that moment plays.
2. Settings > Recording section.
3. Split a recording; remove an off-the-record part; voice enhancement; export a recording as audio.
4. Recording storage list: compress one, remove the audio but keep the transcript.
5. Meeting prompt: start a Teams or Zoom call: OpenNote offers to record.
6. Snap the screen while recording; drop an audio or video file on a page: it becomes a recording.
7. Transcripts: transcript block, speakers (rename one), lines to notes, action items, chapters, copy meeting recap.

## 10. Math and the grapher (Phase 10)

1. Type `$x^2$` (or Insert > Math): it renders. Edit it.
2. Insert > Graph: plot `y = sin(x)`; pan and zoom.
3. Math actions: select an equation > Solve / Simplify.

Quality-of-life features (math lane):

1. Quick math: type `12*7=` in text: the answer appears.
2. Math on page lines with variables and units; "Graph this".
3. Mind maps (turn an outline into a map and back) and diagrams from Mermaid text.

## Study tools

1. Flashcards: Insert > Flashcards; card types (fill in the blank, multiple choice, image occlusion); inline
   cards (`Q :: A`, `{{blank}}`); review them; set an exam date.
2. Anki: import an `.apkg` deck and export one; CSV import and export.
3. Study tape: cover part of a page; press it to show.
4. Unit converter and reference tables tools (Ctrl+K "Unit converter", "Reference tables"): open as tool windows.
5. Upcoming: exams, classes (import a calendar `.ics` file), repeating to-dos, due date chips on checkboxes, reminders
   with a Windows notification.
6. Citation helper: BibTeX, RIS, and Zotero.
7. Timers, Calculator: tool windows open, work, and close.

## 11. Import and export (Phase 11)

1. Ctrl+K "Import": import an Obsidian vault or a folder of Markdown files; the notebook appears with its pages.
2. Import a Word file; export a section as Markdown.

Quality-of-life features (import lane):

1. Import .odt, .xlsx (as table pages), .pptx (one page per slide), .eml (with attachments), Kindle clippings
   (`My Clippings.txt`) and Readwise CSV.
2. Export tables as .xlsx and .csv; export pages as a PowerPoint file.
3. Read pictures from Windows Sticky Notes.
4. Import dialog: **Save report** button.
5. The Import step in first-run setup (start with a fresh test folder to see it).
6. Snipping Tool: take a screenshot with Win+Shift+S: OpenNote offers to add it to the open page.
7. Send copies to favorite folders, then "Update the copy" after editing.
8. Share as a file was stopped mid-feature: try it once and report what happens.

## 12. On-device intelligence (Phase 12)

Each feature is off until you turn it on in Settings > Privacy and smart features.

1. Text in pictures (OCR): turn it on; right-click a picture > Copy text from picture.
2. Read aloud with Windows voices; summaries of a page.
3. Handwriting to text: write a word, lasso it, Convert to text.

Quality-of-life features (intel lane):

1. Model downloads with consent: the app asks before downloading; Settings lists models and their sizes.
2. Smart features step in first-run setup.
3. Background work controls: the activity panel; new pictures are read in the background.
4. Tidy handwriting and review unsure words.
5. Custom transcript vocabulary per notebook.
6. Search by meaning and a Related pages list.
7. Ask your notes (Ctrl+K "Ask"): the answer lists the pages it used.
8. Writing tools: select text > proofread, rewrite, shorten, make a list, tidy.

## 13. Hardening and privacy (Phase 13)

1. Settings > Privacy: Work offline: on, then Help > Check for updates says it is offline.
2. Help > Check OpenNote (self-check): all checks pass.
3. Help > Send feedback: save the file; open it; no note titles or text in it.
4. Crash reports: Settings > Privacy > Crash reports: the consent screen; "Show an example".
5. Safe start: the offer appears only after two crashes in a row (hard to test by hand; skip unless it happens).

## The brand look

1. Setup's look step: choose each look; the app's colors, paper, and drawings change.
2. Light and dark (Settings > Appearance): every pane, menu, and dialog is readable in both.
3. The empty states (no notebook, empty section, empty search) show the drawings.

## Connectors

The build ships with no client IDs, so Microsoft, Google, Slack, Dropbox, Box, and Vimeo say "Needs setup" until you
add your own app registrations (`docs/CONNECTORS.md` says where to register and how: a `connectors.json` file in the
data folder, which for the test profile is `%TEMP%\OpenNote-beta4-test\local`). Readwise, Canvas, and Moodle take a
personal token and work without setup.

1. Settings (Ctrl+,) > **Connectors**: the page opens with a card per service; the six above say "Needs setup".
2. Readwise: choose **Connect**, paste your Readwise access token: the card shows your account as connected.
3. Restart: it is still connected. Open Windows **Credential Manager > Windows Credentials**: an entry named
   `OpenNote/readwise/...` holds the token; no file in the test folder contains it.
4. Settings > Privacy: **Work offline** on, then try Connect on a card: it is refused while offline. Turn it off.
5. **Disconnect**: the card shows not connected and the Credential Manager entry is gone.
6. Help > Send feedback: save the file and search it for your token: it is not there.
7. Add a `connectors.json` with a Microsoft or Google client ID: the card changes to **Connect** without a restart.
   Connect opens the sign-in page in your default browser, never inside the app. After sign-in, the browser tab says it
   can be closed, and the card shows your account.
