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
- [Further features by phase](#further-features-by-phase)
- [Productivity and study tools](#productivity-and-study-tools)

## Office and Google Workspace

Import and export (Phase 11):

| App | Import | Export |
|---|---|---|
| Word / Google Docs | `.docx`, `.odt`, Google Docs | `.docx`, Google Docs, PDF |
| Excel / Google Sheets | `.xlsx`, `.csv`, Google Sheets into smart tables | `.xlsx`, `.csv`, Google Sheets |
| PowerPoint / Google Slides | `.pptx`, Google Slides as annotatable pages | `.pptx` (one page per slide), PDF |
| OneNote / Evernote | Graph API, `.enex` | PDF, Markdown |

Linked accounts (Phase 11):

- People can link Google and Microsoft accounts in Settings, then Connectors, along with Slack, Dropbox, Box, Vimeo, Readwise, Canvas, and Moodle. Sign-in uses the provider's own secure page (OAuth) in the default browser, and tokens are stored in Windows Credential Manager. The [setup guide](CONNECTORS.md) says how the owner of a build registers each service.
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

These features answer requests from people switching from OneNote, Goodnotes, Obsidian, and other apps, and from people who use assistive technology. Each table belongs to a phase in [DEVELOPMENT.md](DEVELOPMENT.md#5-phases). None needs an account, and all work offline except the optional "Link titles on paste", which is off by default and contacts the linked site.

### Phase 2: App shell and navigation

| Feature | What it does |
|---|---|
| Subpages and section groups | Pages can sit under a parent page, 2 levels deep as in OneNote, and fold away with it. Sections can be gathered into section groups, which can nest. Ctrl+Alt+Shift+N adds a subpage, and Ctrl+Alt+] and Ctrl+Alt+[ move a page one level in or out. |
| Back and forward | Alt+Left, Alt+Right, the mouse side buttons, and toolbar arrows step through visited pages, including jumps from links and search. Each step returns to the earlier scroll position. A breadcrumb above the page shows the notebook, section, and page, and "Reveal in tree" selects the open page in the tree. |
| Quick switcher | Ctrl+O finds a page by name, with recent pages first. Enter opens it, and Ctrl+Enter opens it in a new tab. If nothing matches, Enter creates a page with that name in the current section. |
| OneNote shortcuts | Setup offers a "OneNote" shortcut set, so switchers keep their habits, such as Ctrl+1 to Ctrl+9 for tags, Ctrl+Alt+1 to 6 for headings, and Ctrl+E to search. Where the two sets clash, this set keeps OneNote's meaning. The shortcut list shows where the other command went. In both sets, Ctrl+K adds a link when text is selected and opens the command palette otherwise. |
| Interface size | Scales sidebars, toolbars, and menus from 90% to 150% without changing the page zoom. A "Large targets" option uses touch-size controls with a mouse. |
| Dock to a screen edge | A command docks OpenNote to the left or right edge of the screen as a narrow column, and other windows resize to leave room. It suits taking notes beside a lecture, a document, or a browser. The same command undocks it, and OpenNote remembers the docked width. |
| Portable mode | A file named `portable` next to the program keeps settings, caches, and downloaded models in that folder instead of the Windows profile. OpenNote then runs from a USB drive or a synced folder and leaves no settings or caches on other PCs. Linked accounts are the exception, because their tokens stay in Windows Credential Manager. |
| Select several pages | Ctrl-click and Shift-click select several pages or sections in the tree. Move to, Copy to, Color, and Delete then work on all of them at once. Shift+Up and Shift+Down extend the selection from the keyboard, and the Move to and Copy to pickers replace dragging. One undo reverses the whole action. |

### Phase 3: Document model and storage

| Feature | What it does |
|---|---|
| Scheduled backups | Copies notebooks on a schedule, from hourly to weekly, to a folder the person picks, such as a USB drive or a second disk. Only changed files are copied, and daily, weekly, and monthly copies are kept. Protected sections stay encrypted in the copy. Settings shows when the last backup ran. Any backup opens read-only, so single pages or sections can be copied back. |
| Edits from other apps | OpenNote watches the notes folder and reloads pages that other programs change, such as Git, Syncthing, or a script. It never overwrites those changes silently. If someone edits `page.md` in another editor, OpenNote offers to bring the text changes into the page. |
| Notes in OneDrive or Dropbox | Setup and Settings notice when the notes folder is inside OneDrive, Dropbox, iCloud Drive, or Google Drive. They explain what that means and offer "Always keep on this device" for that folder. Conflict copies from those services open in the side-by-side conflict view instead of showing up as duplicate pages. Files stored only in the cloud download before they open, so a page never looks empty. |
| Open a notebook from any folder | "Open folder" opens a notebook that lives anywhere: another drive, a USB stick, a network share, or a folder in a Git repository. It opens in place, with no copy and no import. A folder that isn't a notebook yet offers to become one, and nothing is written until the person agrees. If a folder goes missing, the notebook stays in the list and offers "Locate". |
| Check notebook | Scans a notebook for damaged files, missing images and recordings, broken links, and pages whose readable copy doesn't match the page data. The report lists each problem in plain words, with a repair for each, such as restoring from page history or a backup. Nothing changes until the person picks a repair, and each repair can be undone. It runs when asked, and a notice after a crash points to it. |

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
| Wrap text around images | In flow pages, an image can sit on the left or right with text wrapping around it, stay in the line, or stand alone with text above and below. Handles set the gap. A wrapped image is still a real image with alt text, and the reading order and PDF export follow the same layout. |
| Attachments that save back | Word, Excel, PowerPoint, PDF, and other files can be attached to a page as an icon or a preview. Opening one edits the attached copy in its own app, and OpenNote saves the changes into the page each time the app saves. The icon shows the file size, and "Save a copy" exports the original. Attachments live in the page's `assets` folder, so they move with it. |
| Checklist shortcuts | One key combination, which can be changed, toggles the current checkbox from the keyboard. "Check all" and "Uncheck all" work on a whole list. Finished items can stay in place, move to the bottom, or hide, and each list can show a count such as "3 of 8 done". The count is text, and each setting applies to one list. |
| Screenshot paste size | Settings choose whether pasted screenshots and images arrive at actual size, fitted to the text column, or ask each time. Display scaling is taken into account, so a screenshot from a 4K screen doesn't fill the page. Any image can switch between "Fit to column" and "Actual size" with one click. |
| Typewriter scrolling | Keeps the line being typed at a set height on the screen, centered by default, so the eye stays still and the page moves instead. It is off by default. With reduced motion on, the page jumps instead of gliding. |
| Thicker caret | The text caret's width and color follow the Windows text cursor settings, and Settings can override them from 1 to 6 pixels. The blink rate follows Windows too, and a steady caret doesn't blink. A thicker caret helps people with low vision, and it shows which text box is active on a page with several. |
| Link titles on paste | Off by default. When turned on, pasting a web address asks that site for its page title and shows the title as the link text. This contacts the site, which sees the PC's network address and the request, so the setting says so, and the Privacy panel (Phase 13) lists it. It never runs while Work offline is on, in locked sections, or for addresses on the local network. One Ctrl+Z brings back the bare address. |

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
| Pen hover preview | When a pen hovers above the screen, a small circle shows the tip's width and color, or the eraser's size and shape, so the person sees where ink will land before touching. It appears only for pens that report hover, and it can be turned off. |
| Canvas lock | A lock button in the toolbar stops the page from scrolling, zooming, or panning by touch, pen, or mouse wheel, so writing never moves the page. The pen still draws. Reading mode is different, because it stops edits. The same button or shortcut turns the lock off. |
| Pen writing in text fields | A pen can write straight into the search box, rename fields, and table cells, and the handwriting turns into text as the person writes. It uses the handwriting recognition built into Windows, so it works before on-device models are set up. |

### Phase 6: Page views and export

| Feature | What it does |
|---|---|
| Reading aids | A reading view adds a line focus band (1, 3, or 5 lines), soft page tints such as cream, sepia, and gray, extra word and paragraph spacing, a maximum line width, and optional syllable breaks. These change only the display, never the note. |
| Sheet navigator | In paginated view, a strip of sheet thumbnails and a "Go to sheet" command jump anywhere. Sheets can scroll up and down or flip sideways. Writing past the end of the last sheet adds a new sheet with the same background. |
| Accessible PDF export | Exported PDFs include structure tags for headings, lists, tables, reading order, alt text, and language, so screen readers can follow them. |
| Elements library | Lasso ink, shapes, text, and images, and "Save as element" keeps them for reuse, such as a header, a signature, a labeled axis, or part of a flowchart. Elements sit in folders, can be searched by name, scale to fit when inserted, and export as a file to share. |
| Lock entry | For lab notebooks and records, "Lock entry" makes a page read-only and stamps it with the date and time from the PC's clock. Unlocking is a deliberate action, and it is written to page history. The lock only prevents edits in OpenNote. It is not tamper-proof, because anyone with access to the files can change them, and the PC's clock can be wrong. Nothing is locked unless the person asks, and it pairs with the lab notebook layout. |

### Phase 7: Smart tables and charts

| Feature | What it does |
|---|---|
| Accessible charts | Each chart gets an editable text summary of its type, axes, range, trend, and highest and lowest values. Arrow keys step through data points and read their values. "Show as table" is always one click away. |
| Quick math | Typing an expression such as `2.5*9.81=` and then Space adds the result, as in OneNote. It handles powers, roots, percentages, sine, and logarithms, with the same engine as smart tables. One Ctrl+Z removes the result, and the feature can be turned off. |
| Draw a grid to make a table | Draw a rough grid with the pen and choose "Snap shape" or "Convert to table". The grid becomes a table with the same rows and columns. Handwriting inside a cell stays as ink, and it converts to text when recognition is on (Phase 12). |

### Phase 8: Search and linking

| Feature | What it does |
|---|---|
| Line tags and tag summary | Ctrl+1 to Ctrl+9 tag any paragraph or list item as To do, Important, Question, Idea, or a custom tag. A Tags pane collects tagged lines and open checkboxes from a page, section, notebook, or all notebooks, grouped by tag, page, or date. Items can be checked off in place, and "Create summary page" saves a copy. Each tag shows an icon and a name, not just a color. |
| Links to paragraphs | "Copy link" works on any page, heading, or paragraph, and `[[Page#Heading]]` autocompletes headings. Opening a link jumps to the target and briefly highlights it. The same links open OpenNote from Outlook, Word, Teams, or a browser, and they survive moves and renames. |
| Protected sections lock again | Password-protected sections lock again after a chosen idle time, when the person leaves them, and when Windows locks or sleeps. Their text never appears in plain text in `page.md`, the search index, thumbnails, recent pages, or crash reports. Search skips them while they are locked. |
| Link previews | Hovering over or focusing an internal link shows a small card with the target's first lines, heading, or paragraph. Keyboard and screen reader users open the card with a shortcut, and Escape closes it. The card stays open while the pointer is over it. Previews never show text from locked sections. |
| Unlinked mentions | The backlinks pane has a second list of pages that mention this page's title without linking to it. "Link" turns one mention into a link, and "Link all" turns every mention into one, after a preview of each change. One undo reverses it. Locked sections are skipped. |
| Tag renaming | Rename, merge, or delete a tag everywhere, including nested tags such as `school/biology`. A preview shows how many pages and lines will change before anything does, and one undo reverses the whole change. Custom tags keep their icons. |
| Extract and merge pages | "Extract to new page" moves the selected text, ink, or blocks into a new page and leaves a link in their place. "Merge pages" joins the selected pages in order, with each title as a heading. "Split at headings" makes one page for each top-level heading. Links to merged pages still work, and each action is one undo and one entry in page history. |
| Daily notes calendar | A small month calendar opens the daily note for any day. Days that have notes show a dot and a label such as "3 pages". Arrow keys move by day, week, and month, and Today returns to the current day. Weekly, monthly, and yearly notes can be made from their own templates. The Upcoming calendar (see Productivity and study tools) is the same view with due dates added. |
| Series pages | A series groups pages that repeat, such as a weekly meeting or a lab log. "New page in series" copies the last page's structure, adds the date, and links each page to the one before and after it. Unfinished checkboxes from the previous page can be carried over. A series page lists every page in the series. |
| Links on handwriting | Lasso handwriting and choose "Make link" to link it to a page, a heading, a web address, or a moment in a recording. The ink stays ink, and the link moves with it. A link gets an outline when focused, and all links on a page appear in a list for the keyboard and screen readers. Pages linked this way show in backlinks. |

### Phase 9: Audio recording

| Feature | What it does |
|---|---|
| Playback speed and skips | Recordings play at 0.5x to 3x without changing pitch. "Skip silence" jumps over pauses, keys skip 10 seconds back or forward, and resuming rewinds 2 seconds so no words are missed. Each recording remembers where listening stopped. The playback keys work while typing. |
| Recording guard | A live level meter shows while recording. A warning appears if the microphone is silent for 20 seconds or disconnects, or if disk space or battery is running low, with the minutes left. The PC stays awake while recording, and another microphone can be chosen without stopping. If recording must stop, the file is closed cleanly and a notice says how much was saved. |
| Trim, split, and remove parts | Trim silence at the start or end, split a long recording, or remove an "off the record" part from both the audio and its transcript. Notes keep their timing. Removed parts are also deleted from page history and search. |
| Mark moments | A button or shortcut drops a flag at the current moment of a recording, with an optional short label. Flags show on the timeline, in a list, and as a small marker beside the notes from that time. Keys jump to the next or previous flag during playback. Flags can be renamed or removed later. |
| Ink replay | Plays back a page or a selection stroke by stroke, in the order it was written, with play, pause, a slider, and speed from 0.5x to 4x. Long pauses can be shortened. Every stroke stores its time, so replay works on any page with ink. If the page has a recording, the audio plays along. |
| Voice enhancement | "Enhance voice" reduces steady background noise and evens out loud and quiet speech, on the device. It works on a copy, so the original recording is kept, and a switch compares the two while listening. The transcript can use either one. |
| Recording storage | A list shows each recording's length and size, and the page and notebook that hold it. A recording can be compressed to a smaller format, or its audio can be removed while the transcript and flags are kept. Nothing is removed without a confirmation that says how much space it frees. |
| Meeting detected prompt | Off by default, and turned on only in Settings. When on, OpenNote watches one thing: whether another app has started using the microphone. It sees which app, not what is said, and it never records on its own. A small prompt offers "Record this meeting" and "Not now", asks once per call, and has "Never for this app". It reminds the person to tell others before recording. |

### Phase 10: Math and study tools

| Feature | What it does |
|---|---|
| Study tape | Draw tape over any ink, text, or part of an image to hide it, then tap to show or hide it again. "Show all tape" and "Hide all tape" work on the whole page. Print and export can turn tape into blanks, with an answer key page at the end. Tape hides content on screen only. It isn't a lock. |
| Math that screen readers speak | Equations carry MathML behind the rendered math, so screen readers can speak them, show them in braille, and move through them term by term. Equations can also be copied as MathML or LaTeX. |
| Exam dates for decks | Set an exam date on a deck, and the schedule spreads new and due cards so all are seen before that day. The deck shows a plain daily target, such as "18 new cards a day". Changing the date updates the plan at once. There are no streaks, scores, or reminders. |
| Inline flashcards | Type a question and an answer on one line, separated by `::`, and the line becomes a card in the page's deck. Wrap words in double braces to hide them as a fill-in-the-blank. Cards stay in the text, so editing the line edits the card, and "Make card" converts selected lines. |

### Phase 11: Import and export

| Feature | What it does |
|---|---|
| Import reports and undo | Each import lands in its own notebook, with a report for each page: what came over, what was simplified, and what was skipped and why. Original created and modified dates are kept. "Undo this import" removes the whole import in one step. Exports get a short report too. |
| Note space around slides and PDFs | "Add note space" widens imported slides or PDF pages with a ruled or blank margin on the right, the bottom, or both. It can also lay out 2 or 3 slides per page with lines beside them, like PowerPoint handouts. It works on one page, a range, or the whole deck. |
| App permissions and access log | Each app connected through the local API or an AI assistant (MCP) gets its own access: read-only or read and write, all notebooks or chosen ones, and never locked sections. New connections start read-only on one notebook. Writes can require approval, and each one lands in page history. An access log shows what each app read or changed, and access can be removed in one click. |
| Command-line tool | An `opennote` command creates pages, appends text to the daily note, searches, exports, and runs a backup from a terminal or a script. It uses the same permissions and access log as the local API, so access starts read-only. |
| Copy meeting recap | For a page with a recording, "Copy recap" puts the summary, decisions, and action items on the clipboard as formatted text or Markdown, ready to paste into email or chat. A preview lets the person choose which parts to copy. Without on-device intelligence, it copies the page's own headings and checkboxes. Nothing is sent. |
| Dim PDFs in dark mode | Imported PDFs and slides can be dimmed or color-inverted in the Evening theme, with images kept in their own colors. A switch on each page shows the original white page. The choice follows the Page color setting by default, and it never changes the file or its export. |

### Phase 12: On-device intelligence

| Feature | What it does |
|---|---|
| Dictation | A Dictate button and shortcut type spoken words at the cursor, with spoken punctuation. Commands such as "new paragraph" and "undo that" work too. Speech is processed on the device by the same model as transcription, and the audio is discarded unless the person also records. An indicator shows the whole time it's listening. |
| Live captions | While a recording runs, a caption strip shows the speech as text within seconds. Caption size, position, and colors follow the Windows caption settings. The full transcript replaces the captions when processing finishes. On slower PCs, captions show as delayed instead of slowing ink or typing. |
| Background work controls | An activity panel lists queued work in plain words, such as reading text in images, recognizing handwriting, transcribing, and indexing. People can pause it, run it only when the PC is idle or plugged in, or cap how much of the processor it uses. Each feature can also run only on request. |
| Custom transcript vocabulary | A word list of names, course terms, acronyms, and spellings that the transcriber prefers. Fixing a word in a transcript offers to add it to the list. Lists can be kept for each notebook, are plain text, and can be shared. The list is used on the device only. |
| Transcript lines to notes | Select lines in a transcript and press one key to copy them into the page's notes as a quote with its timestamp. The timestamp links to that moment in the audio. The speaker's name can be included or left out. |
| Pen editing on typed text | With the pen, a person can strike through words to delete them, draw a vertical line between words to add space or split a paragraph, circle words to select them, and write in a gap to insert text. Every gesture is listed in the shortcut list, shows an Undo toast, and can be turned off. The gestures edit typed text and leave ink alone. |

### Phase 13: Hardening and beta

| Feature | What it does |
|---|---|
| Accessibility checker | "Check accessibility" lists problems on a page or section, each with a fix. It finds missing alt text, skipped heading levels, tables without header rows, low-contrast custom colors, meaning shown only by color, and freeform pages without a reading order. It can also run before export or sharing, as an optional step. |
| Privacy panel and Work offline | Settings, then Privacy, lists every kind of network use the app can make, such as update checks, model downloads, embeds, and linked accounts, with when each last ran. A "Work offline" switch blocks all of it until it is turned back on, and the title bar says so in text. While offline, embeds show their saved preview. |
| Safe start after crashes | After two crashes in a row, the next start offers "Start in safe mode", which turns off background work, embeds, and on-device models. Notebooks stay open for reading and editing, and a notice says what is off and how to turn it back on. A crash report can be saved for the person to send if they choose, and it never includes note content. |

## Further features by phase

These features fill gaps found by comparing OpenNote with other note apps. Each table belongs to a phase in [DEVELOPMENT.md](DEVELOPMENT.md#5-phases). All of them work offline and need no account, and anything that uses on-device intelligence stays off until the person turns it on. Larger items that depend on sync or collaboration are in the "After the Windows release" list instead.

### Phase 4: Typed notes

| Feature | What it does |
|---|---|
| Page templates | A template is a page with text, tables, checklists, and placeholders for the date, the title, and where the cursor lands. "New page from template" lists them, and each section can have a default template. A template button inserts a block, such as a dated log entry or a meeting agenda, at the cursor. Templates are ordinary pages in a Templates section, so they can be edited, shared, and exported. |
| Markdown source view | A toggle shows a typed page as Markdown text and lets the person edit it there. The editor colors the syntax, and ink, images, and other objects show as placeholders that stay in place. Switching back keeps the cursor where it was. "Open in another editor" hands the page's `page.md` to the person's own editor and offers to bring the changes in when that editor saves (see Edits from other apps). |

### Phase 5: Ink

| Feature | What it does |
|---|---|
| Layers | Ink, shapes, text, and images can sit on named layers, such as "Slide", "Notes", and "Teacher's marks". Each layer can be hidden, locked, renamed, reordered, or exported alone, and new ink goes on the active layer. A lasso moves a selection to another layer. Imported PDF and slide pages keep their own content on a locked bottom layer, so a pen never changes it. Hidden layers stay out of print and export unless chosen. |
| Pen library | Beyond the pens and pencil, the library adds a fountain pen and a brush whose width follows pressure, tilt, and speed, a calligraphy nib with a fixed angle, and dashed and dotted line pens. Each pen has its own name, sizes, and colors, and screen readers announce the name. |

### Phase 6: Page views and export

| Feature | What it does |
|---|---|
| Page gallery | A gallery view of a section shows a thumbnail of every page with its title and date. Pages reorder by drag, or with Move up and Move down. Selecting several pages works as in the tree. The gallery suits handwritten notebooks and scanned pages, where titles say little. |
| Slides from a page | "Present as slides" splits a page at its headings or at divider lines and shows each part as a full-screen slide. Arrow keys move between slides, and the laser pointer and fading ink from presentation mode still work. Nothing on the page changes. |

### Phase 7: Smart tables and charts

| Feature | What it does |
|---|---|
| Board, calendar, and gallery views | A smart table can also show as a board (columns grouped by a choice or status column), a calendar (by a date column), a gallery of cards, or a timeline (start and end dates). Dragging a card changes its field, and a menu and the keyboard can do the same. Filters and sorting are kept for each view. All views use the same rows, so a chart made from the table stays in step. |
| Diagrams from text | A diagram block draws flowcharts, sequence diagrams, timelines, and class diagrams from a short text description in the Mermaid syntax, on the device. Editing the text redraws the diagram. Diagrams export as vector graphics in PDF and SVG. Every diagram has an alt text field, and its text source is readable by screen readers. |
| Mind maps | Type an outline and see it as a mind map, or build the map with the keyboard or the pen, and the outline updates. Tab adds a child branch, Enter adds a sibling, and branches fold. Screen readers read the map as a nested list. A map exports as an image, a PDF, or an outline. |
| Shape libraries and text in shapes | Shapes can hold text, and handwriting written inside a shape becomes its label when recognition is on (Phase 12). Libraries add flowchart, network, and entity diagram shapes. Connectors snap to the edges of shapes and can carry a label. |

### Phase 8: Search and linking

| Feature | What it does |
|---|---|
| Page properties | Fields on a page, such as status, due date, course, author, rating, and a link to another page. Field types are text, number, date, checkbox, choice, and page link. They show in a compact header that can be folded, are saved with the page, and are written at the top of `page.md` so other apps can read them. Search and collections use them, and each field shows its name as well as an icon. |
| Collections | A collection is a saved view of pages chosen by a search, a tag, a section, or property values, such as "open assignments for Bio 201, grouped by due week". It shows as a table, a list, a board, a calendar, or a gallery, and it can sit inside a page as a live block. Editing a property or dragging a card in the view changes the page. Collections update as pages change, and they work offline. |
| Page embeds | Typing `![[` and choosing a page, a heading, or a paragraph shows it live inside another page. It can be edited in either place, and both update. A small header names the source and opens it. Embeds survive renames and moves, and exports include their text. An embed of locked text shows a lock instead. |
| Graph view | Shows pages as dots and links as lines, for a whole notebook or for the pages within 1 to 3 links of the open one. Filters use tags, sections, and properties. A "Connections" list gives the same information for keyboard and screen reader use, and pages with no links appear in a list of their own. |
| Canvas of cards | A canvas is an open board of cards: pages, typed notes, images, PDFs, web addresses, and groups, joined by labeled arrows. Opening a card opens its page. Commands align cards in a row, a column, or a grid. A canvas can be imported from and exported to the open JSON Canvas format. |
| Advanced search | Search understands "exact phrases", AND, OR, NOT, a minus sign to leave a word out, and a regular expression mode. Operators such as `tag:`, `in:`, `type:`, `before:`, and `after:` narrow results, and options limit a search to handwriting, transcripts, alt text, or titles. A line below the box lists the operators, and results show the matching paragraph with its heading. Locked sections stay out of results. |
| Archive | "Archive" hides finished pages, sections, and notebooks from the tree. "Show archived" brings them back, and search can include them with a filter. Unlike Trash, nothing is scheduled for deletion, and archived items keep their links. |
| Page shortcuts and jump list | "Create shortcut" makes a Windows shortcut that opens a page, a section, or a notebook from the desktop, a folder, or the Start menu, and the person can pin it to the taskbar. Right-clicking OpenNote on the taskbar lists recent pages and "New quick note". Shortcuts use the same links as Outlook and Word, so they survive renames and moves. |
| Home page | A start page shows recent pages, pinned pages, today's note, saved searches, and the Upcoming list, in plain sections the person can reorder or hide. It shows only the person's own notes, with no feeds or tips. Settings choose whether OpenNote starts on Home or on the last page. |

### Phase 9: Audio recording

| Feature | What it does |
|---|---|
| Snap the screen | While recording, a shortcut captures the screen, a window, or a region, such as a slide or a whiteboard, and puts it on the page time-stamped to the audio. Text recognition (Phase 12) makes the image searchable. Nothing is captured until the person presses the shortcut, and a brief indicator shows each capture. |
| Audio and video files | Dropping an audio or video file, such as an MP3, M4A, WAV, or MP4 file, onto a page adds a player with the same time-stamped notes, playback speed, and flags as a recording. The file is copied into the page's `assets` folder. Transcripts come from on-device transcription (Phase 12), and only for files the person has the right to use. |

### Phase 10: Math and study tools

| Feature | What it does |
|---|---|
| Math with variables and units | Write `rent = 1,200` on one line and `rent * 12 =` on another, and the result updates when the first changes. Units work too, as in `5 mi in km =`. Variables live on one page. Choosing "Graph this" on an equation such as `y = x^2` sends it to the function grapher. Handwritten expressions work the same way once handwriting recognition is on. It uses the engine behind Quick math and smart tables. |
| Deck import | Imports decks from Anki packages and from CSV or text files, with their images. Each import becomes its own deck, and cards that already exist are flagged before anything is added. A short report says what was skipped. |

### Phase 11: Import and export

| Feature | What it does |
|---|---|
| OneNote files from disk | Reads OneNote notebook packages (`.onepkg`) and section files (`.one`) saved on the computer, with no sign-in. Text, tables, images, files, tags, and ink come over where the format allows, and the import report lists everything that didn't. This sits beside the Microsoft Graph import, for people who don't want to link an account. |
| Import from other apps | Imports Notion exports (Markdown and CSV, with databases becoming smart tables), Google Keep exports from Takeout, Joplin exports, Bear TextBundle files, and Logseq folders. Keep labels become tags, and its checklists stay checklists. Each import gets the import report and "Undo this import". |
| Windows Sticky Notes | Imports the notes from the Sticky Notes app on this PC, with their text, colors, and dates, into a notebook of their own. It reads the local data only and needs no account. |
| Open single files | "Open with OpenNote" on a Markdown or text file opens it as a page and saves back to the same file. The file isn't moved, copied, or renamed, and Markdown files can be set to open in OpenNote by default. |
| Highlights from PDFs | Select text on an imported PDF page and press a key to highlight it in one of the highlighter colors. "Send to notes" adds the highlight as a quote with its page number, linked back to the spot in the PDF. A list gathers every highlight of a PDF by color and page, and exports as Markdown. Scanned PDFs use recognized text (Phase 12). |
| Scan cleanup | "Clean up" takes a photo of a page, a whiteboard, or a slide, finds its edges, straightens the perspective, evens out the lighting, and offers color, grayscale, or black and white. Several photos can become one multi-page scan. It runs on the device, keeps the original, and is one undo. It works on phone photos and on any image dropped onto a page. |
| Web pages | "Export as web page" writes one self-contained `.html` file with the text, images, ink as vector graphics, and recordings with a player that highlights notes as the audio plays. A notebook can export as a folder of linked pages with an index, to put on any web host. Both work in any browser, offline, with no account. Locked sections stay out unless unlocked during export. |
| Share as a file | Saves a page, a section, or a notebook as one file that opens in OpenNote, with its structure, tags, properties, and, if chosen, history. A password can encrypt the file. Opening it adds a new notebook, with the usual import report. |

### Phase 12: On-device intelligence

| Feature | What it does |
|---|---|
| Reflow and tidy handwriting | Lasso handwriting and drag its side handles, and the words rewrap to the new width. "Straighten" levels the lines, and "Even spacing" evens out word gaps and sizes. The ink stays ink, the original strokes are kept, and one undo reverses the change. It works best on handwriting that has been recognized. |
| Search by meaning and ask your notes | "Find by meaning" matches pages about the same idea even when the words differ, and a Related pages list sits beside each page. "Ask your notes" answers a question in plain words from the person's own pages, and lists the pages and paragraphs it used as links, so the answer can be checked. Both run on the device, stay off until turned on, and skip locked sections. Answers can be wrong, and the links are the check. |
| Writing tools | Select text, and choose Proofread, Rewrite, Shorten, Make a list, or Tidy structure. The result shows as a suggestion with the changes marked, and nothing replaces the text until the person accepts it. It runs on the device with a model the person downloads, and it stays off until turned on. |
| Action items and chapters | After transcription, "Find action items" lists tasks and decisions. Each can be added to the page as a checkbox with a due date and a link to its moment. "Make chapters" splits a recording into titled topics with jump points on the timeline. These are suggestions, and nothing is added without a click. |
| Translate on this device | Translates a selection, a page, or a transcript into another language and puts the translation beside or below the original, never over it. Formatting is kept. Language packs download only when chosen, with their sizes shown, and nothing leaves the device. |

## Productivity and study tools

These tools help with time, tasks, and study. They need no account and work offline, except the citation helper's optional online look-up. They follow [BRAND.md](BRAND.md): no streaks, scores, badges, or nagging. Nothing notifies the person unless they set a reminder or a timer notice themselves.

### Phase 8: Search and linking

| Feature | What it does |
|---|---|
| Upcoming list | Any checkbox or tagged line can have a due date, typed in plain words such as "Fri 5 PM", "tomorrow", or "Dec 3". The parsed date shows beside the text, so a wrong guess is easy to see, and a click opens a date picker. The Upcoming pane lists items from all notebooks under Overdue, Today, This week, and Later, and items check off in place. A week view and a month view show the same items on a calendar. Windows reminders are optional and set for each item, as with Reminders. Locked sections stay out while locked. The pane also opens as a tool window (Phase 10). |
| Repeating to-dos | A due date can repeat: "every weekday", "every 2 weeks", "monthly on the 1st", or "3 days after I finish". Checking one off creates the next. "Skip this one" moves to the next date. Missed repeats never pile up, because only the next date shows. |
| Class timetable | A weekly timetable holds classes or meetings with their names, days, times, and rooms. The person types them in, or imports them from a calendar file (Phase 11). The Upcoming pane shows today's classes and the next one. Choosing a class opens its section and creates a dated page from the class template. A Record button sits beside it, and recording never starts by itself. |

### Phase 10: Math and study tools

| Feature | What it does |
|---|---|
| Tool windows | Small windows for tools such as timers, the calculator, Upcoming, flashcard review, the dictionary, the unit converter, and reference tables. Each opens from the command palette or from a shortcut the person sets. A pin keeps it above other windows, as in the page mini window. Each remembers its size and place, including the monitor, and "Reset tool windows" puts them back. They use the window shell from Phase 2, work with the keyboard alone, and follow the theme and interface size. |
| Timers | Three kinds: a countdown, a stopwatch with laps, and a focus timer with work and break lengths the person sets, such as 25 and 5 minutes. Several timers can run at once, each with a name. A running timer shows as a small chip in the title bar or in a tool window. Timers count by the clock, so they stay correct across sleep, and one that ends during sleep shows as finished when the PC wakes. A Windows notification at the end is optional for each timer. There are no streaks, totals, or session history. |
| Calculator | A scientific calculator window with expression entry, history, memory keys, degrees and radians, constants, and unit conversion. It uses the same engine as smart tables and Quick math, so results match. A Graphing tab uses the function grapher: type functions, zoom, pan, and trace points. "Insert into page" adds a result as text, or a graph as a grapher block that can be edited later. History stays on the device and can be cleared. |
| Exam countdown | Add an exam, with a name, a date, and an optional time, to a notebook, a section, or a deck. The days left show in the Upcoming pane and on the deck, which uses the plan from Exam dates for decks. The countdown is a number, not an alarm, and it hides itself after the exam. A reminder exists only if the person sets one. |
| Dictionary and thesaurus | Select a word and press a shortcut, or type in the tool window, to see meanings, synonyms, and examples. It works offline from word data stored on the device. English word data comes with the app, and other languages are optional downloads with their sizes shown. "Insert synonym" replaces the selected word. |
| Unit converter | Converts length, area, volume, mass, temperature, speed, time, pressure, energy, power, angle, and data size. Type in either box, and the other updates. "Insert into page" adds the result with its units. Currency is left out, because rates change and need the internet. It shares its unit engine with Math with variables and units. |
| Reference tables | A periodic table with name, symbol, atomic number, mass, group, and electron configuration, and tables of physical constants, metric prefixes, and Greek letters. Element groups pair color with a text label. Selecting an entry copies or inserts its value with its unit. Everything works offline. |

### Phase 11: Import and export

| Feature | What it does |
|---|---|
| Calendar files and course imports | Imports iCalendar files (`.ics`) from a calendar app or a school portal into the timetable and the Upcoming pane. They can hold timetables, exam dates, and assignment due dates. "Update from this file" reads a newer export without duplicating events. Importing a file doesn't use the internet. Assignments from Canvas, Moodle, and Google Classroom (see More integrations) also appear in Upcoming, linked to their course sections. |
| Citation helper | Keeps a list of sources for each notebook. The person types in a book, article, web page, or recording, or imports BibTeX and RIS files. A citation goes into the text in a chosen style, such as APA, MLA, or Chicago, and a bibliography block lists the sources. Changing the style updates every citation. Looking up a source by its digital object identifier (DOI) or International Standard Book Number (ISBN) runs only when asked, and the Privacy panel lists it. It works without Zotero, and Zotero sources appear in the same list when linked. |
