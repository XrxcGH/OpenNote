# OpenNote feature specification

This spec lists what OpenNote does, beyond the basics in [DEVELOPMENT.md](DEVELOPMENT.md). Each feature notes the phase that builds it.

## Contents

- [Office and Google Workspace](#office-and-google-workspace)
- [Video and audio platforms](#video-and-audio-platforms)
- [More integrations](#more-integrations)
- [Handwriting to text](#handwriting-to-text)
- [Shapes and lines](#shapes-and-lines)
- [Transcripts and summaries](#transcripts-and-summaries)
- [Study tools](#study-tools)
- [Page layouts](#page-layouts)
- [Export a selection](#export-a-selection)
- [On-device intelligence setup](#on-device-intelligence-setup)
- [Quality-of-life fixes](#quality-of-life-fixes)
- [More quality-of-life features by phase](#more-quality-of-life-features-by-phase)

## Office and Google Workspace

Import and export (Phase 11):

| App | Import | Export |
|---|---|---|
| Word / Google Docs | `.docx`, `.odt`, Google Docs | `.docx`, Google Docs, PDF |
| Excel / Google Sheets | `.xlsx`, `.csv`, Google Sheets into smart tables | `.xlsx`, `.csv`, Google Sheets |
| PowerPoint / Google Slides | `.pptx`, Google Slides as annotatable pages | `.pptx` (one page per slide), PDF |
| OneNote / Evernote | Graph API, `.enex` | PDF, Markdown |

Linked accounts (Phase 11):

- People can link Google and Microsoft accounts in Settings. Sign-in uses the provider's own secure page (OAuth), and tokens are stored in Windows Credential Manager.
- The "Send to" menu converts a page, section, or selection to PDF, Word, or Google Docs, then uploads it to a chosen Google Drive or OneDrive folder. It all happens inside OpenNote.
- Favorite destinations are saved, so "Send to Drive: Biology/Lab reports" becomes one click.
- A page can stay linked to its exported copy and offer "Update the Drive copy" after edits.
- Linking is optional. Nothing is uploaded without an explicit action.

## Video and audio platforms

(Phase 9)

- Paste a YouTube, Vimeo, or podcast link to embed a player. Notes taken while it plays are time-stamped to the video, like audio recordings.
- Transcripts come from the platform's captions when available, or from on-device transcription of audio the person has the right to use.
- Recordings can be exported as audio or as a narrated video of the page, and uploaded to a linked YouTube account as private or unlisted.

## More integrations

(Phase 11 unless noted)

| Integration | What it does |
|---|---|
| Outlook and Google Calendar | Opens a meeting note from any event, filled in with the title, time, attendees, and agenda |
| Teams, Zoom, and Google Meet | Records meeting audio without a bot (Phase 9) and links the note back to the calendar event |
| Microsoft To Do and Google Tasks | Two-way sync of checkboxes, due dates, and reminders |
| Outlook and Gmail | "Save to OpenNote" from an email keeps the text and attachments with a link back |
| Web clipper for Edge, Chrome, and Firefox | Clips a full page, a region, or a clean article into any section |
| Windows share target and Snipping Tool | "Share to OpenNote" from any app, and screenshots go straight to the current page |
| Phone camera | Scan a QR code shown in OpenNote to send photos and document scans from a phone |
| Zotero and BibTeX | Cite sources while writing and export a bibliography in any common style |
| Canvas, Moodle, and Google Classroom | Import assignments into a section and submit a page as PDF |
| Desmos, GeoGebra, Figma, Miro, and Lucidchart | Live embeds that fall back to a static image offline |
| Kindle and Readwise | Import book highlights into a notebook |
| Slack and Teams chat | Share a page as a link, PDF, or image |
| Dropbox, OneDrive, iCloud Drive, Box, and WebDAV | Sync folders and "Send to" destinations |
| Webhooks and a local API | Connect Zapier, Power Automate, or scripts to create pages and export files |
| AI assistants (Model Context Protocol, MCP) | Lets an assistant the person chooses read or write notes, only with permission |

## Handwriting to text

(Phase 5 and Phase 12)

- A "Writing pen" converts handwriting to typed text as the person writes, with the original ink kept one tap away.
- Math is recognized as math: subscripts, superscripts, fractions, roots, integrals, matrices, and Greek letters become editable equations.
- Special characters (°, ±, →, ≤, µ) and chemistry notation such as H₂O are kept.
- Unsure words are underlined; tapping one shows alternatives.
- Any existing ink can be converted later with the lasso.

## Shapes and lines

(Phase 5)

- Draw a rough shape and hold still for half a second. It snaps to a clean circle, ellipse, rectangle, triangle, polygon, star, or arrow.
- Keep holding and move to resize or rotate it before lifting the pen.
- Straight lines, arcs, curved arrows, and double arrows snap the same way. Lines snap to 15° steps near horizontal and vertical.
- Shapes keep editable handles, and connectors stay attached when shapes move.

## Transcripts and summaries

(Phase 9 and Phase 12)

- Every recording gets a transcript automatically, with a one-paragraph summary at the top.
- Each line starts with a timestamp. Clicking a line or its time jumps playback to that moment.
- Different voices are labeled Speaker 1, Speaker 2, and so on. Renaming a speaker once ("Dr. Patel") updates the whole transcript, and saved names are suggested in later recordings.
- Transcripts are searchable and can be edited to fix mistakes.

## Study tools

(Phase 10)

- Flashcard and quiz blocks can be embedded in any page.
- Make them by hand, or generate them from a page, a section or a recording's transcript.
- Card types: question and answer, fill-in-the-blank, multiple choice, and image occlusion (hide part of a diagram).
- A spaced-repetition schedule shows which cards are due. Decks export to Anki and CSV.

## Page layouts

(Phase 6)

Presets, set per page, or as a notebook default:

- Plain (no lines), infinite or paginated.
- Ruled: narrow (6 mm), college (7 mm), wide (8.7 mm) and custom.
- Grid: 5 mm, 1/4 in, 1 cm, and custom. Dot grid and isometric.
- Cornell notes, lab notebook, music staff, planner, and storyboard.
- Custom templates can be saved and shared.

## Export a selection

(Phase 6)

- Lasso any area, then choose "Export selection" to save it as PDF, PNG, SVG or `.docx`, or copy it as an image.
- Smart select grows the lasso to include whole strokes, text boxes and images that it only partly touches, and trims empty margins.
- This works for annotated images: import a photo, draw on it, and export just that part.

## On-device intelligence setup

First-time setup has a step for it, instead of leaving everything off. The step offers three choices:

1. **Recommended:** transcription, handwriting recognition, text in images (OCR) and summaries, all running on this device.
2. **Custom:** pick each feature, and choose a local model or your own cloud key.
3. **Not now:** everything stays off and can be turned on later in Settings.

The step shows the download size of each model and states that nothing leaves the device.

## Quality-of-life fixes

These answer known complaints about other note apps:

- **Versions and trash:** page history, and a trash that keeps deleted items for 30 days.
- **Clean paste:** pasting from the web keeps structure but drops stray fonts and colors. Ctrl+Shift+V pastes plain text.
- **Speed:** large notebooks open lazily, and nothing freezes while syncing.
- **Content locks:** text boxes and images can be locked in place.
- **Sections and pages:** can be pinned, colored, sorted, and duplicated.
- **Links:** internal links survive renames and moves.
- **Tabs and windows:** open several pages side by side in tabs or windows.
- **Snap tools:** a ruler, protractor, and snap-to-grid for neat diagrams.
- **Offline:** everything works offline, and conflicts are shown side by side, never silently overwritten.
- **Export:** a whole notebook exports in one step, so data is never locked in.

More quality-of-life features:

| Feature | What it does |
|---|---|
| Quick capture | A global shortcut opens a small note window from anywhere in Windows |
| Daily note | One tap opens today's page, created from a template |
| Focus mode | Hides panes and toolbars; the page stays centered |
| Reading mode | Locks the page against accidental edits and ink |
| Find and replace | Works on one page or a whole notebook, including handwriting that has been recognized |
| Word count and reading time | Shown for the page or a selection |
| Table of contents | Built from headings, pinned to the side of long pages |
| Recently closed | Reopen closed pages and tabs with Ctrl+Shift+T |
| Mini window | Keep a page on top of other apps while watching a lecture or a video |
| Remember position | Each page reopens at the same scroll, zoom, and view |
| Drag and drop | Drop files, images, PDFs, and links from anywhere |
| Copy text from images | Select text inside any image or scanned PDF |
| Reminders | Due dates on checkboxes, with Windows notifications |
| Presentation mode | Full-screen pages with a laser pointer and ink that fades |
| Print preview | Shows exactly what prints, with page breaks |
| Spell check | Several languages at once, and a personal dictionary |
| Pen settings sync | Pens, colors, and toolbars follow the person to every device |
| Low-power mode | Reduces animations and background work on battery |
| Shortcut cheat sheet | Ctrl+/ shows every shortcut, and each one can be changed |
| Password-protected sections | Encrypted on disk, unlocked with Windows Hello |

## More quality-of-life features by phase

These features answer requests from people switching from OneNote, Goodnotes, Obsidian, and other apps, and from people who use assistive technology. Each table belongs to a phase in [DEVELOPMENT.md](DEVELOPMENT.md#5-phases). All of them work offline and need no account.

### Phase 2: App shell and navigation

| Feature | What it does |
|---|---|
| Subpages and section groups | Pages can sit under a parent page, 2 levels deep as in OneNote, and fold away with it. Sections can be gathered into section groups, which can nest. Ctrl+Alt+Shift+N adds a subpage, and Ctrl+Alt+] and Ctrl+Alt+[ move a page one level in or out. |
| Back and forward | Alt+Left, Alt+Right, the mouse side buttons, and toolbar arrows step through visited pages, including jumps from links and search. Each step returns to the earlier scroll position. A breadcrumb above the page shows the notebook, section, and page, and "Reveal in tree" selects the open page in the tree. |
| Quick switcher | Ctrl+O finds a page by name, with recent pages first. Enter opens it, and Ctrl+Enter opens it in a new tab. If nothing matches, Enter creates a page with that name in the current section. |
| OneNote shortcuts | Setup offers a "OneNote" shortcut set, so switchers keep their habits, such as Ctrl+1 to Ctrl+9 for tags, Ctrl+Alt+1 to 6 for headings, and Ctrl+E to search. Where the two sets clash, this set keeps OneNote's meaning. The shortcut list shows where the other command went. In both sets, Ctrl+K adds a link when text is selected and opens the command palette otherwise. |
| Interface size | Scales sidebars, toolbars, and menus from 90% to 150% without changing the page zoom. A "Large targets" option uses touch-size controls with a mouse. |

### Phase 3: Document model and storage

| Feature | What it does |
|---|---|
| Scheduled backups | Copies notebooks on a schedule, from hourly to weekly, to a folder the person picks, such as a USB drive or a second disk. Only changed files are copied, and daily, weekly, and monthly copies are kept. Protected sections stay encrypted in the copy. Settings shows when the last backup ran. Any backup opens read-only, so single pages or sections can be copied back. |
| Edits from other apps | OpenNote watches the notes folder and reloads pages that other programs change, such as Git, Syncthing, or a script. It never overwrites those changes silently. If someone edits `page.md` in another editor, OpenNote offers to bring the text changes into the page. |
| Notes in OneDrive or Dropbox | Setup and Settings notice when the notes folder is inside OneDrive, Dropbox, iCloud Drive, or Google Drive. They explain what that means and offer "Always keep on this device" for that folder. Conflict copies from those services open in the side-by-side conflict view instead of showing up as duplicate pages. Files stored only in the cloud download before they open, so a page never looks empty. |

### Phase 4: Typed notes

| Feature | What it does |
|---|---|
| Editable text styles | Normal text, Heading 1 to 6, Page title, Quote, and Code can each have their own font, size, color, and spacing in each notebook. Changing a style updates existing pages too. Headings stay real headings for screen readers and the table of contents. |
| Slash menu | Typing "/" at the start of a line opens a filtered list of blocks, such as heading, checklist, table, callout, and code. "Turn into" changes the current block to another type without retyping it. The menu never opens inside links, code, or math, and it can be turned off. |
| Outline moves and folding | Alt+Shift+Up and Alt+Shift+Down move the current paragraph or list item, with everything under it. Alt+Shift+Left and Alt+Shift+Right change its level. Headings and list items fold with a chevron. Alt+Shift+1 to 9 show the outline down to that level, and Alt+Shift+0 shows all of it. Search results and links unfold what they point to. |
| Typing helpers | A personal AutoCorrect list fixes typos, expands abbreviations, and turns "->" into "→". Alt+Shift+D, Alt+Shift+T, and Alt+Shift+F insert the date, the time, or both, as in OneNote. New pages show an editable date and time under the title. One Ctrl+Z undoes any automatic change, and each helper can be turned off. |
| Paste extras | Pasting a web address over selected words turns them into a link. Text from a browser can get a small source link below it, and the first web paste asks whether to add one. Text from a PDF has its broken lines and split words joined back into paragraphs. Images from the web are saved into the page instead of linked. One Ctrl+Z undoes each change. |
| Read aloud | Reads a page, a selection, or everything from the cursor aloud, and highlights each word as it is spoken. Speed and voice can be changed, and play, pause, and next paragraph work from the keyboard. It uses only the voices installed on Windows, so the text never leaves the device. |
| Reading order | A "Reading order" pane lists a freeform page's text, ink, images, and tables in the order that screen readers, read aloud, and the Tab key visit them. The default is top to bottom, then left to right, and Move up and Move down change it. The compact view and PDF export follow the same order. |
| Alt text | Every image, drawing, and embedded object can have a text description, or be marked as decorative. The description goes into `page.md` and every export. Once text in images is recognized (Phase 12), that text can fill in a first draft. |
| Compare versions | Page history shows what changed between any two versions, with added text underlined and removed text struck through. One paragraph, table, or drawing can be restored without the rest of the page. Named versions are never pruned, and a setting chooses how long history is kept. "Delete history" clears old versions for a page, section, or notebook. Emptying Trash also removes a page's old versions, search entries, and transcripts. |

### Phase 5: Ink

| Feature | What it does |
|---|---|
| Insert space | Drag a line across the page to push everything below it down, or drag up to close a gap. Text, ink, and images move together, and locked items stay put. In paginated view, pushed content moves onto the next sheet instead of being lost. An "Insert space" command with a height field does the same from the keyboard. One undo reverses the whole move. |
| Ink that stays with its text | Underlines, circles, and margin notes drawn on typed text are anchored to the words they touch. They move with those words when the text is edited, reflowed, or restyled. Ink, text, and images can also be grouped to move as one object. |
| Zoom writing box | A magnified strip docks at the bottom of the window. The person writes large in the strip, and the ink lands small in a box on the page. The box moves along the line by itself and wraps to the next ruled line at the margin. Arrow keys move the box, and left-handed mode mirrors the strip. |
| Pen and touch gestures | Scribbling over ink erases it, and circling content and then tapping inside it selects it. A two-finger double tap undoes, and a three-finger double tap redoes. After each gesture, a toast such as "Erased 4 strokes" offers Undo. Every gesture is listed in the shortcut list and can be turned off. |
| Eraser and lasso filters | The eraser can erase only highlighter, or only one pen type, and can switch back to the last tool when the pen lifts. The lasso can choose what it picks up: ink, highlighter, typed text, images, or shapes. A rectangle lasso is also available. |
| Pen buttons | Settings choose what the pen's side button and eraser end do: lasso, an eraser type, highlighter, pan, or the right-click menu. Choices are saved for each pen. Setup also offers to make the pen's top button open quick capture. |
| Pressure and steady pen | Each pen device gets a pressure curve (soft, normal, firm, or custom, with a minimum width) and an optional stabilizer that smooths shaky strokes. A live preview stroke shows the effect. The stabilizer is off by default. |

### Phase 6: Page views and export

| Feature | What it does |
|---|---|
| Reading aids | A reading view adds a line focus band (1, 3, or 5 lines), soft page tints such as cream, sepia, and gray, extra word and paragraph spacing, a maximum line width, and optional syllable breaks. These change only the display, never the note. |
| Sheet navigator | In paginated view, a strip of sheet thumbnails and a "Go to sheet" command jump anywhere. Sheets can scroll up and down or flip sideways. Writing past the end of the last sheet adds a new sheet with the same background. |
| Accessible PDF export | Exported PDFs include structure tags for headings, lists, tables, reading order, alt text, and language, so screen readers can follow them. |

### Phase 7: Smart tables and charts

| Feature | What it does |
|---|---|
| Accessible charts | Each chart gets an editable text summary of its type, axes, range, trend, and highest and lowest values. Arrow keys step through data points and read their values. "Show as table" is always one click away. |
| Quick math | Typing an expression such as `2.5*9.81=` and then Space adds the result, as in OneNote. It handles powers, roots, percentages, sine, and logarithms, with the same engine as smart tables. One Ctrl+Z removes the result, and the feature can be turned off. |

### Phase 8: Search and linking

| Feature | What it does |
|---|---|
| Line tags and tag summary | Ctrl+1 to Ctrl+9 tag any paragraph or list item as To do, Important, Question, Idea, or a custom tag. A Tags pane collects tagged lines and open checkboxes from a page, section, notebook, or all notebooks, grouped by tag, page, or date. Items can be checked off in place, and "Create summary page" saves a copy. Each tag shows an icon and a name, not just a color. |
| Links to paragraphs | "Copy link" works on any page, heading, or paragraph, and `[[Page#Heading]]` autocompletes headings. Opening a link jumps to the target and briefly highlights it. The same links open OpenNote from Outlook, Word, Teams, or a browser, and they survive moves and renames. |
| Protected sections lock again | Password-protected sections lock again after a chosen idle time, when the person leaves them, and when Windows locks or sleeps. Their text never appears in plain text in `page.md`, the search index, thumbnails, recent pages, or crash reports. Search skips them while they are locked. |

### Phase 9: Audio recording

| Feature | What it does |
|---|---|
| Playback speed and skips | Recordings play at 0.5x to 3x without changing pitch. "Skip silence" jumps over pauses, keys skip 10 seconds back or forward, and resuming rewinds 2 seconds so no words are missed. Each recording remembers where listening stopped. The playback keys work while typing. |
| Recording guard | A live level meter shows while recording. A warning appears if the microphone is silent for 20 seconds or disconnects, or if disk space or battery is running low, with the minutes left. The PC stays awake while recording, and another microphone can be chosen without stopping. If recording must stop, the file is closed cleanly and a notice says how much was saved. |
| Trim, split, and remove parts | Trim silence at the start or end, split a long recording, or remove an "off the record" part from both the audio and its transcript. Notes keep their timing. Removed parts are also deleted from page history and search. |

### Phase 10: Math and study tools

| Feature | What it does |
|---|---|
| Study tape | Draw tape over any ink, text, or part of an image to hide it, then tap to show or hide it again. "Show all tape" and "Hide all tape" work on the whole page. Print and export can turn tape into blanks, with an answer key page at the end. Tape hides content on screen only. It isn't a lock. |
| Math that screen readers speak | Equations carry MathML behind the rendered math, so screen readers can speak them, show them in braille, and move through them term by term. Equations can also be copied as MathML or LaTeX. |

### Phase 11: Import and export

| Feature | What it does |
|---|---|
| Import reports and undo | Each import lands in its own notebook, with a report for each page: what came over, what was simplified, and what was skipped and why. Original created and modified dates are kept. "Undo this import" removes the whole import in one step. Exports get a short report too. |
| Note space around slides and PDFs | "Add note space" widens imported slides or PDF pages with a ruled or blank margin on the right, the bottom, or both. It can also lay out 2 or 3 slides per page with lines beside them, like PowerPoint handouts. It works on one page, a range, or the whole deck. |
| App permissions and access log | Each app connected through the local API or an AI assistant (MCP) gets its own access: read-only or read and write, all notebooks or chosen ones, and never locked sections. New connections start read-only on one notebook. Writes can require approval, and each one lands in page history. An access log shows what each app read or changed, and access can be removed in one click. |

### Phase 12: On-device intelligence

| Feature | What it does |
|---|---|
| Dictation | A Dictate button and shortcut type spoken words at the cursor, with spoken punctuation. Commands such as "new paragraph" and "undo that" work too. Speech is processed on the device by the same model as transcription, and the audio is discarded unless the person also records. An indicator shows the whole time it's listening. |
| Live captions | While a recording runs, a caption strip shows the speech as text within seconds. Caption size, position, and colors follow the Windows caption settings. The full transcript replaces the captions when processing finishes. On slower PCs, captions show as delayed instead of slowing ink or typing. |
| Background work controls | An activity panel lists queued work in plain words, such as reading text in images, recognizing handwriting, transcribing, and indexing. People can pause it, run it only when the PC is idle or plugged in, or cap how much of the processor it uses. Each feature can also run only on request. |

### Phase 13: Hardening and beta

| Feature | What it does |
|---|---|
| Accessibility checker | "Check accessibility" lists problems on a page or section, each with a fix. It finds missing alt text, skipped heading levels, tables without header rows, low-contrast custom colors, meaning shown only by color, and freeform pages without a reading order. It can also run before export or sharing, as an optional step. |
| Privacy panel and Work offline | Settings, then Privacy, lists every kind of network use the app can make, such as update checks, model downloads, embeds, and linked accounts, with when each last ran. A "Work offline" switch blocks all of it until it is turned back on, and the title bar says so in text. While offline, embeds show their saved preview. |
