# OpenNote feature list

Every tool, action, and feature in OpenNote, grouped by category, with one sentence each. This list is made from [FEATURES.md](FEATURES.md) by `npm run docs:features`. FEATURES.md also says what has been tested by hand, what waits on an account or a device, and which flag turns each one on. The [help pages](help/README.md) explain how to use them. Pictures of every major page are at the end, in light. [docs/screens](screens/README.md) has them in dark too.

## Contents

- [Office and Google Workspace](#office-and-google-workspace)
- [Video and audio platforms](#video-and-audio-platforms)
- [More integrations](#more-integrations)
- [Handwriting to text](#handwriting-to-text)
- [My handwriting](#my-handwriting)
- [Shapes and lines](#shapes-and-lines)
- [Transcripts and summaries](#transcripts-and-summaries)
- [Study tools](#study-tools)
- [Civil, environmental, and chemical engineering tools](#civil-environmental-and-chemical-engineering-tools)
- [Page layouts](#page-layouts)
- [Export a selection](#export-a-selection)
- [On-device intelligence setup](#on-device-intelligence-setup)
- [Pages and search additions](#pages-and-search-additions)
- [Quality-of-life fixes](#quality-of-life-fixes)
- [More quality-of-life features by phase: Phase 2: App shell and navigation](#more-quality-of-life-features-by-phase-phase-2-app-shell-and-navigation)
- [More quality-of-life features by phase: Phase 3: Document model and storage](#more-quality-of-life-features-by-phase-phase-3-document-model-and-storage)
- [More quality-of-life features by phase: Phase 4: Typed notes](#more-quality-of-life-features-by-phase-phase-4-typed-notes)
- [More quality-of-life features by phase: Phase 5: Ink](#more-quality-of-life-features-by-phase-phase-5-ink)
- [More quality-of-life features by phase: Phase 6: Page views and export](#more-quality-of-life-features-by-phase-phase-6-page-views-and-export)
- [More quality-of-life features by phase: Phase 7: Smart tables and charts](#more-quality-of-life-features-by-phase-phase-7-smart-tables-and-charts)
- [More quality-of-life features by phase: Phase 8: Search and linking](#more-quality-of-life-features-by-phase-phase-8-search-and-linking)
- [More quality-of-life features by phase: Phase 9: Audio recording](#more-quality-of-life-features-by-phase-phase-9-audio-recording)
- [More quality-of-life features by phase: Phase 10: Math and study tools](#more-quality-of-life-features-by-phase-phase-10-math-and-study-tools)
- [More quality-of-life features by phase: Phase 11: Import and export](#more-quality-of-life-features-by-phase-phase-11-import-and-export)
- [More quality-of-life features by phase: Phase 12: On-device intelligence](#more-quality-of-life-features-by-phase-phase-12-on-device-intelligence)
- [More quality-of-life features by phase: Phase 13: Hardening and beta](#more-quality-of-life-features-by-phase-phase-13-hardening-and-beta)
- [Further features by phase: Phase 4: Typed notes](#further-features-by-phase-phase-4-typed-notes)
- [Further features by phase: Phase 5: Ink](#further-features-by-phase-phase-5-ink)
- [Further features by phase: Phase 6: Page views and export](#further-features-by-phase-phase-6-page-views-and-export)
- [Further features by phase: Phase 7: Smart tables and charts](#further-features-by-phase-phase-7-smart-tables-and-charts)
- [Further features by phase: Phase 8: Search and linking](#further-features-by-phase-phase-8-search-and-linking)
- [Further features by phase: Phase 9: Audio recording](#further-features-by-phase-phase-9-audio-recording)
- [Further features by phase: Phase 10: Math and study tools](#further-features-by-phase-phase-10-math-and-study-tools)
- [Further features by phase: Phase 11: Import and export](#further-features-by-phase-phase-11-import-and-export)
- [Further features by phase: Phase 12: On-device intelligence](#further-features-by-phase-phase-12-on-device-intelligence)
- [Productivity and study tools: Phase 8: Search and linking](#productivity-and-study-tools-phase-8-search-and-linking)
- [Productivity and study tools: Phase 10: Math and study tools](#productivity-and-study-tools-phase-10-math-and-study-tools)
- [Productivity and study tools: Phase 11: Import and export](#productivity-and-study-tools-phase-11-import-and-export)
- [Math solvers](#math-solvers)
- [3D graphs, vectors, and motion](#3d-graphs-vectors-and-motion)
- [Engineering tools](#engineering-tools)
- [Statistical models kit](#statistical-models-kit)
- [Music, script, camera, and studio tools](#music-script-camera-and-studio-tools)
- [Subject tool kits](#subject-tool-kits)
- [Document structure](#document-structure)
- [macOS and Linux](#macos-and-linux)
- [Subject kit foundations](#subject-kit-foundations)
- [History, places, languages, and texts kit](#history-places-languages-and-texts-kit)
- [Signals, images, sound, and communications](#signals-images-sound-and-communications)
- [Modern physics and astronomy tools](#modern-physics-and-astronomy-tools)
- [Molecular biology, genetics, and evolution](#molecular-biology-genetics-and-evolution)
- [Economics and finance](#economics-and-finance)
- [Statistics kit](#statistics-kit)
- [Psychology and behavior kit](#psychology-and-behavior-kit)
- [Life science tools](#life-science-tools)
- [Screens](#screens)

## Office and Google Workspace

- **Word / Google Docs.** Imports `.docx`, `.odt`, Google Docs and exports `.docx`, Google Docs, PDF
- **Excel / Google Sheets.** Imports `.xlsx`, `.csv`, Google Sheets into smart tables and exports `.xlsx`, `.csv`, Google Sheets
- **PowerPoint / Google Slides.** Imports `.pptx`, Google Slides as annotatable pages and exports `.pptx` (one page per slide), PDF
- **LaTeX.** Exports `.tex` for a page, section, or notebook; a `.zip` with `images/` and `references.bib` when there is more than one file
- **OneNote / Evernote.** Imports Graph API, `.enex` and exports PDF, Markdown
- People can link Google and Microsoft accounts in Settings, then Connectors, along with Slack, Dropbox, Box, Vimeo, Readwise, Canvas, and Moodle
- The "Send to" menu converts a page, section, or selection to PDF, Word, or Google Docs, then uploads it to a chosen Google Drive or OneDrive folder
- Favorite destinations are saved, so "Send to Drive: Biology/Lab reports" becomes one click
- A page can stay linked to its exported copy and offer "Update the Drive copy" after edits
- Linking is optional

## Video and audio platforms

- Paste a YouTube, Vimeo, or podcast link to embed a player
- Video files (mp4 and webm, up to 200 MB) dropped, pasted, or chosen with Insert video file play in a block on the page, from the page's own files with no network
- Transcripts come from the platform's captions when available, or from on-device transcription of audio the person has the right to use
- Recordings can be exported as audio or as a narrated video of the page, and uploaded to a linked YouTube account as private or unlisted

## More integrations

- **Outlook and Google Calendar.** Opens a meeting note from any event, filled in with the title, time, attendees, and agenda
- **Teams, Zoom, and Google Meet.** Records meeting audio without a bot (Phase 9) and links the note back to the calendar event
- **Microsoft To Do and Google Tasks.** Two-way sync of checkboxes, due dates, and reminders
- **Outlook and Gmail.** "Save to OpenNote" from an email keeps the text and attachments with a link back
- **Web clipper for Edge, Chrome, and Firefox.** Clips a full page, a region, or a clean article into any section
- **Windows share target and Snipping Tool.** "Share to OpenNote" from any app, and screenshots go straight to the current page
- **Phone camera.** Scan a QR code shown in OpenNote to send photos and document scans from a phone
- **Zotero and BibTeX.** Cite sources while writing and export a bibliography in any common style
- **Canvas, Moodle, and Google Classroom.** Import assignments into a section and submit a page as PDF
- **Desmos, GeoGebra, Figma, Miro, and Lucidchart.** Live embeds that fall back to a static image offline
- **Kindle and Readwise.** Import book highlights into a notebook
- **Slack and Teams chat.** Share a page as a link, PDF, or image
- **Dropbox, OneDrive, iCloud Drive, Box, and WebDAV.** Sync folders and "Send to" destinations
- **End-to-end-encrypted sync (Beta).** Optional sync of the notes folder between devices through a folder or a WebDAV server the person already has, with no OpenNote server ([ADR 0049](adr/0049-end-to-end-encrypted-sync.md))
- **Webhooks and a local API.** Connect Zapier, Power Automate, or scripts to create pages and export files
- **AI assistants (Model Context Protocol, MCP).** Lets an assistant the person chooses read or write notes, only with permission

## Handwriting to text

- A "Writing pen" converts handwriting to typed text as the person writes, with the original ink kept one tap away
- Math is recognized as math: subscripts, superscripts, fractions, roots, integrals, matrices, and Greek letters become editable equations
- Special characters (°, ±, →, ≤, µ) and chemistry notation such as H₂O are kept
- Unsure words are underlined; tapping one shows alternatives
- Any existing ink can be converted later with the lasso
- Handwriting and transcripts are read in the background so search finds them, and a hit is marked on the ink

## My handwriting

- A calibration page learns the person's own handwriting from the pen: every letter, digit, and common punctuation mark and symbol three times each, then sentences that use them all, for spacing, x-height, cap height, ascenders and descenders, slant, baseline wobble, pressure, speed, and joins
- The style is kept only on this device, encrypted with XChaCha20-Poly1305 under a key in Windows Credential Manager, and is never synced, exported, indexed, logged, or put in a crash report
- Uploads of the person's own handwriting (scans, photos, PDFs) add math and science symbols and layout habits once the calibration page is done
- Math and science, an optional pen section, takes Greek letters, operators, arrows, accents, and brackets small and tall
- Write in my handwriting turns selected typed text, and its math, into ordinary editable ink, which replaces the text or goes beside it

## Shapes and lines

- Draw a rough shape and hold still for half a second
- Keep holding and move to resize or rotate it before lifting the pen
- A held line or arrow works differently: keep holding and move, and its far end follows the pen, snapping to the paper's lines and crossings when snapping is on
- Irregular shapes snap too: a trapezoid, a parallelogram, a house, an L, or any closed outline of 4 to 7 corners becomes a clean polygon with a handle on each corner
- Straight lines, arcs, curved arrows, and double arrows snap the same way
- A curved arrow's head points along the arc at its tip, from the library, after a handle drag, and when recognized, at any zoom
- Shapes keep editable handles, and connectors stay attached when shapes move
- Editable curves (Beta): Make curve turns a line, arrow, connector, recognized shape, or freehand stroke into a curve of Bezier segments with a point at each join and two handles

## Transcripts and summaries

- Every recording gets a transcript automatically, with a one-paragraph summary at the top
- Each line starts with a timestamp
- Different voices are labeled Speaker 1, Speaker 2, and so on
- Transcripts are searchable and can be edited to fix mistakes

## Study tools

- Flashcard and quiz blocks can be embedded in any page
- Make them by hand, or generate them from a page, a section or a recording's transcript
- Card types: question and answer, fill-in-the-blank, multiple choice, and image occlusion (hide part of a diagram)
- A spaced-repetition schedule shows which cards are due

## Civil, environmental, and chemical engineering tools

- Structures: continuous beams by moment distribution, fixed-end moments, influence lines, moving loads, truss influence lines, portal and cantilever methods, response spectra, and modal combination
- Soils: phase relations, classification, compaction, permeability, effective stress, consolidation, and shear strength
- Foundations: earth pressure, retaining walls, bearing capacity, slope stability, and piles
- Hydrology and open channels: runoff, hydrographs, routing, flood frequency, soil loss, channel flow, jumps, profiles, weirs, and pipe networks
- Groundwater and wells: Darcy flow, wells and pumping tests, flow nets, and contaminant transport
- Water quality and treatment: oxygen balance, carbonate chemistry, softening, and treatment units
- Transportation: traffic flow, queues, signals, highway geometry, travel demand, surveying, earthwork, and site planning
- Material balances and separations: flowsheet balances, energy balances, vapor-liquid equilibrium, flash, distillation, and absorption
- Chemical and biological reactors: ideal reactors, multiple reactions, temperature effects, residence times, growth, and activated sludge

## Page layouts

- Plain (no lines), infinite or paginated
- Ruled: narrow (6 mm), college (7 mm), wide (8.7 mm) and custom
- Grid: 5 mm, 1/4 in, 1 cm, and custom
- Cornell notes, lab notebook, music staff, planner, and storyboard
- Custom templates can be saved and shared

## Export a selection

- Export as PDF has an Update button once a page's PDF has been saved in this session
- Lasso any area, then choose "Export selection" to save it as PDF, PNG, SVG or `.docx`, or copy it as an image
- Palm lab (Settings > Pen and touch; Beta and dev builds): guided steps, a probe of what your pen and screen report, a labeled recording of the pen and hand, and a saved session file for the palm test corpus
- Pen library: fountain, brush, calligraphy, dashed, and dotted pens, each with its own sizes and colors (Draw tab > Width), and named pen sets you can save and switch between (Draw tab > Width)
- Links on handwriting: lasso writing and choose Make link to open a page, a heading, a web address, or the recording at that moment
- Ink layers: named layers you can hide, lock, rename, reorder and make active for new ink, with the lasso's Move to layer, export of one layer, and hidden layers left out of print and export
- Pen writing in text fields: with the setting on, the pen opens the Windows handwriting panel in the search box, rename fields, and table cells
- Delegated ink trail: the browser's compositor draws a short trail behind the pen ahead of the page, where the system supports it
- Smart select grows the lasso to include whole strokes, text boxes and images that it only partly touches, and trims empty margins
- This works for annotated images: import a photo, draw on it, and export just that part

## On-device intelligence setup

- **Recommended.** transcription, handwriting recognition, text in images (OCR) and summaries, all running on this device
- **Custom.** pick each feature, and choose a local model or your own cloud key
- **Not now.** everything stays off and can be turned on later in Settings

## Pages and search additions

- **Attachment Save a copy and thumbnails.** Right-click an attachment, or press Ctrl+K and choose "Save a copy of the attachment", to save the file through the Windows Save dialog
- **Crop fields in Size and position.** Size and position on a picture also shows how much to cut from each side, in percent, and Reset crop
- **Pin sections and color pages.** Right-click a section and choose Pin section to keep it above the others in its notebook, and Unpin section to let it sort again
- **Elements library: move and organize.** In the Elements library, Move on an element puts it in any folder, and Rename and Move on a folder rename it or put it inside another folder, with everything inside coming along
- **Links, search, and read aloud open folds.** A link, a search result, a tag line, Find on the page, read aloud, F7 to the next misspelling, and Undo or Redo all open the folded heading or list item that hides where they take you
- **Statistics, regression, and matrix tools for tables.** Data, Analyze (or Ctrl+K, "Table:") works from the selected cells, or the whole table
- **Choice columns in smart tables.** Data, Format, then the format "Choice, pick one" or "Choice, pick several" makes a column a list of named, colored choices, starting from the values it already holds
- **Saved views of a smart table.** Data, Saved views keeps a table's filters and sort under a name

## Quality-of-life fixes

- **Versions and trash.** page history, and a trash that keeps deleted items for 30 days
- **Clean paste.** pasting from the web keeps structure but drops stray fonts and colors
- **Speed.** large notebooks open lazily, and nothing freezes while syncing
- **Content locks.** text boxes and images can be locked in place
- **Sections and pages.** can be pinned, colored, sorted, and duplicated
- **Links.** internal links survive renames and moves
- **Tabs and windows.** open several pages side by side in tabs or windows
- **Snap tools.** a ruler, protractor, and snap-to-grid for neat diagrams
- **Measuring ruler, measure, and compass.** drawing aids on the Draw tab, in the command list, and in the page's right-click menu
- **Snap to paper lines.** on ruled, grid, and dot paper, lines, arrows, every shape, ink-to-shape shapes, library shapes, and shape handles snap to the lines the paper draws (grid crossings, dots, rules, and the margin line), on every sheet and at every zoom
- **Offline.** everything works offline, and conflicts are shown side by side, never silently overwritten
- **Export.** a whole notebook exports in one step, so data is never locked in
- **Quick capture.** A global shortcut opens a small note window from anywhere in Windows
- **Daily note.** One tap opens today's page, created from a template
- **Focus mode.** Hides panes and toolbars; the page stays centered
- **Reading mode.** Locks the page against accidental edits and ink
- **Find and replace.** Works on one page or a whole notebook, including handwriting that has been recognized One Undo, on the message or with Ctrl+Z, puts back a notebook-wide replace or a tag rename, merge, or delete
- **Typed #hashtags.** Typing `#word` and a space or punctuation makes it a tag of the page, listed in the Tags pane and found by `tag:` search
- **Word count and reading time.** Shown for the page or a selection
- **Table of contents.** Built from headings, pinned to the side of long pages
- **Recently closed.** Reopen closed pages and tabs with Ctrl+Shift+T
- **Mini window.** Keep a page on top of other apps while watching a lecture or a video
- **Remember position.** Each page reopens at the same scroll, zoom, and view
- **Drag and drop.** Drop files, images, PDFs, and links from anywhere
- **Copy text from images.** Select text inside any image or scanned PDF
- **Reminders.** Due dates on checkboxes, with Windows notifications
- **Presentation mode.** Full-screen pages with a laser pointer and ink that fades
- **Page title on printouts.** Print and Export as PDF put the page title and its date at the top of the first sheet, on by default
- **Print preview.** Shows exactly what prints, with page breaks
- **Print to a printer.** Print (Ctrl+P, the Export menu, or the palette) sends the page to a printer: printer, copies, collate, both sides, black and white, page range, and shrink to fit (the paper is the page layout's size)
- **Spell check.** Several languages at once, and a personal dictionary
- **Pen settings sync.** Pens, colors, and toolbars follow the person to every device
- **Low-power mode.** Reduces animations and background work on battery
- **Shortcut cheat sheet.** Ctrl+/ shows every shortcut, and each one can be changed
- **Password-protected sections.** Encrypted on disk, unlocked with Windows Hello

## More quality-of-life features by phase: Phase 2: App shell and navigation

- **Subpages and section groups.** Pages can sit under a parent page, 2 levels deep as in OneNote, and fold away with it
- **Back and forward.** Alt+Left, Alt+Right, the mouse side buttons, and toolbar arrows step through visited pages, including jumps from links and search
- **Quick switcher.** Ctrl+O finds a page by name, with recent pages first
- **OneNote shortcuts.** Setup offers a "OneNote" shortcut set, so switchers keep their habits, such as Ctrl+1 to Ctrl+9 for tags, Ctrl+Alt+1 to 6 for headings, and Ctrl+E to search
- **Recent pages on small screens.** In the compact layout, More in the bottom bar lists the last few pages opened, newest first, above Settings
- **Interface size.** Scales sidebars, toolbars, and menus from 90% to 150% without changing the page zoom
- **Dock to a screen edge.** A command docks OpenNote to the left or right edge of the screen as a narrow column, and other windows resize to leave room
- **Portable mode.** A file named `portable` next to the program keeps settings, caches, and downloaded models in that folder instead of the Windows profile
- **Select several pages.** Ctrl-click and Shift-click select several pages or sections in the tree

## More quality-of-life features by phase: Phase 3: Document model and storage

- **Scheduled backups.** Copies notebooks on a schedule, from hourly to weekly, to a folder the person picks, such as a USB drive or a second disk
- **Edits from other apps.** OpenNote watches the notes folder and reloads pages that other programs change, such as Git, Syncthing, or a script
- **Notes in OneDrive or Dropbox.** Setup and Settings notice when the notes folder is inside OneDrive, Dropbox, iCloud Drive, or Google Drive
- **Open a notebook from any folder.** "Open folder" opens a notebook that lives anywhere: another drive, a USB stick, a network share, or a folder in a Git repository
- **Check notebook.** Scans a notebook for damaged files, missing images and recordings, broken links, and pages whose readable copy doesn't match the page data
- **Open-source notices.** Settings, then About, has a section with the copyright lines and license text of the bundled fonts (Atkinson Hyperlegible, Literata), as the SIL Open Font License asks

## More quality-of-life features by phase: Phase 4: Typed notes

- **Language and spelling.** American English is the default, even when Windows uses another language
- **Editable text styles.** Normal text, Heading 1 to 6, Page title, Quote, and Code can each have their own font, size, color, and spacing in each notebook
- **Slash menu.** Typing "/" at the start of a line opens a filtered list of blocks, such as heading, checklist, table, callout, and code
- **Outline moves and folding.** Alt+Shift+Up and Alt+Shift+Down move the current paragraph or list item, with everything under it
- **Typing helpers.** A personal AutoCorrect list fixes typos, expands abbreviations, and turns "->" into "→"
- **Paste extras.** Pasting a web address over selected words turns them into a link
- **Read aloud.** Reads a page, a selection, or everything from the cursor aloud, and highlights each word as it is spoken
- **Reading order.** A "Reading order" pane lists a freeform page's text, ink, images, and tables in the order that screen readers, read aloud, and the Tab key visit them
- **Alt text.** Every image, drawing, and embedded object can have a text description, or be marked as decorative
- **Compare versions.** Page history shows what changed between any two versions, with added text underlined and removed text struck through
- **Wrap text around images.** In flow pages, an image can sit on the left or right with text wrapping around it, stay in the line, or stand alone with text above and below
- **Attachments that save back.** Word, Excel, PowerPoint, PDF, and other files can be attached to a page as an icon or a preview
- **Checklist shortcuts.** One key combination, which can be changed, toggles the current checkbox from the keyboard
- **Screenshot paste size.** Settings choose whether pasted screenshots and images arrive at actual size, fitted to the text column, or ask each time
- **Typewriter scrolling.** Keeps the line being typed at a set height on the screen, centered by default, so the eye stays still and the page moves instead
- **Thicker caret.** The text caret's width and color (the Windows text cursor indicator color, when one is set) follow the Windows text cursor settings, and Settings can override them from 1 to 6 pixels
- **Link titles on paste.** Off by default

## More quality-of-life features by phase: Phase 5: Ink

- **Insert space.** Drag a line across the page to push everything below it down, or drag up to close a gap
- **Ink that stays with its text.** Underlines, circles, and margin notes drawn on typed text are anchored to the words they touch
- **Zoom writing box.** A magnified strip docks at the bottom of the window
- **Pen and touch gestures.** Scribbling over ink erases it, and circling content and then tapping inside it selects it
- **Eraser and lasso filters.** The eraser can erase only highlighter, or only one pen type, and can switch back to the last tool when the pen lifts
- **Pen buttons.** Settings choose what the pen's side button and eraser end do: lasso, an eraser type, highlighter, pan, or the right-click menu
- **Pressure and steady pen.** Each pen device gets a pressure curve (soft, normal, firm, or custom, with a minimum width) and an optional stabilizer that smooths shaky strokes
- **Pen hover preview.** When a pen hovers above the screen, a small circle shows the tip's width and color, or the eraser's size and shape, so the person sees where ink will land before touching
- **Canvas lock.** A lock button in the toolbar stops the page from scrolling, zooming, or panning by touch, pen, or mouse wheel, so writing never moves the page
- **Pen writing in text fields.** A pen can write straight into the search box, rename fields, and table cells, and the handwriting turns into text as the person writes

## More quality-of-life features by phase: Phase 6: Page views and export

- **Reading aids.** A reading view adds a line focus band (1, 3, or 5 lines), soft page tints such as cream, sepia, and gray, extra word and paragraph spacing, a maximum line width, and optional syllable breaks
- **Sheet navigator.** In paginated view, a strip of sheet thumbnails and a "Go to sheet" command jump anywhere
- **Accessible PDF export.** Exported PDFs include structure tags for headings, lists, tables, reading order, alt text, and language, so screen readers can follow them
- **Math, graphs, and charts in PDF.** Equations print as text and shapes, a graph block as a vector drawing with its curves and axes, and the charts of a smart table right after the table
- **Elements library.** Lasso ink, shapes, text, and images, and "Save as element" keeps them for reuse, such as a header, a signature, a labeled axis, or part of a flowchart
- **Lock entry.** For lab notebooks and records, "Lock entry" makes a page read-only and stamps it with the date and time from the PC's clock

## More quality-of-life features by phase: Phase 7: Smart tables and charts

- **Accessible charts.** Each chart gets an editable text summary of its type, axes, range, trend, and highest and lowest values
- **Quick math.** Typing an expression such as `2.5*9.81=` and then Space adds the result, as in OneNote
- **Draw a grid to make a table.** Draw a rough grid with the pen and choose "Snap shape" or "Convert to table"

## More quality-of-life features by phase: Phase 8: Search and linking

- **Line tags and tag summary.** Ctrl+1 to Ctrl+9 tag any paragraph or list item as To do, Important, Question, Idea, or a custom tag
- **Links to paragraphs.** "Copy link" works on any page, heading, or paragraph, and `[[Page#Heading]]` autocompletes headings
- **Protected sections lock again.** Password-protected sections lock again after a chosen idle time, when the person leaves them, and when Windows locks or sleeps
- **Link previews.** Hovering over or focusing an internal link shows a small card with the target's first lines, heading, or paragraph
- **Unlinked mentions.** The backlinks pane has a second list of pages that mention this page's title without linking to it
- **Tag renaming.** Rename, merge, or delete a tag everywhere, including nested tags such as `school/biology`
- **Extract and merge pages.** "Extract to new page" moves the selected text, ink, or blocks into a new page and leaves a link in their place
- **Daily notes calendar.** A small month calendar opens the daily note for any day
- **Series pages.** A series groups pages that repeat, such as a weekly meeting or a lab log
- **Links on handwriting.** Lasso handwriting and choose "Make link" to link it to a page, a heading, a web address, or a moment in a recording

## More quality-of-life features by phase: Phase 9: Audio recording

- **Playback speed and skips.** Recordings play at 0.5x to 3x without changing pitch
- **Recording guard.** A live level meter shows while recording
- **Trim, split, and remove parts.** Trim silence at the start or end, split a long recording, or remove an "off the record" part from both the audio and its transcript
- **Mark moments.** A button or shortcut drops a flag at the current moment of a recording, with an optional short label
- **Ink replay.** Plays back a page or a selection stroke by stroke, in the order it was written, with play, pause, a slider, and speed from 0.5x to 4x
- **Voice enhancement.** "Enhance voice" reduces steady background noise and evens out loud and quiet speech, on the device
- **Recording storage.** A list shows each recording's length and size, and the page and notebook that hold it
- **Meeting detected prompt.** Off by default, and turned on only in Settings

## More quality-of-life features by phase: Phase 10: Math and study tools

- **Study tape.** Draw tape over any ink, text, or part of an image to hide it, then tap to show or hide it again
- **Math that screen readers speak.** Equations carry MathML behind the rendered math, so screen readers can speak them, show them in braille, and move through them term by term
- **Exam dates for decks.** Set an exam date on a deck, and the schedule spreads new and due cards so all are seen before that day
- **Inline flashcards.** Type a question and an answer on one line, separated by `::`, and the line becomes a card in the page's deck
- **Check my work.** Checks worked math one step at a time, typed or handwritten: each line against the line before it, for algebra, equations and their solutions, inequalities, derivatives, antiderivatives (by differentiating back), definite integrals, limits, sums, linear systems, matrices, vectors, and units
- **Tutor.** Hints one small step at a time: where to look, the idea, a question, then the next step, and the full solution only after trying, with a confirmation
- **Practice exams.** Make an exam-style paper from a page, a section, or a notebook: short answer, multiple choice, fill-in, worked problems with new numbers, and true or false, each with marks, at a chosen length and difficulty, with an optional timer that pauses and reminds
- **Visual equation editor.** Equations open in a MathLive editor with a virtual math keyboard for touch and pen, spoken output for screen readers, and a switch to LaTeX source

## More quality-of-life features by phase: Phase 11: Import and export

- **Import reports and undo.** Each import lands in its own notebook, with a report for each page: what came over, what was simplified, and what was skipped and why
- **Note space around slides and PDFs.** "Add note space" widens imported slides or PDF pages with a ruled or blank margin on the right, the bottom, or both
- **App permissions and access log.** Each app connected through the local API or an AI assistant (MCP) gets its own access: read-only or read and write, all notebooks or chosen ones, and never locked sections
- **Command-line tool.** An `opennote` command creates pages, appends text to the daily note, searches, exports, and runs a backup from a terminal or a script
- **Copy meeting recap.** For a page with a recording, "Copy recap" puts the summary, decisions, and action items on the clipboard as formatted text or Markdown, ready to paste into email or chat
- **Dim PDFs in dark mode.** Imported PDFs and slides can be dimmed or color-inverted in the Evening theme, with images kept in their own colors

## More quality-of-life features by phase: Phase 12: On-device intelligence

- **Dictation.** A Dictate button and shortcut type spoken words at the cursor, with spoken punctuation
- **Live captions.** While a recording runs, a caption strip shows the speech as text within seconds
- **Background work controls.** An activity panel lists queued work in plain words, such as reading text in images, recognizing handwriting, transcribing, and indexing
- **Custom transcript vocabulary.** A word list of names, course terms, acronyms, and spellings that the transcriber prefers
- **Transcript lines to notes.** Select lines in a transcript and press one key to copy them into the page's notes as a quote with its timestamp
- **Pen editing on typed text.** With the pen, a person can strike through words to delete them, draw a vertical line between words to add space or split a paragraph, circle words to select them, and write in a gap to insert text

## More quality-of-life features by phase: Phase 13: Hardening and beta

- **Accessibility checker.** "Check accessibility" lists problems on a page or section, each with a fix
- **Privacy panel and Work offline.** Settings, then Privacy, lists every kind of network use the app can make, such as update checks, model downloads, embeds, and linked accounts, with when each last ran
- **Safe start after crashes.** After two crashes in a row, the next start offers "Start in safe mode", which turns off background work, embeds, and on-device models
- **Installed apps entry.** The installer is per user, needs no administrator rights, and adds OpenNote to Windows Installed apps so it can be removed there
- **Updates that resume and wait for an unmetered network.** An update download that stops partway, because the PC slept or the network dropped, continues from where it stopped next time instead of starting again
- **Fuzzed importers.** Every importer that reads files from other apps (zip, Evernote, Word, OpenDocument, Excel, PowerPoint, web pages, web archives, Markdown, CSV, and SQLite) and the search indexer have fuzz targets
- **Update downloads that resume.** If an update download stops partway, the next try continues from the part already saved, after it is checked again

## Further features by phase: Phase 4: Typed notes

- **Page templates.** A template is a page with text, tables, checklists, and placeholders for the date, the title, and where the cursor lands
- **Markdown source view.** A toggle shows a typed page as Markdown text and lets the person edit it there

## Further features by phase: Phase 5: Ink

- **Layers.** Ink, shapes, text, and images can sit on named layers, such as "Slide", "Notes", and "Teacher's marks"
- **Pen library.** Beyond the pens and pencil, the library adds a fountain pen and a brush whose width follows pressure, tilt, and speed, a calligraphy nib with a fixed angle, and dashed and dotted line pens

## Further features by phase: Phase 6: Page views and export

- **Page gallery.** A gallery view of a section shows a thumbnail of every page with its title and date
- **Slides from a page.** "Present as slides" splits a page at its headings or at divider lines and shows each part as a full-screen slide

## Further features by phase: Phase 7: Smart tables and charts

- **Board, calendar, and gallery views.** A smart table can also show as a board (columns grouped by a choice or status column), a calendar (by a date column), a gallery of cards, or a timeline (start and end dates)
- **Diagrams from text.** A diagram block draws flowcharts, sequence diagrams, timelines, and class diagrams from a short text description in the Mermaid syntax, on the device
- **Code cells.** A code cell block runs a short Python (MicroPython) or JavaScript (QuickJS) program on the page when Run or Ctrl+Enter is pressed, and shows what it prints, with errors in red
- **Mind maps.** Type an outline and see it as a mind map, or build the map with the keyboard or the pen, and the outline updates
- **Shape libraries and text in shapes.** Shapes can hold text, and handwriting written inside a shape becomes its label when recognition is on (Phase 12)

## Further features by phase: Phase 8: Search and linking

- **Page properties.** Fields on a page, such as status, due date, course, author, rating, and a link to another page
- **Collections.** A collection is a saved view of pages chosen by a search, a tag, a section, or property values, such as "open assignments for Bio 201, grouped by due week"
- **Page embeds.** Typing `![[` and choosing a page, a heading, or a paragraph shows it live inside another page
- **Graph view.** Shows pages as dots and links as lines, for a whole notebook or for the pages within 1 to 3 links of the open one
- **Canvas of cards.** A canvas is an open board of cards: pages, typed notes, images, PDFs, web addresses, and groups, joined by labeled arrows
- **Advanced search.** Search understands "exact phrases", AND, OR, NOT, a minus sign to leave a word out, and a regular expression mode
- **Archive.** "Archive" hides finished pages, sections, and notebooks from the tree
- **Page shortcuts and jump list.** "Create shortcut" makes a Windows shortcut that opens a page, a section, or a notebook from the desktop, a folder, or the Start menu, and the person can pin it to the taskbar
- **Home page.** A start page shows recent pages, pinned pages, today's note, saved searches, and the Upcoming list, in plain sections the person can reorder or hide

## Further features by phase: Phase 9: Audio recording

- **Snap the screen.** While recording, a shortcut captures the screen, a window, or a region, such as a slide or a whiteboard, and puts it on the page time-stamped to the audio
- **Audio and video files.** Dropping an audio or video file, such as an MP3, M4A, WAV, or MP4 file, onto a page adds a player with the same time-stamped notes, playback speed, and flags as a recording

## Further features by phase: Phase 10: Math and study tools

- **Math with variables and units.** Write `rent = 1,200` on one line and `rent * 12 =` on another, and the result updates when the first changes
- **Deck import.** Imports decks from Anki packages and from CSV or text files, with their images

## Further features by phase: Phase 11: Import and export

- **OneNote files from disk.** Reads OneNote notebook packages (`.onepkg`) and section files (`.one`) saved on the computer, with no sign-in
- **Import from other apps.** Imports Notion exports (Markdown and CSV, with databases becoming smart tables), Google Keep exports from Takeout, Joplin exports, Bear TextBundle files, and Logseq folders
- **Goodnotes, Notability, and Samsung Notes.** Imports the handwriting apps' own files (`.goodnotes` and backups of them, `.note`, `.sdocx`) into a notebook, one section for each file
- **Windows Sticky Notes.** Imports the notes from the Sticky Notes app on this PC, with their text, colors, and dates, into a notebook of their own
- **Open single files.** "Open with OpenNote" on a Markdown or text file opens it as a page and saves back to the same file
- **Highlights from PDFs.** Select text on an imported PDF page and press a key to highlight it in one of the highlighter colors
- **Scan cleanup.** "Clean up" takes a photo of a page, a whiteboard, or a slide, finds its edges, straightens the perspective, evens out the lighting, and offers color, grayscale, or black and white
- **Web pages.** "Export as web page" writes one self-contained `.html` file with the text, images, ink as vector graphics, and recordings with a player that highlights notes as the audio plays
- **Share as a file.** Saves a page, a section, or a notebook as one file that opens in OpenNote, with its structure, tags, properties, and, if chosen, history

## Further features by phase: Phase 12: On-device intelligence

- **Reflow and tidy handwriting.** Lasso handwriting and drag its side handles, and the words rewrap to the new width
- **Search by meaning and ask your notes.** "Find by meaning" matches pages about the same idea even when the words differ, and a Related pages list sits beside each page
- **Writing tools.** Select text, and choose Proofread, Rewrite, Shorten, Make a list, or Tidy structure
- **Action items and chapters.** After transcription, "Find action items" lists tasks and decisions
- **Translate on this device.** Translates a selection, a page, or a transcript into another language and puts the translation beside or below the original, never over it

## Productivity and study tools: Phase 8: Search and linking

- **Upcoming list.** Any checkbox or tagged line can have a due date, typed in plain words such as "Fri 5 PM", "tomorrow", or "Dec 3"
- **Repeating to-dos.** A due date can repeat: "every weekday", "every 2 weeks", "monthly on the 1st", or "3 days after I finish"
- **Class schedule.** A weekly schedule holds classes or meetings with their names, days, times, and rooms

## Productivity and study tools: Phase 10: Math and study tools

- **Tool windows.** Small windows for tools such as timers, the calculator, Upcoming, flashcard review, the dictionary, the unit converter, and reference tables
- **Symbol palette and \alpha autocompletion.** A searchable palette of Greek letters and math, science, and engineering symbols with recent symbols first (Insert tab, command palette, slash menu, Ctrl+Alt+Shift+S); clicking a symbol inserts it at the caret
- **Timers.** Three kinds: a countdown, a stopwatch with laps, and a focus timer with work and break lengths the person sets, such as 25 and 5 minutes
- **Calculator.** A calculator window with seven tabs
- **Scientific constants.** A searchable window of 23 physical constants from the 2022 CODATA recommended values (NIST, public domain): the speed of light, the Planck constant, the Boltzmann constant, the Avogadro constant, the elementary charge, G, g, the gas constant, the electric constant, the magnetic constant
- **Insert LaTeX.** A window with a LaTeX field, a live preview drawn by KaTeX, a choice of in the line or on its own line, and a palette of snippets: fractions, roots, powers, sums, products, integrals, limits, derivatives, matrices, cases, vectors, Greek letters, and common symbols
- **Significant-figures helper.** A window that counts the significant figures of a number (0.00120 has 3; 1200 has 2, with a note that its zeros are unclear and the clear way to write it)
- **3D graphs.** A graph block or the calculator's Graphing 3D tab draws z = f(x, y) as a shaded surface, and curves and surfaces traced by t, or by u and v
- **Live solving.** On the line being typed, an equation with one unknown such as `2x + 3 = 11` shows `x = 4` in gray, and Tab adds it as a line that later lines can use
- **Graph an equation.** A selected equation, or lassoed handwriting read as math, offers Graph
- **Steps, systems, and matrices.** The equation panel's Steps shows a derivative rule by rule, and an integral from a table of rules, with a definite integral's value
- **Exam countdown.** Add an exam, with a name, a date, and an optional time, to a notebook, a section, or a deck
- **Dictionary and thesaurus.** Select a word and press a shortcut, or type in the tool window, to see meanings, synonyms, and examples
- **Unit converter.** Converts length, area, volume, mass, temperature, speed, time, pressure, energy, power, angle, data size, force, frequency, density, torque, fuel economy (including liters per 100 km), electric current, voltage, and resistance
- **Reference tables.** A periodic table as a keyboard-navigable grid (arrow keys, Home, and End) with a family filter, a list view, and a card for each element that shows its atomic number, mass, family, period, group, electron configuration, density, melting point, boiling point, electronegativity
- **Reference tables.** A periodic table with name, symbol, atomic number, mass, group, and electron configuration, and tables of physical constants, metric prefixes, and Greek letters
- **Chemistry calculators.** One window with six tabs: balance an equation (including charges), molar mass and percent composition, stoichiometry with the limiting reagent and percent yield, gas laws (ideal, combined, Graham, density), solutions (dilution, molarity, pH, buffers), and titration (curve, equivalence point, unknown concentration)
- **Chemical structures.** Type SMILES text or choose a starting structure, and see a skeletal formula with its formula and molar mass
- **Property tables.** Saturated steam (by temperature or pressure, with interpolation), ideal-gas specific heats from 250 to 1000 K, and a materials table (density, modulus, yield, conductivity, specific heat)

## Productivity and study tools: Phase 11: Import and export

- **Calendar files and course imports.** Imports iCalendar files (`.ics`) from a calendar app or a school portal into the class schedule and the Upcoming pane
- **Citation helper.** Keeps a list of sources for each notebook
- **Zotero citations in the page.** With Zotero running, Add or edit citation, Add or edit bibliography, Refresh, Unlink, and Document settings open Zotero's own windows, and the result goes into the text block that has the caret

## Math solvers

- **Double and triple integrals.** Pick a region (rectangle, region between two curves, disk, box, cylinder, ball, or cone) or type your own limits, and pick rectangular, polar, cylindrical, or spherical coordinates
- **Differential equations.** Separable, first-order linear (with the integrating factor), and second-order linear equations with constant coefficients (characteristic equation, and undetermined coefficients for polynomial, exponential, sine, and cosine forcing, including resonance)
- **Laplace and Fourier transforms.** Forward and inverse Laplace transforms with steps (table lookups, the shift and multiply-by-tⁿ properties, poles and partial fractions, and delays as unit steps), Fourier transforms of table pairs in both directions, and searchable tables of pairs and properties
- **Taylor and Maclaurin series.** Expands f about a point to order n, with each derivative, the polynomial written the textbook way, a Lagrange bound on the error at a point next to the actual error, and a graph of f with its partial sums
- **Root finding.** Newton's method, bisection, and the secant method with an iteration table, a report of how the run ended (converged with the estimated order, diverged, flat tangent, cycle, or no sign change), and the tangent steps, secants, or brackets drawn on the graph
- **Error propagation and unit checks.** Propagates the uncertainty of independent measurements through an expression, with each partial derivative, each variable's share, and the result rounded as a lab report writes it
- **Probability and regression.** Normal, binomial, and Student t distributions: the probability below, above, between, or outside values with the area or bars shaded, and two-sided critical values
- **Eigenvalues and eigenvectors.** For a 2×2 or 3×3 matrix: the characteristic polynomial, the eigenvalues (real or complex), the eigenvectors and their eigenspaces, whether the matrix can be diagonalized
- **Projectile simulator.** Range, highest point, time of flight, and landing speed and angle for a launch from a height, worked in closed form, and with optional quadratic air resistance (from mass, drag coefficient, diameter, and air density) by Runge-Kutta

## 3D graphs, vectors, and motion

- **3D graphs.** A graph block that starts with `@3d` plots surfaces z = f(x, y), curves in space, vectors, points, lines, and planes in a box you turn with a drag or the arrow keys
- **Parametric and polar curves.** Graph blocks take `(x(t), y(t))`, `r = f(θ)`, vector fields `F = (P, Q)`, and slope fields `dy/dx = f(x, y)`
- **Vector tools.** Dot and cross products, lengths, the angle, scalar and vector projections, the unit vector, the parallelogram's area, and the triple product, with a 3D plot
- **Lines and planes.** Distances, intersections, and angles between points, lines, and planes in 3D, with a plot
- **Solids of revolution.** Turns the region between two curves about y = k or x = k
- **Projectile simulator.** Speed, angle, height, gravity, and linear drag give the time of flight, range, highest point, and landing speed

## Engineering tools

- **Free-body diagram kit.** A block with a body, forces, moments, and pin, roller, and fixed supports as shapes that snap to the grid and to each other. ΣFx, ΣFy, and ΣM about a chosen point show beside the drawing as the parts change
- **Beam and truss solver.** A beam block with pin, roller, and fixed supports, point loads, linearly varying distributed loads, and moments that slide along the beam
- **Circuit symbols and DC solver.** A circuit block with resistors, voltage and current sources, grounds, and wires on a grid
- **Units and engineering notation in tables.** A smart table column can carry a unit, such as kN, MPa, or N·m

## Statistical models kit

- **Linear regression.** Fits a model formula with categorical predictors and interactions, with robust and clustered errors, diagnostics, prediction intervals, nested-model tests, moderation, mediation, and a random intercept
- **Logistic and Poisson regression.** Fits 0/1, grouped, and count outcomes with odds or rate ratios, likelihood-ratio tests, the ROC curve, and the IRLS steps
- **Econometrics and causal inference.** Panel fixed effects, two-stage least squares, difference-in-differences with event-study plots, regression discontinuity, propensity-score weighting and matching, and back-door sets from causal diagrams
- **Survival analysis.** Kaplan-Meier curves with log-rank tests, Cox proportional hazards, and life tables
- **Time series and forecasting.** Correlograms and Ljung-Box, periodograms, decomposition, exponential smoothing, AR and ARIMA forecasts with intervals, hold-out accuracy, Mann-Kendall with Sen's slope, and Dickey-Fuller with simulated quantiles
- **PCA, factors, and clusters.** Principal components, factor analysis with rotation and parallel analysis, k-means, Gaussian mixtures by EM, hierarchical clustering with a dendrogram, a clustered heat map, and multidimensional scaling
- **Machine learning lab.** Nearest neighbors, trees, naive Bayes, logistic regression, the perceptron, a small neural network, ridge, and the lasso on toy sets or your data, with seeded splits, cross-validation, and the usual scores and curves
- **Spatial statistics.** Point-pattern statistics, Moran's I and Geary's C with local clusters, semivariograms, ordinary kriging with contour maps, and inverse-distance weighting
- **Live calculation block from a model.** The Insert menu's Live calculation block keeps the tool's answer with its key results on the page

## Music, script, camera, and studio tools

- **Score block.** ABC notation read, engraved as a picture, played, transposed by interval, to a key, or for a transposing instrument, and shown as numbered notation, sargam, or guitar tablature
- **Music theory.** Intervals, pitch and frequency, scales and modes from several traditions, melakarta by rule, maqam and gamelan in cents, chords, keys, Roman numerals, transposing instruments, pitch-class sets, twelve-tone matrices, jazz scales, and guitar shapes
- **Voice-leading checker.** Four-part chorale rules at three strictness levels and first to fourth species counterpoint, with each problem located
- **Ear training.** Seeded drills for intervals, chords, scales, melodic and rhythmic dictation, and sight-singing, graded sessions, and review dates from the flashcard schedule
- **Tuning and rhythm.** Cents and temperaments, beat rates, the harmonic series, a metronome, Euclidean rhythms, polyrhythms, and rhythmic cycles
- **Script formatter.** Fountain screenplays and stage plays laid out in script format, with page and time estimates and scene, character, location, and breakdown lists
- **Camera, timing, and lighting.** Exposure, depth of field, field of view, shutter angle, timecode, footage, animation planning, lighting, and media storage arithmetic
- **Scale, color, and materials.** Drawing scales, grid enlargement, color contrast and vision checks, color spaces, palettes, type scales, perspective grids, and material quantities

## Subject tool kits

- **Kit foundation.** Shared numerics (matrices, polynomial roots, quadrature, ODE solvers, special functions), air and water properties, 38 unit kinds, and the kit window parts
- **Live calculation block.** A block that keeps a tool's answer, key results, and inputs on the page
- **Circuits and energy.** Transients, a circuit simulator (DC, AC sweep, transient), op-amps and filters, semiconductors, instruments, AC power, power flow, data fitting, and energy
- **Fluids and heat transfer.** Fluid statics and Bernoulli, pipe flow and pumps, dimensional analysis, viscous and external flow, conduction, fins, transient conduction, convection, heat exchangers, radiation, and water and air properties
- **Solid mechanics.** Columns, stress and strain, sections, members, deflection, pressure vessels, thin-walled structures, composite laminates, tissues and joints, fatigue and machine elements, and a finite element workbench
- **Aerospace.** Standard atmosphere, compressible flow, nozzles, rocket nozzles, finite wings, performance and stability, potential flow, dynamic modes, jet engine cycles, and airfoils
- **Chemistry and materials.** Thermochemistry, equilibrium, acids and bases, electrochemistry, kinetics, solutions, crystals and diffraction, defects and diffusion, phase diagrams, and atoms and bonding
- **Thermodynamics.** Statistical thermodynamics, ideal gases, steam (IAPWS-IF97), psychrometrics, R-134a, steady-flow devices, cycles, real gases and mixtures, and combustion
- **Dynamics and control.** System models, root locus, Bode and Nyquist, compensators and PID, state space, digital control, probability, Markov chains and queues, reliability, and Kalman filtering
- **Design tools.** Tolerances and fits, machining, forming and joining, micro and nano fabrication, number representation, programming references, orthographic views, a memory tracer, and a drafting sheet
- **Engineering mathematics.** Series, complex analysis, systems of ODEs, Fourier series and boundary value problems, numerical methods, a matrix console, a linear algebra workbench, and vector calculus
- **Mechanisms and dynamics.** Linkages, cams, gears, compliant mechanisms, rigid-body dynamics, Lagrangian mechanics, 3D rotations, vibration, and robot arms
- **Physics tools.** Waves and sound, relativity, wave and geometric optics, nuclear science, spacecraft sizing, fields, and orbits and maneuvers
- **Earth sciences.** Atmospheric thermodynamics and soundings; radiation, climate, and footprints; geochronology, isotopes, and the time scale; stereonets and structural geology; stratigraphy and classification diagrams; air quality and weather observations; seismology and seismic surveys; gravity, magnetics, heat flow, and plates; and ocean, waves, and planetary flow
- **Reasoning kit.** Logic, automata and grammars, numbers and groups, digital logic, computer systems (caches, scheduling, pipelines, deadlock, networks, logical clocks, normal forms, relational algebra, and digests), algorithms, optimization, and games and voting, with worked steps

## Document structure

- **Equation numbers and references.** A display equation with a label gets a number at its right edge, and an inline reference shows the number of the equation it names
- **Formula sheet builder.** Collects the display equations of this page, the selected pages, or the section into a new page laid out in one to four columns, grouped by heading, without repeats, so it fits one sheet
- **Practice mode.** Shows a worked problem with its solution steps hidden
- **Problem-set templates.** Problem set (Given, Find, Solution, Answer), Cornell notes, and Lab report in the new-page chooser, before the person's own templates
- **Figure exporter.** Saves a graph or diagram from the page as an SVG or as a PNG at 72 to 600 DPI, numbered and captioned, with an optional source line

## macOS and Linux

- **macOS and Linux builds.** `OpenNote_macOS.dmg` (one universal app for macOS 11 and later) and `OpenNote_Linux.AppImage` (64-bit, glibc 2.35 or later), unsigned until the owner adds the signing secrets
- **Menu bar on macOS.** The Mac menu bar lists OpenNote's commands, one menu per category as in the shortcut list, with each command's key equivalent (`⇧⌘D`), next to the app menu (About, Settings, Hide, Quit), Edit (Undo, Cut, Copy, Paste), and Window
- **Save as PDF and Print on macOS and Linux.** Save as PDF and Print use the same print window, range, and headers as on Windows
- **Read aloud and spell check on macOS and Linux.** Read aloud uses the system voices (`say` on a Mac, `espeak-ng` on Linux), with each word marked as it is read
- **Command line on macOS and Linux.** The `opennote` command is built for both Mac processors and Linux, and OpenNote puts it at `~/.local/bin/opennote` each time it starts
- **Sign-ins and sync keys on macOS and Linux.** Connector tokens and sync keys go in the login Keychain on a Mac, and in the Secret Service (GNOME Keyring or KWallet) on Linux
- **Text in pictures and handwriting on macOS and Linux.** Text in pictures is read on the device by Apple's Vision on a Mac, and by Tesseract on Linux when it is installed

## Subject kit foundations

- **Data input.** A data field reads pasted text, a CSV or TSV file, or a table on the open page, with missing values, decimal commas, role pickers, a long and wide reshape, a matrix grid, and a value list
- **Distributions.** Exact and noncentral distributions, the studentized range, exact proportion and count intervals, and exact null distributions for rank tests, for every subject kit to use
- **Curve fitting and likelihood.** Weighted Levenberg-Marquardt fitting with standard errors and bands, and maximum likelihood with standard errors and profile intervals
- **Repeatable random results.** A seeded generator that gives the same results on every computer, with a seed field that shows, takes, and renews the seed
- **Plots and coefficient tables.** Histograms, densities, ECDF, Q-Q, box, fit-band, step, forest, and ROC plots, and a coefficient table that states each verdict in words
- **Tree and graph layouts.** Tidy tree layouts and layered and force-directed graph layouts, drawn as SVG for trees, networks, and diagrams
- **Figure blocks.** A tool's diagram on the page as a picture with its description and an Open in tool button that reopens the inputs that made it

## History, places, languages, and texts kit

- **Note frames.** Note structures for writing, history, law, and field work, found by subject or by searching, inserted as headings, prompts, lists, and a table
- **Coordinates and navigation.** Converts between latitude and longitude, UTM, and MGRS, measures geodesic distance and bearing, and works grid zone, site grid, land, and marine navigation problems
- **Timeline builder.** Draws events and periods on parallel tracks with era bands, uncertainty bars, BCE dates without a year zero, and linear, deep-time logarithmic, or broken axes; compares two rows and inserts an editable figure
- **Calendars and eras.** Converts a date among thirteen calendars and counts (Gregorian, Julian, Hebrew, tabular Islamic, astronomical Solar Hijri and Chinese, Coptic, Ethiopian, French Republican, Saka, Maya, Roman, and Japanese eras) with the steps, lists a year's festivals, and reads a user era table
- **Text analysis and verse.** Readability formulas with heuristic flags, word lists and n-grams with a Zipf plot, a concordance with collocates, keyness by log-likelihood, word-level comparison of versions, MLU for language samples, and English and Latin scansion
- **Linguistic structures.** Syntax trees from labeled brackets and dependency trees with arcs, Leipzig-style interlinear gloss checks, a distinctive feature chart with natural classes, ordered rules with derivations and rule interactions, syllables by sonority, and vowel charts with Lobanov or Bark scaling
- **Scripts, keyboards, and romanization.** On-screen keyboards for IPA and many scripts, ALA-LC and BGN/PCGN romanization, Hangul composition with Revised Romanization and McCune–Reischauer, kana and Hepburn both ways, pinyin tone marks and sandhi, Thai tone rules, and Vietnamese Telex and VNI input
- **Map maker.** Twelve projections (Snyder's formulas and Equal Earth), the student's points, great-circle routes, and GeoJSON or TopoJSON layers with equal-interval, quantile, or Jenks choropleth classes, Tissot indicatrices, legend, scale bar, and north arrow; geodesic distance and spherical area
- **Identification keys.** Builds a numbered dichotomous key and its tree from a character table, runs it couplet by couplet, filters with a multi-access key, and keeps a catalog of identified specimens or objects

## Signals, images, sound, and communications

- **Spectrum analyzer.** Amplitude, power, density, Welch, and spectrogram views of pasted samples, a sound file, or a value (and time) column of a table on the open page, with window corrections, a Parseval check, band powers, peaks, and damping from the half-power points
- **Digital filter designer.** FIR filters by the window method (with Kaiser's estimates), Butterworth, Chebyshev, and elliptic IIR filters by the bilinear transform or impulse invariance in second-order sections, notch and moving-average filters, every response and the pole-zero plot, fixed-point coefficients, and causal or zero-phase filtering of data
- **Convolution, sampling, and discrete systems.** Convolution as a flip, shift, multiply, and sum table, correlation lags, difference equations with their poles, aliasing and reconstruction, quantization noise, rate changes, and continuous convolution
- **Sound analysis and acoustics.** Opens or records sound (kept on the device) and shows its waveform, wide- and narrow-band spectrograms, a YIN pitch track, intensity, Burg LPC formants, labeled intervals, jitter, and shimmer; a tuner with an adjustable A4; tone practice against Chao tone numbers
- **Neural and physiological time series.** Epochs with baseline correction, amplitude rejection, averages with standard errors, peaks, and mean amplitudes; canonical double-gamma HRF regressors, collinearity, and a GLM with t for a contrast; spike rasters, PSTH and kernel rates, CV, and Fano factor
- **Image lab.** Window, level, stretch, and gamma with a histogram; manual and Otsu thresholds with connected-component counts, areas, and centroids; box, Gaussian, sharpen, Sobel, Prewitt, Laplacian, custom, and Canny filters; erosion, dilation, opening, and closing; 2D FFT masks; scale calibration, distances, and rectangle statistics
- **Medical imaging physics.** Larmor frequency, spin-echo, gradient-echo, and inversion-recovery signals with contrast against TR, a Bloch simulator with spin echoes, a k-space masking demonstration on the Shepp-Logan phantom, Hounsfield units and windows, ultrasound reflection, depth, attenuation, and Doppler, X-ray half-value layers, and PET SUV with decay correction
- **Information, coding, and modulation.** Entropy, mutual information, and channel capacity; Huffman, Shannon-Fano, and LZ78 source codes; Hamming and linear block codes; standard CRCs; Viterbi decoding; and constellations, bit-error rates, and eye diagrams
- **Transmission lines and RF.** Reflection, VSWR, and input impedance (open and shorted loads included) on a Smith chart with the standing-wave pattern; L-section, single-stub, and quarter-wave matching; coax, two-wire, and microstrip impedance; S, Z, Y, and ABCD conversion with stability and cascades; Friis noise cascades; antenna links

## Modern physics and astronomy tools

- **Quantum wells, barriers, and wave packets.** Bound states of preset or typed potentials by finite differences beside the exact levels, with expectation values; transmission through steps, barriers, wells, and layered structures; a wave packet moved in time; quantum dots; and the Gamow factor
- **Angular momentum, spin, and qubits.** Exact Clebsch-Gordan coefficients, 3j symbols, and coupling tables; spin, Pauli, and Dirac matrices with commutators and eigenvalues; Stern-Gerlach analyzers on the Bloch sphere; Larmor precession; and circuits of up to five qubits with the state after each gate
- **Atoms, spectra, and X-rays.** Hydrogen-like lines with the reduced mass and air wavelengths, radial and angular wavefunctions, fine structure, term symbols with Hund's ground level and Landé g, Zeeman patterns, electric-dipole selection rules, and Moseley's law with a Bragg angle
- **Molecular spectra, mass spectra, and polymers.** Rotational, vibrational, and rovibrational spectra of diatomics; exact masses, isotope patterns, and unsaturation from a formula; first-order NMR multiplets and integration; and polymer molar masses, chain sizes, and Flory-Huggins mixing
- **Solids and semiconductor devices.** The free-electron gas, Kronig-Penney bands, tight-binding and phonon dispersion, carriers and the Fermi level with incomplete ionization, transport and the Hall effect, p-n junctions, MOS capacitors, and solar cells
- **Plasmas and space physics.** Debye length, plasma and gyro frequencies, collisions, Alfvén and sound speeds, sheaths, a planet's dipole field and drift periods, the magnetopause, and the fusion triple product
- **Stars, light, and exoplanets.** Distances and magnitudes, blackbody light, HR diagrams with mass and lifetime estimates, the Saha equation, compact objects, the Jeans mass, and transit, radial-velocity, equilibrium-temperature, and habitable-zone numbers for exoplanets
- **Sky positions and sun paths.** Julian Date and sidereal time, the Sun and Moon in the sky, coordinate conversions with precession, rise and set times with twilight, sun-path diagrams, and shadow and overhang sizes
- **Cosmology, galaxies, and telescopes.** Distances and ages in a Friedmann universe, the Hubble law, galaxy rotation curves, telescope and sensor numbers, the CCD equation, and photons from a magnitude

## Molecular biology, genetics, and evolution

- **DNA and RNA sequences.** Cleans, complements, translates, and counts a sequence and finds open reading frames, motifs, GC windows, CRISPR guides, and the effect of a mutation
- **Cloning, PCR, and gels.** Digests linear or circular DNA with 56 built-in enzymes or your own, draws a virtual gel and a plasmid map, sizes bands from a ladder, reports primer melting temperatures (Wallace, salt-adjusted, SantaLucia nearest-neighbor), finds PCR products, and works out oligo concentrations, ligation amounts
- **Proteins and peptides.** Gives a protein's mass, isoelectric point, charge curve, extinction coefficient, and hydropathy plot
- **Sequence alignment.** Aligns 2 DNA or protein sequences globally, locally, or semi-globally with the score matrix shown, and draws dot plots
- **Phylogenetic trees.** Builds trees from alignments or distance matrices by UPGMA or neighbor-joining with each matrix shown, scores and searches trees by parsimony, adds seeded bootstrap support, and reads, reroots, draws, and answers questions about Newick trees
- **Genetic crosses and linkage.** Works Punnett squares for up to 3 genes, chi-square tests, 2- and 3-point gene maps, LOD scores, and carrier risk
- **Population genetics.** Tests Hardy-Weinberg (chi-square and exact), and models selection, mutation, migration, seeded drift, effective size, linkage disequilibrium, and heritability
- **Family, pedigree, and kinship charts.** Draws pedigrees in NSGC symbols from a typed list, checks 6 inheritance patterns, works genotype probabilities by peeling, sums relationship and inbreeding coefficients, reads kin types from Ego, orders succession, and draws genograms

## Economics and finance

- **Economics and finance calculators.** One window with 87 calculators in eight subjects (money over time, markets, firms, consumer choice, macroeconomics, measurement, accounting, investments)

## Statistics kit

- **Describe data.** Summary statistics with bias-adjusted skewness and kurtosis, trimmed and other means, outlier screens with Grubbs' test, stem-and-leaf displays, frequency tables, grouped data, and category counts
- **ANOVA.** One-way and Welch ANOVA with assumption checks, Tukey, Games-Howell, and adjusted pairwise tests, contrasts, two-way (Type II and III), repeated-measures, and mixed designs, and effect sizes with exact intervals
- **Rank tests.** Mann-Whitney, Wilcoxon signed-rank, sign, Kruskal-Wallis with Dunn, Friedman with Conover and Nemenyi, Hodges-Lehmann, and Kolmogorov-Smirnov tests, exact for small samples
- **Contingency tables.** Chi-square and G tests with residuals, Fisher's exact test, McNemar, Cochran's Q, association measures, the trend test, and forecast skill scores
- **Epidemiology.** Risk and odds ratios with intervals, Mantel-Haenszel strata with Breslow-Day, diagnostic accuracy, rates, and direct (US 2000 standard, NCHS) and indirect standardization
- **Correlation.** Pearson, Spearman, Kendall, point-biserial, and partial correlations, matrices with adjusted p-values, and comparisons of 2 correlations
- **Power and sample size.** Solves for n, power, the detectable effect, or alpha from exact noncentral distributions for the common tests, with a power curve
- **Multiple testing and meta-analysis.** p-value adjustments and q-values, Fisher and Stouffer, fixed- and random-effects meta-analysis with forest and funnel plots, volcano and Manhattan plots, and printed critical-value tables
- **Simulation and resampling.** Seeded bootstrap intervals (percentile, basic, BCa), exact or Monte Carlo permutation tests, a sampling-distribution lab, and simulations
- **Bayesian updating.** Conjugate updates with credible and highest-density intervals, Savage-Dickey and JZS Bayes factors, grid posteriors, a Metropolis sampler, Bayes tables, and exact inference in Bayesian networks of up to 8 true-or-false nodes
- **Sampling and randomization.** Assignment lists, Latin and Williams squares, factorial layouts, samples from a frame, allocation, stratified estimates, design effects, and margins of error

## Psychology and behavior kit

- **Signal detection.** d′, c, β, A′, and B″ from counts or rates, m-alternative forced choice, and ROC and z-ROC fits from rating data
- **Psychophysics.** Psychometric function fits with guess and lapse rates, thresholds, PSE, JND, and bootstrap intervals; staircases; limits and adjustment; Weber, Fechner, and Stevens; visual angle, contrast, and logMAR
- **Decision and choice models.** Drift-diffusion accuracy, decision times, densities, and simulations; speed-accuracy curves; EZ-diffusion; prospect-theory values, weights, and gamble certainty equivalents
- **Learning and reinforcement.** Rescorla-Wagner and Pearce-Hall over phases, TD prediction errors, grid-world planning and Q-learning or SARSA, bandit regret, reinforcement schedules, and learning curves
- **Response times and movement.** Trimming with counts removed, condition means with within-subject intervals and inverse efficiency, ex-Gaussian fits, quantile and delta plots, and Fitts' and Hick-Hyman laws
- **Behavior observation.** Session logs typed or recorded live give rates, durations, time budgets, bouts, latencies, and transitions; interval recording; observer agreement; single-case graphs with PND, NAP, and Tau
- **Inter-rater agreement.** Cohen's and weighted kappa, Scott's pi, Fleiss' kappa, Krippendorff's alpha, intraclass correlations, and Bland-Altman limits
- **Scales and psychometrics.** Questionnaire scoring with reverse items and subscales, alpha, KR-20, split-half, item analysis, score transforms, System Usability Scale, and IRT curves
- **Qualitative coding.** Code frequencies, code-by-case and co-occurrence matrices with Jaccard similarity, passages by code, two-coder agreement, a codebook with parent codes, and content-analysis tallies

## Life science tools

- **Physiology calculators.** Cardiac output, MAP, resistance, Laplace tension, a beating P-V loop from a time-varying elastance, ventricular-arterial coupling, the alveolar gas equation, O₂ content, the Severinghaus curve, the Krogh cylinder, ventilation, clearance, FENa, glucose titration, acid-base, fluids, BMR, METs, LMS z-scores, and water potential
- **Neurons and excitable cells.** Nernst and GHK potentials, Donnan equilibrium, RC charging, Hodgkin-Huxley current and voltage clamp with TTX and TEA, thresholds, integrate-and-fire, cables, conduction speed, and synaptic summation
- **Pharmacokinetics and drug response.** One- and two-compartment models, multiple dosing, non-compartmental analysis, Michaelis-Menten elimination, BSA dose scaling, release kinetics, Emax, occupancy, therapeutic index, and linked PK-PD effect
- **Binding, enzyme, and dose-response fits.** Michaelis-Menten and inhibition fits beside the linear plots, Hill fits, binding with Scatchard, Cheng-Prusoff, isotherms, 4PL and 5PL standard curves, EC50, Schild pA₂, probit LD50 with Fieller limits, and LQ survival
- **Bench calculations.** Molarity, dilutions, master mixes, buffers, centrifuge force, cell and plate counts, MOI, growth rates, qPCR, microscopy, and calibration curves
- **Population dynamics.** Growth models, harvesting, predator-prey, competition, metapopulations, island biogeography, species-area fits, and the logistic map
- **Life tables and demography.** Life tables, fertility rates, R₀ and r, Leslie and Lefkovitch matrices with elasticities, cohort projections, and pyramids
- **Compartment, reaction, and agent models.** SIR-type epidemics, fitting β and γ to case counts, final size, Reed-Frost, reaction networks by ODE and seeded Gillespie runs, Schelling, lattice and network SIR, thresholds, the voter model, Life, cellular automata, and random networks
- **Biodiversity and field sampling.** Diversity and Hill numbers, Chao and ACE richness, rarefaction, similarity indices, quadrat and transect sampling, dispersion, and mark-recapture

## Screens

### First-time setup

**setup-welcome.** Step 1 of 6: the welcome desk by the window. ([dark](screens/setup-welcome-dark.png))

![Step 1 of 6: the welcome desk by the window.](screens/setup-welcome-light.png)

**setup-look.** Step 2: the Light, Dark, and Match Windows preview cards. ([dark](screens/setup-look-dark.png))

![Step 2: the Light, Dark, and Match Windows preview cards.](screens/setup-look-light.png)

**setup-intelligence.** Step 3: on-device intelligence, with Not now selected. ([dark](screens/setup-intelligence-dark.png))

![Step 3: on-device intelligence, with Not now selected.](screens/setup-intelligence-light.png)

**setup-keys-and-pen.** Step 4: the shortcut set and the pen top button. ([dark](screens/setup-keys-and-pen-dark.png))

![Step 4: the shortcut set and the pen top button.](screens/setup-keys-and-pen-light.png)

**setup-storage.** Step 5: the notes folder and the first notebook. ([dark](screens/setup-storage-dark.png))

![Step 5: the notes folder and the first notebook.](screens/setup-storage-light.png)

**setup-import.** Step 6: bringing in notes from another app. ([dark](screens/setup-import-dark.png))

![Step 6: bringing in notes from another app.](screens/setup-import-light.png)

### The workspace

**workspace.** Notebooks, pages, and a page of typed notes with a heading, a list, and a page link. ([dark](screens/workspace-dark.png))

![Notebooks, pages, and a page of typed notes with a heading, a list, and a page link.](screens/workspace-light.png)

**workspace-empty.** The empty state: no notebooks yet, and the desk by the window beside the page card. ([dark](screens/workspace-empty-dark.png))

![The empty state: no notebooks yet, and the desk by the window beside the page card.](screens/workspace-empty-light.png)

**tab-home.** The Home tab with the recording control and the formatting bar. ([dark](screens/tab-home-dark.png))

![The Home tab with the recording control and the formatting bar.](screens/tab-home-light.png)

### Writing and drawing

**tab-insert.** The Insert tab: link, code block, callout, divider, template, file, equation, and table. ([dark](screens/tab-insert-dark.png))

![The Insert tab: link, code block, callout, divider, template, file, equation, and table.](screens/tab-insert-light.png)

**tab-draw.** The Draw tab: the tools, the pen slots, color, and width (1600 by 900). ([dark](screens/tab-draw-dark.png))

![The Draw tab: the tools, the pen slots, color, and width (1600 by 900).](screens/tab-draw-light.png)

**tab-view.** The View tab: panes, page layout, paper, background, and focus mode. ([dark](screens/tab-view-dark.png))

![The View tab: panes, page layout, paper, background, and focus mode.](screens/tab-view-light.png)

**ink-pens.** Ink on a page: a highlighter, three pens, and a pencil sketch (1600 by 900). ([dark](screens/ink-pens-dark.png))

![Ink on a page: a highlighter, three pens, and a pencil sketch (1600 by 900).](screens/ink-pens-light.png)

**lined-paper.** Typed notes on lined paper, with the text sitting on the rules. ([dark](screens/lined-paper-dark.png))

![Typed notes on lined paper, with the text sitting on the rules.](screens/lined-paper-light.png)

**table-chart.** A smart table with a formula cell and the bar chart made from it. ([dark](screens/table-chart-dark.png))

![A smart table with a formula cell and the bar chart made from it.](screens/table-chart-light.png)

**insert-mind-map.** A mind map on a page, with a main idea and branches added under and beside it. ([dark](screens/insert-mind-map-dark.png))

![A mind map on a page, with a main idea and branches added under and beside it.](screens/insert-mind-map-light.png)

**insert-diagram.** A flowchart written as text, drawn below its source. ([dark](screens/insert-diagram-dark.png))

![A flowchart written as text, drawn below its source.](screens/insert-diagram-light.png)

**ink-layers.** The Layers window with three layers, each with Make active, Hide, Lock, Move, Export, and Delete. ([dark](screens/ink-layers-dark.png))

![The Layers window with three layers, each with Make active, Hide, Lock, Move, Export, and Delete.](screens/ink-layers-light.png)

**ink-groups.** Two pen strokes lassoed and grouped, with the Ungroup button on the selection bar. ([dark](screens/ink-groups-dark.png))

![Two pen strokes lassoed and grouped, with the Ungroup button on the selection bar.](screens/ink-groups-light.png)

**ink-links.** The list of links on a page after a lassoed stroke was linked to a web address. ([dark](screens/ink-links-dark.png))

![The list of links on a page after a lassoed stroke was linked to a web address.](screens/ink-links-light.png)

### Find, link, and record

**search.** The search panel with a result, the matched word in bold, and a preview. ([dark](screens/search-dark.png))

![The search panel with a result, the matched word in bold, and a preview.](screens/search-light.png)

**backlinks.** The linked pages pane, listing the page that links here. ([dark](screens/backlinks-dark.png))

![The linked pages pane, listing the page that links here.](screens/backlinks-light.png)

**recording.** The recording options under the Record button. Nothing is recording. ([dark](screens/recording-dark.png))

![The recording options under the Record button. Nothing is recording.](screens/recording-light.png)

**daily-calendar.** The daily notes calendar, with today marked and buttons for the day, week, month, and year notes. ([dark](screens/daily-calendar-dark.png))

![The daily notes calendar, with today marked and buttons for the day, week, month, and year notes.](screens/daily-calendar-light.png)

### Study

**study-flashcards.** The Flashcards window, with cards made from three typed lines. ([dark](screens/study-flashcards-dark.png))

![The Flashcards window, with cards made from three typed lines.](screens/study-flashcards-light.png)

**study-tutor.** The Tutor panel giving the first of four hints on a worked line, without the answer. ([dark](screens/study-tutor-dark.png))

![The Tutor panel giving the first of four hints on a worked line, without the answer.](screens/study-tutor-light.png)

### Graphs, math, and tools

**math-graph.** An inline equation in a sentence and a graph block with its function. ([dark](screens/math-graph-dark.png))

![An inline equation in a sentence and a graph block with its function.](screens/math-graph-light.png)

**engineering-beam.** The beam deflection tool of the solid mechanics kit, with its supports and loads. ([dark](screens/engineering-beam-dark.png))

![The beam deflection tool of the solid mechanics kit, with its supports and loads.](screens/engineering-beam-light.png)

**subject-statistics.** The Statistics tab of the calculator after summarizing six numbers. ([dark](screens/subject-statistics-dark.png))

![The Statistics tab of the calculator after summarizing six numbers.](screens/subject-statistics-light.png)

### Import and export

**import.** The Import notes dialog before a file is chosen, with the supported sources. ([dark](screens/import-dark.png))

![The Import notes dialog before a file is chosen, with the supported sources.](screens/import-light.png)

**import-review.** The review after choosing a file: what comes over and what does not. ([dark](screens/import-review-dark.png))

![The review after choosing a file: what comes over and what does not.](screens/import-review-light.png)

**export.** The Export dialog with a section and the Word document format chosen. ([dark](screens/export-dark.png))

![The Export dialog with a section and the Word document format chosen.](screens/export-light.png)

**pdf-import.** A PDF inserted as locked page pictures to write on. ([dark](screens/pdf-import-dark.png))

![A PDF inserted as locked page pictures to write on.](screens/pdf-import-light.png)

**translate.** The Translate window, with the language pack and its size shown before anything is downloaded. ([dark](screens/translate-dark.png))

![The Translate window, with the language pack and its size shown before anything is downloaded.](screens/translate-light.png)

### Connectors and sync

**protected-section.** A password-protected section after it locks, with the Unlock section button. ([dark](screens/protected-section-dark.png))

![A password-protected section after it locks, with the Unlock section button.](screens/protected-section-light.png)

**sync-settings.** Settings, then Sync: step 1 of 4, choosing where sync keeps its encrypted data. ([dark](screens/sync-settings-dark.png))

![Settings, then Sync: step 1 of 4, choosing where sync keeps its encrypted data.](screens/sync-settings-light.png)

### Settings

**settings-general.** General: the notes folder and start-up. ([dark](screens/settings-general-dark.png))

![General: the notes folder and start-up.](screens/settings-general-light.png)

**settings-appearance.** Appearance: theme cards, page color, text size, and interface size. ([dark](screens/settings-appearance-dark.png))

![Appearance: theme cards, page color, text size, and interface size.](screens/settings-appearance-light.png)

**settings-editing.** Editing: Markdown shortcuts, the slash menu, and AutoCorrect. ([dark](screens/settings-editing-dark.png))

![Editing: Markdown shortcuts, the slash menu, and AutoCorrect.](screens/settings-editing-light.png)

**settings-intelligence.** On-device intelligence: every feature off, each marked as running on this device. ([dark](screens/settings-intelligence-dark.png))

![On-device intelligence: every feature off, each marked as running on this device.](screens/settings-intelligence-light.png)

**settings-privacy.** Privacy: work offline and a plain list of every network use. ([dark](screens/settings-privacy-dark.png))

![Privacy: work offline and a plain list of every network use.](screens/settings-privacy-light.png)

**settings-connectors.** Connectors: accounts that some features use, each saying "Needs setup". ([dark](screens/settings-connectors-dark.png))

![Connectors: accounts that some features use, each saying "Needs setup".](screens/settings-connectors-light.png)

**settings-shortcuts.** Shortcuts: the two sets and the list of commands to change. ([dark](screens/settings-shortcuts-dark.png))

![Shortcuts: the two sets and the list of commands to change.](screens/settings-shortcuts-light.png)

**settings-about.** About: version, channel, license, and the window drawing. ([dark](screens/settings-about-dark.png))

![About: version, channel, license, and the window drawing.](screens/settings-about-light.png)

### Trash, the palette, and tool windows

**trash.** Trash with two deleted pages and a Restore button for each. ([dark](screens/trash-dark.png))

![Trash with two deleted pages and a Restore button for each.](screens/trash-light.png)

**palette.** The command palette over a page, with pages and commands. ([dark](screens/palette-dark.png))

![The command palette over a page, with pages and commands.](screens/palette-light.png)

**tool-timer.** The timers window with a countdown running. ([dark](screens/tool-timer-dark.png))

![The timers window with a countdown running.](screens/tool-timer-light.png)

**tool-calculator.** The calculator after a unit conversion, with its history. ([dark](screens/tool-calculator-dark.png))

![The calculator after a unit conversion, with its history.](screens/tool-calculator-light.png)

**tool-upcoming.** The Upcoming window for tasks and due dates. ([dark](screens/tool-upcoming-dark.png))

![The Upcoming window for tasks and due dates.](screens/tool-upcoming-light.png)
