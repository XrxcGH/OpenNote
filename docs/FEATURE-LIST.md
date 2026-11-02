# OpenNote feature list

Every tool, action, and feature in OpenNote, grouped by category, with one sentence each. `npm run docs:features` makes this page. The commands, tool windows, title bar items, settings sections, and setup steps come from what the app registers, so a new one shows up here or fails the tests. The feature sentences come from [FEATURES.md](FEATURES.md), which also says what has been tested by hand and which flag turns each one on. The [help pages](help/README.md) explain how to use them. [docs/screens](screens/README.md) has every picture in light and dark.

The app registers 778 commands and 47 tool windows. 24 of the windows are subject and engineering kits. The command palette (Ctrl+K) runs every command not marked as left out of it. Some commands need a feature flag, which FEATURES.md names. The keys shown are the defaults of the standard shortcut set.

## Contents

- [Writing and typing](#writing-and-typing)
- [Tables and charts](#tables-and-charts)
- [Drawing and ink](#drawing-and-ink)
- [Page views and printing](#page-views-and-printing)
- [Notebooks and navigation](#notebooks-and-navigation)
- [Search and links](#search-and-links)
- [Audio and transcription](#audio-and-transcription)
- [Math and homework](#math-and-homework)
- [Engineering kits](#engineering-kits)
- [Subject and catalog kits](#subject-and-catalog-kits)
- [Study tools](#study-tools)
- [On-device intelligence](#on-device-intelligence)
- [Import and export](#import-and-export)
- [Sync and connectors](#sync-and-connectors)
- [Protection and privacy](#protection-and-privacy)
- [Settings and accessibility](#settings-and-accessibility)
- [Platforms](#platforms)

## Writing and typing

### Features

#### Typed notes

- **Editable text styles.** Normal text, Heading 1 to 6, Page title, Quote, and Code can each have their own font, size, color, and spacing in each notebook.
- **Slash menu.** Typing "/" at the start of a line opens a filtered list of blocks, such as heading, checklist, table, callout, and code.
- **Outline moves and folding.** Alt+Shift+Up and Alt+Shift+Down move the current paragraph or list item, with everything under it.
- **Typing helpers.** A personal AutoCorrect list fixes typos, expands abbreviations, and turns "->" into "→".
- **Paste extras.** Pasting a web address over selected words turns them into a link.
- **Alt text.** Every image, drawing, and embedded object can have a text description, or be marked as decorative.
- **Compare versions.** Page history shows what changed between any two versions, with added text underlined and removed text struck through.
- **Wrap text around images.** In flow pages, an image can sit on the left or right with text wrapping around it, stay in the line, or stand alone with text above and below.
- **Attachments that save back.** Word, Excel, PowerPoint, PDF, and other files can be attached to a page as an icon or a preview.
- **Checklist shortcuts.** One key combination, which can be changed, toggles the current checkbox from the keyboard.
- **Screenshot paste size.** Settings choose whether pasted screenshots and images arrive at actual size, fitted to the text column, or ask each time.
- **Typewriter scrolling.** Keeps the line being typed at a set height on the screen, centered by default, so the eye stays still and the page moves instead.
- **Thicker caret.** The text caret's width and color (the Windows text cursor indicator color, when one is set) follow the Windows text cursor settings.
- **Link titles on paste.** Off by default. When turned on, pasting a web address asks that site for its page title and shows the title as the link text.
- **Page templates.** A template is a page with text, tables, checklists, and placeholders for the date, the title, and where the cursor lands.
- **Markdown source view.** A toggle shows a typed page as Markdown text and lets the person edit it there.

#### Document structure

- **Equation numbers and references.** A display equation with a label gets a number at its right edge, and an inline reference shows the number of the equation it names.
- **Problem-set templates.** Problem set (Given, Find, Solution, Answer), Cornell notes, and Lab report in the new-page chooser, before the person's own templates.

### Commands

| Command | Default keys |
| --- | --- |
| Insert mind map |  |
| Insert diagram from text |  |
| Insert code cell | Ctrl+Alt+Shift+K |
| Number this equation |  |
| Number all equations |  |
| Remove equation number |  |
| Insert equation reference |  |
| Bold | Ctrl+B |
| Italic | Ctrl+I |
| Underline | Ctrl+U |
| Strikethrough | Ctrl+Shift+S |
| Highlight | Ctrl+Shift+H |
| Inline code | Ctrl+E |
| Subscript |  |
| Superscript |  |
| Larger text | Ctrl+> |
| Smaller text | Ctrl+< |
| Text color |  |
| Text size |  |
| Clear formatting | Ctrl+\ |
| Clear all formatting |  |
| Link | Ctrl+K |
| Normal text | Ctrl+Shift+N |
| Heading 1 | Ctrl+Alt+1 |
| Heading 2 | Ctrl+Alt+2 |
| Heading 3 | Ctrl+Alt+3 |
| Heading 4 | Ctrl+Alt+4 |
| Heading 5 | Ctrl+Alt+5 |
| Heading 6 | Ctrl+Alt+6 |
| Bulleted list | Ctrl+Shift+8 |
| Numbered list | Ctrl+Shift+7 |
| Checklist | Ctrl+Shift+9 |
| Quote | Ctrl+Shift+B |
| Callout |  |
| Code block |  |
| To Do |  |
| Check or uncheck | Ctrl+Enter |
| Divider |  |
| Turn into |  |
| Date | Alt+Shift+D |
| Time | Alt+Shift+T |
| Date and time | Alt+Shift+F |
| Move up | Alt+Shift+Up |
| Move down | Alt+Shift+Down |
| Promote | Alt+Shift+Left |
| Demote | Alt+Shift+Right |
| Fold | Alt+_ |
| Unfold | Alt++ |
| Show all levels | Alt+Shift+0 |
| Show level 1 | Alt+Shift+1 |
| Show level 2 | Alt+Shift+2 |
| Show level 3 | Alt+Shift+3 |
| Show level 4 | Alt+Shift+4 |
| Show level 5 | Alt+Shift+5 |
| Show level 6 | Alt+Shift+6 |
| Show level 7 | Alt+Shift+7 |
| Show level 8 | Alt+Shift+8 |
| Show level 9 | Alt+Shift+9 |
| Text color of the selected blocks |  |
| Open link (not in the palette) |  |
| Copy link (not in the palette) |  |
| Edit link (not in the palette) |  |
| Remove link (not in the palette) |  |
| Text styles |  |
| Image… |  |
| Crop image |  |
| Alt text… |  |
| Copy as Markdown |  |
| New text box |  |
| Bring to front | Ctrl+} |
| Send to back | Ctrl+{ |
| Bring forward | Ctrl+] |
| Send backward | Ctrl+[ |
| Edit text | F2 |
| Delete | Delete |
| Lock |  |
| Lock position |  |
| Unlock |  |
| Float |  |
| Put in flow |  |
| Size and position |  |
| Announce word count |  |
| Check all items |  |
| Uncheck all items |  |
| Keep finished items in place |  |
| Move finished items to the bottom |  |
| Hide finished items |  |
| Show done count |  |
| New page from template |  |
| Insert template |  |
| Use this page as a template |  |
| Stop using this page as a template |  |
| Set the default template for this section |  |
| New page in series |  |
| Show pages in this series |  |
| Show page as Markdown | Ctrl+Alt+M |
| Attach file |  |
| Open attachment |  |
| Show attachment as icon or preview |  |
| Save a copy of the attachment |  |
| Stand alone |  |
| In line |  |
| Image on the left, text wraps |  |
| Image on the right, text wraps |  |
| Next spelling error | F7 |
| Previous spelling error | Shift+F7 |
| Open in another editor |  |
| Undo | Ctrl+Z |
| Redo | Ctrl+Y, Ctrl+Shift+Z |
| Select the page title |  |
| Undo | Ctrl+Z |
| Redo | Ctrl+Y, Ctrl+Shift+Z |

### Pictures

**slash-menu.** The slash menu after typing a slash on an empty line, listing the blocks to insert. ([dark](screens/slash-menu-dark.png))

![The slash menu after typing a slash on an empty line, listing the blocks to insert.](screens/slash-menu-light.png)

**formatting-bar.** The formatting bar over a selected sentence, with bold, italic, color, and link. ([dark](screens/formatting-bar-dark.png))

![The formatting bar over a selected sentence, with bold, italic, color, and link.](screens/formatting-bar-light.png)

**block-callouts.** Note, tip, and warning callouts on a page, each with its own color and icon. ([dark](screens/block-callouts-dark.png))

![Note, tip, and warning callouts on a page, each with its own color and icon.](screens/block-callouts-light.png)

**block-code.** A code block with Python highlighting, its language label, and the copy button. ([dark](screens/block-code-dark.png))

![A code block with Python highlighting, its language label, and the copy button.](screens/block-code-light.png)

**lined-paper.** Typed notes on lined paper, with the text sitting on the rules. ([dark](screens/lined-paper-dark.png))

![Typed notes on lined paper, with the text sitting on the rules.](screens/lined-paper-light.png)

**insert-mind-map.** A mind map on a page, with a main idea and branches added under and beside it. ([dark](screens/insert-mind-map-dark.png))

![A mind map on a page, with a main idea and branches added under and beside it.](screens/insert-mind-map-light.png)

**insert-diagram.** A flowchart written as text, drawn below its source. ([dark](screens/insert-diagram-dark.png))

![A flowchart written as text, drawn below its source.](screens/insert-diagram-light.png)

**code-cell.** A Python code cell that has run, with its output below the code. ([dark](screens/code-cell-dark.png))

![A Python code cell that has run, with its output below the code.](screens/code-cell-light.png)

**page-templates.** The new page chooser with the Problem set, Cornell notes, and Lab report templates. ([dark](screens/page-templates-dark.png))

![The new page chooser with the Problem set, Cornell notes, and Lab report templates.](screens/page-templates-light.png)

**page-history.** The page history panel with earlier versions and the compare view of one of them. ([dark](screens/page-history-dark.png))

![The page history panel with earlier versions and the compare view of one of them.](screens/page-history-light.png)

## Tables and charts

### Features

#### Smart tables and charts

- **Quick math.** Typing an expression such as `2.5*9.81=` and then Space adds the result, as in OneNote.
- **Draw a grid to make a table.** Draw a rough grid with the pen and choose "Snap shape" or "Convert to table".
- **Board, calendar, and gallery views.** A smart table can also show as a board (columns grouped by a choice or status column), a calendar (by a date column), and a gallery of cards.
- **Diagrams from text.** A diagram block draws flowcharts, sequence diagrams, timelines, and class diagrams from a short text description in the Mermaid syntax, on the device.
- **Code cells.** A code cell block runs a short Python (MicroPython) or JavaScript (QuickJS) program on the page when Run or Ctrl+Enter is pressed, and shows what it prints.
- **Mind maps.** Type an outline and see it as a mind map, or build the map with the keyboard or the pen, and the outline updates.
- **Shape libraries and text in shapes.** Shapes can hold text, and handwriting written inside a shape becomes its label when recognition is on (Phase 12).

### Commands

| Command | Default keys |
| --- | --- |
| Calculated column… |  |
| Turn calculated column into values |  |
| Set column unit |  |
| Show column in engineering notation |  |
| Show column with SI prefixes |  |
| Show column in plain numbers |  |
| Sort smallest first |  |
| Sort largest first |  |
| Fill down | Ctrl+D |
| Fill right | Ctrl+R |
| Show rows equal to this cell |  |
| Show rows with something in this column |  |
| Clear filter |  |
| Automatic |  |
| Number |  |
| Currency |  |
| Percent |  |
| Date |  |
| More decimal places |  |
| Fewer decimal places |  |
| Save table view… |  |
| Show every row of the table |  |
| Choice, pick one |  |
| Choice, pick several |  |
| Choose a value… | Alt+Down |
| Edit choices… |  |
| Sum |  |
| None |  |
| Bar chart |  |
| Line chart |  |
| Area chart |  |
| Pie chart |  |
| Scatter chart |  |
| Table: Summary statistics of the selection |  |
| Table: Histogram of the selection |  |
| Table: Box plot of the selection |  |
| Table: Linear fit of the selection |  |
| Table: Quadratic fit of the selection |  |
| Table: Cubic fit of the selection |  |
| Table: Polynomial fit of the selection |  |
| Table: Exponential fit of the selection |  |
| Table: Matrix determinant |  |
| Table: Matrix inverse |  |
| Table: Matrix transpose |  |
| Table: Multiply the selected matrix by another range |  |
| Table: Row reduce the selected matrix with steps |  |
| Table: Matrix rank |  |
| Table: Matrix eigenvalues |  |
| Table: Solve the selected system Ax = b |  |
| Table: Linear fit of the selection as an equation |  |
| Table: Quadratic fit of the selection as an equation |  |
| Table: Cubic fit of the selection as an equation |  |
| Table: Exponential fit of the selection as an equation |  |
| Table: Determinant of the selection as an equation |  |
| Table: Inverse of the selection as an equation |  |
| Table: Transpose of the selection as an equation |  |
| Table: Row reduced form of the selection as an equation |  |
| Table: Rank of the selection as an equation |  |
| Table: Eigenvalues of the selection as an equation |  |
| Table: Solution of Ax = b as an equation |  |
| Insert table |  |

### Pictures

**table-chart.** A smart table with a formula cell and the bar chart made from it. ([dark](screens/table-chart-dark.png))

![A smart table with a formula cell and the bar chart made from it.](screens/table-chart-light.png)

## Drawing and ink

### Features

#### Handwriting to text

- A "Writing pen" converts handwriting to typed text as the person writes, with the original ink kept one tap away.
- Math is recognized as math: subscripts, superscripts, fractions, roots, integrals, matrices, and Greek letters become editable equations.
- Special characters (°, ±, →, ≤, µ) and chemistry notation such as H₂O are kept.
- Unsure words are underlined; tapping one shows alternatives.
- Any existing ink can be converted later with the lasso.
- Handwriting and transcripts are read in the background so search finds them, and a hit is marked on the ink.

#### My handwriting

- A calibration page learns the person's own handwriting from the pen: every letter, digit, and common punctuation mark and symbol three times each, and then sentences that use them all.
- The style is kept only on this device, encrypted with XChaCha20-Poly1305 under a key in Windows Credential Manager, and is never synced, exported, indexed, and logged.
- Uploads of the person's own handwriting (scans, photos, PDFs) add math and science symbols and layout habits once the calibration page is done.
- Math and science, an optional pen section, takes Greek letters, operators, arrows, accents, and brackets small and tall.
- Write in my handwriting turns selected typed text, and its math, into ordinary editable ink, which replaces the text or goes beside it.

#### Shapes and lines

- Draw a rough shape and hold still for half a second.
- Keep holding and move to resize or rotate it before lifting the pen.
- A held line or arrow works differently: keep holding and move, and its far end follows the pen, snapping to the paper's lines and crossings when snapping is on.
- Irregular shapes snap too: a trapezoid, a parallelogram, a house, and an L.
- Straight lines, arcs, curved arrows, and double arrows snap the same way.
- A curved arrow's head points along the arc at its tip, from the library, after a handle drag, and when recognized, at any zoom.
- Shapes keep editable handles, and connectors stay attached when shapes move.
- Editable curves (Beta): Make curve turns a line, arrow, connector, recognized shape, or freehand stroke into a curve of Bezier segments with a point at each join and two handles.

#### Ink

- **Insert space.** Drag a line across the page to push everything below it down, or drag up to close a gap.
- **Ink that stays with its text.** Underlines, circles, and margin notes drawn on typed text are anchored to the words they touch.
- **Zoom writing box.** A magnified strip docks at the bottom of the window.
- **Pen and touch gestures.** Scribbling over ink erases it, and circling content and then tapping inside it selects it.
- **Eraser and lasso filters.** The eraser can erase only highlighter, or only one pen type, and can switch back to the last tool when the pen lifts.
- **Pen buttons.** Settings choose what the pen's side button and eraser end do: lasso, an eraser type, highlighter, pan, or the right-click menu.
- **Pressure and steady pen.** Each pen device gets a pressure curve (soft, normal, firm, or custom, with a minimum width) and an optional stabilizer that smooths shaky strokes.
- **Pen hover preview.** When a pen hovers above the screen, a small circle shows the tip's width and color, or the eraser's size and shape.
- **Canvas lock.** A lock button in the toolbar stops the page from scrolling, zooming, or panning by touch, pen, or mouse wheel, so writing never moves the page.
- **Pen writing in text fields.** A pen can write straight into the search box, rename fields, and table cells, and the handwriting turns into text as the person writes.
- **Layers.** Ink, shapes, text, and images can sit on named layers, such as "Slide", "Notes", and "Teacher's marks".
- **Pen library.** Beyond the pens and pencil, the library adds a fountain pen and a brush whose width follows pressure, tilt, and speed, and a calligraphy nib with a fixed angle.

#### More

- Palm lab (Settings > Pen and touch; Beta and dev builds): guided steps, a probe of what your pen and screen report, and a labeled recording of the pen and hand.
- Pen library: fountain, brush, calligraphy, dashed, and dotted pens, and each with its own sizes and colors (Draw tab > Width).
- Links on handwriting: lasso writing and choose Make link to open a page, a heading, a web address, or the recording at that moment.
- Ink layers: named layers you can hide, lock, rename, reorder and make active for new ink, with the lasso's Move to layer, and export of one layer.
- Pen writing in text fields: with the setting on, the pen opens the Windows handwriting panel in the search box, rename fields, and table cells.
- Delegated ink trail: the browser's compositor draws a short trail behind the pen ahead of the page, where the system supports it.
- Smart select grows the lasso to include whole strokes, text boxes and images that it only partly touches, and trims empty margins.
- **Snap tools.** A ruler, protractor, and snap-to-grid for neat diagrams.
- **Measuring ruler, measure, and compass.** Drawing aids on the Draw tab, in the command list, and in the page's right-click menu.
- **Snap to paper lines.** On ruled, grid, and dot paper, lines, arrows, every shape, ink-to-shape shapes, library shapes, and shape handles snap to the lines the paper draws (grid crossings, dots, and rules.
- **Links on handwriting.** Lasso handwriting and choose "Make link" to link it to a page, a heading, a web address, or a moment in a recording.

### Pictures

**ink-pens.** Ink on a page: a highlighter, three pens, and a pencil sketch (1600 by 900). ([dark](screens/ink-pens-dark.png))

![Ink on a page: a highlighter, three pens, and a pencil sketch (1600 by 900).](screens/ink-pens-light.png)

**ink-pen-types.** Lines drawn with the fountain pen, brush, calligraphy pen, dashed pen, and dotted pen. ([dark](screens/ink-pen-types-dark.png))

![Lines drawn with the fountain pen, brush, calligraphy pen, dashed pen, and dotted pen.](screens/ink-pen-types-light.png)

**ink-eraser.** The eraser options open on the Draw tab, with the stroke and partial erasers. ([dark](screens/ink-eraser-dark.png))

![The eraser options open on the Draw tab, with the stroke and partial erasers.](screens/ink-eraser-light.png)

**ink-lasso.** Strokes chosen with the lasso, with the selection frame and the selection bar. ([dark](screens/ink-lasso-dark.png))

![Strokes chosen with the lasso, with the selection frame and the selection bar.](screens/ink-lasso-light.png)

**ink-shapes.** Hand-drawn shapes snapped to a clean line, arrow, rectangle, and circle, with the Shapes menu open. ([dark](screens/ink-shapes-dark.png))

![Hand-drawn shapes snapped to a clean line, arrow, rectangle, and circle, with the Shapes menu open.](screens/ink-shapes-light.png)

**ink-ruler.** The ruler and the protractor on a page, with a straight line drawn along the ruler. ([dark](screens/ink-ruler-dark.png))

![The ruler and the protractor on a page, with a straight line drawn along the ruler.](screens/ink-ruler-light.png)

**ink-layers.** The Layers window with three layers, each with Make active, Hide, Lock, Move, Export, and Delete. ([dark](screens/ink-layers-dark.png))

![The Layers window with three layers, each with Make active, Hide, Lock, Move, Export, and Delete.](screens/ink-layers-light.png)

**ink-groups.** Two pen strokes lassoed and grouped, with the Ungroup button on the selection bar. ([dark](screens/ink-groups-dark.png))

![Two pen strokes lassoed and grouped, with the Ungroup button on the selection bar.](screens/ink-groups-light.png)

**ink-links.** The list of links on a page after a lassoed stroke was linked to a web address. ([dark](screens/ink-links-dark.png))

![The list of links on a page after a lassoed stroke was linked to a web address.](screens/ink-links-light.png)

**settings-pen.** Pen and touch: the writing hand, drawing with a finger, steady pen, and the pressure curve. ([dark](screens/settings-pen-dark.png))

![Pen and touch: the writing hand, drawing with a finger, steady pen, and the pressure curve.](screens/settings-pen-light.png)

**settings-my-handwriting.** My handwriting: calibration and the symbols written in your own hand. ([dark](screens/settings-my-handwriting-dark.png))

![My handwriting: calibration and the symbols written in your own hand.](screens/settings-my-handwriting-light.png)

## Page views and printing

### Features

#### Page layouts

- Plain (no lines), infinite or paginated.
- Ruled: narrow (6 mm), college (7 mm), wide (8.7 mm) and custom.
- Grid: 5 mm, 1/4 in, 1 cm, and custom.
- Cornell notes, lab notebook, music staff, planner, and storyboard.
- Custom templates can be saved and shared.

#### Page views and export

- **Reading aids.** A reading view adds a line focus band (1, 3, or 5 lines), soft page tints such as cream, sepia, and gray, and extra word and paragraph spacing.
- **Sheet navigator.** In paginated view, a strip of sheet thumbnails and a "Go to sheet" command jump anywhere.
- **Accessible PDF export.** Exported PDFs include structure tags for headings, lists, tables, reading order, alt text, and language, so screen readers can follow them.
- **Math, graphs, and charts in PDF.** Equations print as text and shapes, a graph block as a vector drawing with its curves and axes, and the charts of a smart table right after the table.
- **Elements library.** Lasso ink, shapes, text, and images, and "Save as element" keeps them for reuse, such as a header, a signature, a labeled axis, or part of a flowchart.
- **Page gallery.** A gallery view of a section shows a thumbnail of every page with its title and date.
- **Slides from a page.** "Present as slides" splits a page at its headings or at divider lines and shows each part as a full-screen slide.

#### More

- **Export.** A whole notebook exports in one step, so data is never locked in.
- **Reading mode.** Locks the page against accidental edits and ink.
- **Presentation mode.** Full-screen pages with a laser pointer and ink that fades.
- **Page title on printouts.** Print and Export as PDF put the page title and its date at the top of the first sheet, on by default.
- **Print preview.** Shows exactly what prints, with page breaks.
- **Print to a printer.** Print (Ctrl+P, the Export menu, or the palette) sends the page to a printer: printer, copies, collate, both sides, black and white, and page range.

### Commands

| Command | Default keys |
| --- | --- |
| Open the canvas |  |
| Zoom page in | Ctrl+Alt+= |
| Zoom page out | Ctrl+Alt+- |
| Actual page size | Ctrl+Alt+0 |
| Fit page to width |  |
| Change page layout |  |
| Switch between reading view and canvas |  |
| Reading order |  |
| Lock page for reading | Ctrl+Alt+L |
| Turn typewriter scrolling on or off |  |
| Show or hide the table of contents | Ctrl+Alt+T |
| Print… | Ctrl+P |
| Turn study tape into blanks when printing and exporting |  |
| Reading aids |  |
| Page gallery |  |
| Present as slides | F5 |
| Infinite canvas |  |
| Pages with breaks |  |
| Document flow |  |
| Free canvas |  |
| Fit page |  |
| Letter |  |
| A4 |  |
| A5 |  |
| Legal |  |
| Tabloid |  |
| Portrait |  |
| Landscape |  |
| Narrow margins |  |
| Normal margins |  |
| Wide margins |  |
| Plain |  |
| Lined, narrow |  |
| Lined, college |  |
| Lined, wide |  |
| Grid, 5 mm |  |
| Grid, quarter inch |  |
| Grid, 1 cm |  |
| Dot grid |  |
| Isometric |  |
| Cornell notes |  |
| Music staff |  |
| Margin line |  |
| Paper (not in the palette) |  |
| Background (not in the palette) |  |

### Pictures

**canvas-view.** The canvas view, with pages and notes as cards joined by arrows. ([dark](screens/canvas-view-dark.png))

![The canvas view, with pages and notes as cards joined by arrows.](screens/canvas-view-light.png)

**print-preview.** The print preview of a page, with the paper size and margins beside it. ([dark](screens/print-preview-dark.png))

![The print preview of a page, with the paper size and margins beside it.](screens/print-preview-light.png)

## Notebooks and navigation

### Features

#### Quality-of-life fixes

- **Versions and trash.** Page history, and a trash that keeps deleted items for 30 days.
- **Clean paste.** Pasting from the web keeps structure but drops stray fonts and colors.
- **Speed.** Large notebooks open lazily, and nothing freezes while syncing.
- **Content locks.** Text boxes and images can be locked in place.
- **Sections and pages.** Can be pinned, colored, sorted, and duplicated.
- **Tabs and windows.** Open several pages side by side in tabs or windows.
- **Offline.** Everything works offline, and conflicts are shown side by side, never silently overwritten.
- **Quick capture.** A global shortcut opens a small note window from anywhere in Windows.
- **Daily note.** One tap opens today's page, created from a template.
- **Focus mode.** Hides panes and toolbars; the page stays centered.
- **Word count and reading time.** Shown for the page or a selection.
- **Table of contents.** Built from headings, pinned to the side of long pages.
- **Recently closed.** Reopen closed pages and tabs with Ctrl+Shift+T.
- **Mini window.** Keep a page on top of other apps while watching a lecture or a video.
- **Remember position.** Each page reopens at the same scroll, zoom, and view.
- **Drag and drop.** Drop files, images, PDFs, and links from anywhere.
- **Reminders.** Due dates on checkboxes, with Windows notifications.

#### App shell and navigation

- **Subpages and section groups.** Pages can sit under a parent page, 2 levels deep as in OneNote, and fold away with it.
- **Back and forward.** Alt+Left, Alt+Right, the mouse side buttons, and toolbar arrows step through visited pages, including jumps from links and search.
- **Quick switcher.** Ctrl+O finds a page by name, with recent pages first.
- **Recent pages on small screens.** In the compact layout, More in the bottom bar lists the last few pages opened, newest first, above Settings.
- **Dock to a screen edge.** A command docks OpenNote to the left or right edge of the screen as a narrow column, and other windows resize to leave room.
- **Select several pages.** Ctrl-click and Shift-click select several pages or sections in the tree.

#### Document model and storage

- **Scheduled backups.** Copies notebooks on a schedule, from hourly to weekly, to a folder the person picks, such as a USB drive or a second disk.
- **Edits from other apps.** OpenNote watches the notes folder and reloads pages that other programs change, such as Git, Syncthing, or a script.
- **Notes in OneDrive or Dropbox.** Setup and Settings notice when the notes folder is inside OneDrive, Dropbox, iCloud Drive, or Google Drive.
- **Open a notebook from any folder.** "Open folder" opens a notebook that lives anywhere: another drive, a USB stick, a network share, or a folder in a Git repository.
- **Check notebook.** Scans a notebook for damaged files, missing images and recordings, broken links, and pages whose readable copy doesn't match the page data.
- **Open-source notices.** Settings, then About, has a section with the copyright lines and license text of the bundled fonts (Atkinson Hyperlegible, Literata), as the SIL Open Font License asks.

### Title bar

- **Back.** Goes back to the page or screen you had open before.
- **Forward.** Goes forward again after Back.
- **Breadcrumb.** Shows the notebook, section, and page you are on.
- **Undo.** Undoes the last change.
- **Redo.** Redoes the change you undid last.
- **Save status.** Says Saving until an edit is written and Saved once it is, or Couldn't save, Offline, or Not responding.
- **Sync.** Says Synced, Syncing, Sync paused, Sync waiting, or Sync stopped, and opens sync.
- **Working offline.** Shows that OpenNote makes no network requests right now.
- **Recording.** Shows a recording and its time, and opens the recording controls.
- **Timers.** Shows a running timer and its time left, and opens the Timers window.
- **Safe mode.** Shows that OpenNote started in safe mode, with some extras off.
- **Today.** Opens today's daily note.
- **Search.** Opens search across your notebooks.
- **Update.** Says Update available or Update ready, and opens the details.
- **Theme.** Switches between the light and dark themes.

### Commands

| Command | Default keys |
| --- | --- |
| Open collections |  |
| Open today's note |  |
| Open the daily notes calendar |  |
| Notebooks pane | Ctrl+Shift+1 |
| Pages pane | Ctrl+Shift+2 |
| Widen the notebooks pane |  |
| Narrow the notebooks pane |  |
| Reset the notebooks pane width |  |
| Collapse the notebooks pane |  |
| Expand the notebooks pane |  |
| Widen the pages pane |  |
| Narrow the pages pane |  |
| Reset the pages pane width |  |
| Collapse the pages pane |  |
| Expand the pages pane |  |
| Pane widths (not in the palette) |  |
| Go to the next region (not in the palette) | F6 |
| Go to the previous region (not in the palette) | Shift+F6 |
| Go back | Alt+Left |
| Go forward | Alt+Right |
| Reveal in tree |  |
| Minimize the window |  |
| Maximize or restore the window |  |
| Close OpenNote |  |
| Open the window menu | Alt+Space |
| Reset tool windows |  |
| Insert a live collection |  |
| Delete section history |  |
| Delete notebook history |  |
| Page history |  |
| Compare with another version |  |
| Name this version |  |
| Delete page history |  |
| Next change | F8 |
| Previous change | Shift+F8 |
| Extract selection to a new page |  |
| Merge pages |  |
| Split page at headings |  |
| Open command palette (not in the palette) | Ctrl+K |
| Go to a page | Ctrl+O |
| Pin page |  |
| Unpin page |  |
| Pin section |  |
| Unpin section |  |
| Duplicate |  |
| Copy to |  |
| Sort (not in the palette) |  |
| Sort by title |  |
| Sort by date created |  |
| Sort by date modified |  |
| Archive |  |
| Restore from archive |  |
| Show archived |  |
| Open in new tab | Ctrl+Enter |
| Duplicate tab |  |
| Close tab | Ctrl+W |
| Go to the next tab | Ctrl+Tab |
| Go to the previous tab | Ctrl+Shift+Tab |
| Reopen closed tab | Ctrl+Shift+T |
| Open in new window |  |
| Focus mode | F11 |
| Keep on top |  |
| Dock to the left edge |  |
| Dock to the right edge |  |
| Quick note |  |
| Go home |  |
| Open a notebook from a folder |  |
| Check notebook |  |
| Back up now |  |
| Create shortcut |  |
| Open Trash |  |
| Restore (not in the palette) |  |
| Empty Trash |  |
| Delete forever (not in the palette) |  |
| New notebook |  |
| New section group |  |
| New section | Ctrl+T |
| New page | Ctrl+N |
| New subpage | Ctrl+Alt+Shift+N |
| Move up (not in the palette) | Ctrl+Shift+Up |
| Move down (not in the palette) | Ctrl+Shift+Down |
| Make subpage | Ctrl+Shift+Right, Ctrl+Alt+] |
| Promote | Ctrl+Shift+Left, Ctrl+Alt+[ |
| Rename | F2 |
| Color (not in the palette) |  |
| Move to | Ctrl+Shift+M |
| Delete | Delete |

### Pictures

**workspace.** Notebooks, pages, and a page of typed notes with a heading, a list, and a page link. ([dark](screens/workspace-dark.png))

![Notebooks, pages, and a page of typed notes with a heading, a list, and a page link.](screens/workspace-light.png)

**workspace-empty.** The empty state: no notebooks yet, and the desk by the window beside the page card. ([dark](screens/workspace-empty-dark.png))

![The empty state: no notebooks yet, and the desk by the window beside the page card.](screens/workspace-empty-light.png)

**home-screen.** The Home screen with recent pages, pinned pages, and what is coming up. ([dark](screens/home-screen-dark.png))

![The Home screen with recent pages, pinned pages, and what is coming up.](screens/home-screen-light.png)

**title-bar-states.** The title bar with back and forward, the page path, the save status, and a running timer chip. ([dark](screens/title-bar-states-dark.png))

![The title bar with back and forward, the page path, the save status, and a running timer chip.](screens/title-bar-states-light.png)

**page-tabs.** Three pages open as tabs in the strip above the page. ([dark](screens/page-tabs-dark.png))

![Three pages open as tabs in the strip above the page.](screens/page-tabs-light.png)

**compact-layout.** The compact layout of a narrow window, with the app bar and one pane at a time. ([dark](screens/compact-layout-dark.png))

![The compact layout of a narrow window, with the app bar and one pane at a time.](screens/compact-layout-light.png)

**focus-mode.** Focus mode, with the panes and the command bar hidden around the page. ([dark](screens/focus-mode-dark.png))

![Focus mode, with the panes and the command bar hidden around the page.](screens/focus-mode-light.png)

**quick-capture.** The Quick note window, a small window for jotting a note into a chosen section. ([dark](screens/quick-capture-dark.png))

![The Quick note window, a small window for jotting a note into a chosen section.](screens/quick-capture-light.png)

**tab-home.** The Home tab with the recording control and the formatting bar. ([dark](screens/tab-home-dark.png))

![The Home tab with the recording control and the formatting bar.](screens/tab-home-light.png)

**tab-insert.** The Insert tab: link, code block, callout, divider, template, file, equation, and table. ([dark](screens/tab-insert-dark.png))

![The Insert tab: link, code block, callout, divider, template, file, equation, and table.](screens/tab-insert-light.png)

**tab-draw.** The Draw tab: the tools, the pen slots, color, and width (1600 by 900). ([dark](screens/tab-draw-dark.png))

![The Draw tab: the tools, the pen slots, color, and width (1600 by 900).](screens/tab-draw-light.png)

**tab-view.** The View tab: panes, page layout, paper, background, and focus mode. ([dark](screens/tab-view-dark.png))

![The View tab: panes, page layout, paper, background, and focus mode.](screens/tab-view-light.png)

**collections.** A live collection of pages shown as a board, grouped by status. ([dark](screens/collections-dark.png))

![A live collection of pages shown as a board, grouped by status.](screens/collections-light.png)

**daily-calendar.** The daily notes calendar, with today marked and buttons for the day, week, month, and year notes. ([dark](screens/daily-calendar-dark.png))

![The daily notes calendar, with today marked and buttons for the day, week, month, and year notes.](screens/daily-calendar-light.png)

**trash.** Trash with two deleted pages and a Restore button for each. ([dark](screens/trash-dark.png))

![Trash with two deleted pages and a Restore button for each.](screens/trash-light.png)

**palette.** The command palette over a page, with pages and commands. ([dark](screens/palette-dark.png))

![The command palette over a page, with pages and commands.](screens/palette-light.png)

## Search and links

### Features

#### Pages and search additions

- **Attachment Save a copy and thumbnails.** Right-click an attachment, or press Ctrl+K and choose "Save a copy of the attachment", to save the file through the Windows Save dialog.
- **Crop fields in Size and position.** Size and position on a picture also shows how much to cut from each side, in percent, and Reset crop.
- **Pin sections and color pages.** Right-click a section and choose Pin section to keep it above the others in its notebook, and Unpin section to let it sort again.
- **Elements library: move and organize.** In the Elements library, Move on an element puts it in any folder, and Rename and Move on a folder rename it or put it inside another folder.
- **Links, search, and read aloud open folds.** A link, a search result, a tag line, Find on the page, read aloud, and F7 to the next misspelling.
- **Statistics, regression, and matrix tools for tables.** Data, Analyze (or Ctrl+K, "Table:") works from the selected cells, or the whole table.
- **Choice columns in smart tables.** Data, Format, then the format "Choice, pick one" or "Choice, pick several" makes a column a list of named, colored choices, starting from the values it already holds.
- **Saved views of a smart table.** Data, Saved views keeps a table's filters and sort under a name.

#### Search and linking

- **Line tags and tag summary.** Ctrl+1 to Ctrl+9 tag any paragraph or list item as To do, Important, Question, Idea, or a custom tag.
- **Links to paragraphs.** "Copy link" works on any page, heading, or paragraph, and `[[Page#Heading]]` autocompletes headings.
- **Link previews.** Hovering over or focusing an internal link shows a small card with the target's first lines, heading, or paragraph.
- **Unlinked mentions.** The backlinks pane has a second list of pages that mention this page's title without linking to it.
- **Tag renaming.** Rename, merge, or delete a tag everywhere, including nested tags such as `school/biology`.
- **Extract and merge pages.** "Extract to new page" moves the selected text, ink, or blocks into a new page and leaves a link in their place.
- **Daily notes calendar.** A small month calendar opens the daily note for any day.
- **Series pages.** A series groups pages that repeat, such as a weekly meeting or a lab log.
- **Page properties.** Fields on a page, such as status, due date, course, author, rating, and a link to another page.
- **Collections.** A collection is a saved view of pages chosen by a search, a tag, a section, or property values, such as "open assignments for Bio 201, grouped by due week".
- **Page embeds.** Typing `![[` and choosing a page, a heading, or a paragraph shows it live inside another page.
- **Graph view.** Shows pages as dots and links as lines, for a whole notebook or for the pages within 1 to 3 links of the open one.
- **Canvas of cards.** A canvas is an open board of cards: pages, typed notes, images, PDFs, web addresses, and groups, joined by labeled arrows.
- **Advanced search.** Search understands "exact phrases", AND, OR, NOT, a minus sign to leave a word out, and a regular expression mode.
- **Archive.** "Archive" hides finished pages, sections, and notebooks from the tree.
- **Page shortcuts and jump list.** "Create shortcut" makes a Windows shortcut that opens a page, a section, or a notebook from the desktop, a folder, or the Start menu.
- **Home page.** A start page shows recent pages, pinned pages, today's note, saved searches, and the Upcoming list, in plain sections the person can reorder or hide.

#### More

- **Links.** Internal links survive renames and moves.
- **Find and replace.** Works on one page or a whole notebook, including handwriting that has been recognized One Undo, and on the message or with Ctrl+Z.
- **Typed #hashtags.** Typing `#word` and a space or punctuation makes it a tag of the page, listed in the Tags pane and found by `tag:` search.
- **Copy text from images.** Select text inside any image or scanned PDF.

### Commands

| Command | Default keys |
| --- | --- |
| Open the graph view | Ctrl+Alt+Shift+G |
| Find on page | Ctrl+F |
| Find and replace on page | Ctrl+H |
| Copy link to this page |  |
| Copy link to this paragraph |  |
| Tag as To do |  |
| Tag as Important |  |
| Tag as Question |  |
| Tag as Idea |  |
| Tag as Remember for later |  |
| Tag as Definition |  |
| Tag as Highlight |  |
| Tag as Contact |  |
| Tag as Phone number |  |
| Tag this line |  |
| Show tagged lines |  |
| Replace in all notebooks | Ctrl+Alt+H |
| Search notes | Ctrl+Shift+F |
| Show linked pages | Ctrl+Alt+G |
| Manage tags |  |
| Link to a page | Ctrl+Alt+K |
| Open the linked page | Ctrl+Alt+Enter |
| Preview the linked page | Ctrl+Alt+P |
| Rebuild the search index |  |

### Pictures

**search.** The search panel with a result, the matched word in bold, and a preview. ([dark](screens/search-dark.png))

![The search panel with a result, the matched word in bold, and a preview.](screens/search-light.png)

**find-replace.** Find and replace on the page, with every match highlighted. ([dark](screens/find-replace-dark.png))

![Find and replace on the page, with every match highlighted.](screens/find-replace-light.png)

**backlinks.** The linked pages pane, listing the page that links here. ([dark](screens/backlinks-dark.png))

![The linked pages pane, listing the page that links here.](screens/backlinks-light.png)

<!-- checks-disable-next-line grammar: "to-do and important lines" is one phrase, not a list -->
**tags-pane.** The tagged lines pane, listing to-do and important lines with the page each is on. ([dark](screens/tags-pane-dark.png))

<!-- checks-disable-next-line grammar: "to-do and important lines" is one phrase, not a list -->
![The tagged lines pane, listing to-do and important lines with the page each is on.](screens/tags-pane-light.png)

**graph-view.** The graph view, with pages as dots and their links as lines. ([dark](screens/graph-view-dark.png))

![The graph view, with pages as dots and their links as lines.](screens/graph-view-light.png)

## Audio and transcription

### Features

#### Transcripts and summaries

- Every recording gets a transcript automatically, with a one-paragraph summary at the top.
- Each line starts with a timestamp.
- Different voices are labeled Speaker 1, Speaker 2, and so on.
- Transcripts are searchable and can be edited to fix mistakes.

#### Audio recording

- **Playback speed and skips.** Recordings play at 0.5x to 3x without changing pitch.
- **Recording guard.** A live level meter shows while recording.
- **Trim, split, and remove parts.** Trim silence at the start or end, split a long recording, or remove an "off the record" part from both the audio and its transcript.
- **Mark moments.** A button or shortcut drops a flag at the current moment of a recording, with an optional short label.
- **Ink replay.** Plays back a page or a selection stroke by stroke, in the order it was written, with play, pause, a slider, and speed from 0.5x to 4x.
- **Voice enhancement.** "Enhance voice" reduces steady background noise and evens out loud and quiet speech, on the device.
- **Recording storage.** A list shows each recording's length and size, and the page and notebook that hold it.
- **Meeting detected prompt.** Off by default, and turned on only in Settings.
- **Snap the screen.** While recording, a shortcut captures the screen, a window, or a region, such as a slide or a whiteboard, and puts it on the page time-stamped to the audio.
- **Audio and video files.** Dropping an audio or video file, such as an MP3, M4A, WAV, or MP4 file, onto a page adds a player with the same time-stamped notes, and playback speed.

#### More

- **Read aloud.** Reads a page, a selection, or everything from the cursor aloud, and highlights each word as it is spoken.
- **Reading order.** A "Reading order" pane lists a freeform page's text, ink, images, and tables in the order that screen readers, read aloud, and the Tab key visit them.

### Commands

| Command | Default keys |
| --- | --- |
| New meeting note |  |
| Start recording | Alt+Shift+A |
| Stop recording | Alt+Shift+S |
| Pause recording | Alt+Shift+P |
| Play or pause the recording | Alt+Shift+K |
| Skip back 10 seconds | Alt+Shift+J |
| Skip forward 10 seconds | Alt+Shift+L |
| Flag this moment | Alt+Shift+M |
| Go to the next flag | Alt+Shift+N |
| Go to the previous flag | Alt+Shift+B |
| Play the recording from the caret | Alt+Shift+C |
| Play the recording from the selected ink |  |
| Trim silence from the recording |  |
| Split the recording here |  |
| Enhance the voice of the recording |  |
| Save the recording as a WAV file |  |
| Save the recording as an Opus file |  |
| Export the recording as a narrated video |  |
| Upload the recording to YouTube |  |
| Remove a part |  |
| Manage recordings and the space they take |  |
| Make a transcript of the recording |  |
| Add a transcript from text or captions |  |
| Copy the meeting recap |  |
| Copy the selected transcript lines into the notes | Alt+Shift+O |
| Snap the screen onto the page | Alt+Shift+X |
| Snap the window behind OpenNote onto the page | Alt+Shift+W |
| Snap a part of the screen onto the page | Alt+Shift+Z |
| Insert video, podcast, or embed from link |  |
| Add captions as a transcript |  |
| Read aloud | Ctrl+Shift+U |
| Read next paragraph | Ctrl+Alt+. |
| Read previous paragraph | Ctrl+Alt+, |
| Stop reading aloud |  |
| Insert video file |  |
| Add captions to a video |  |

### Pictures

**recording.** The recording options under the Record button. Nothing is recording. ([dark](screens/recording-dark.png))

![The recording options under the Record button. Nothing is recording.](screens/recording-light.png)

**recording-block.** A recording block on a page, with its player, speed, and time-stamped notes beside it. ([dark](screens/recording-block-dark.png))

![A recording block on a page, with its player, speed, and time-stamped notes beside it.](screens/recording-block-light.png)

**transcript-block.** A transcript block with speaker names and time stamps under its recording. ([dark](screens/transcript-block-dark.png))

![A transcript block with speaker names and time stamps under its recording.](screens/transcript-block-light.png)

**settings-recording.** Recording: live captions, a transcript of every recording, formats, and the consent reminder. ([dark](screens/settings-recording-dark.png))

![Recording: live captions, a transcript of every recording, formats, and the consent reminder.](screens/settings-recording-light.png)

## Math and homework

### Features

#### Math and study tools

- **Check my work.** Checks worked math one step at a time, typed or handwritten: each line against the line before it, for algebra, equations and their solutions, inequalities, derivatives, and antiderivatives (by differentiating back).
- **Tutor.** Hints one small step at a time: where to look, the idea, a question, then the next step, and the full solution only after trying, with a confirmation.
- **Visual equation editor.** Equations open in a MathLive editor with a virtual math keyboard for touch and pen, spoken output for screen readers, and a switch to LaTeX source.
- **Math with variables and units.** Write `rent = 1,200` on one line and `rent * 12 =` on another, and the result updates when the first changes.
- **Tool windows.** Small windows for tools such as timers, the calculator, Upcoming, flashcard review, the dictionary, the unit converter, and reference tables.
- **3D graphs.** A graph block or the calculator's Graphing 3D tab draws z = f(x, y) as a shaded surface, and curves and surfaces traced by t, or by u and v.
- **Live solving.** On the line being typed, an equation with one unknown such as `2x + 3 = 11` shows `x = 4` in gray.
- **Graph an equation.** A selected equation, or lassoed handwriting read as math, offers Graph.
- **Steps, systems, and matrices.** The equation panel's Steps shows a derivative rule by rule, and an integral from a table of rules, with a definite integral's value.

#### 3D graphs, vectors, and motion

- **Parametric and polar curves.** Graph blocks take `(x(t), y(t))`, `r = f(θ)`, vector fields `F = (P, Q)`, and slope fields `dy/dx = f(x, y)`.
- **Lines and planes.** Distances, intersections, and angles between points, lines, and planes in 3D, with a plot.
- **Projectile simulator.** Speed, angle, height, gravity, and linear drag give the time of flight, range, highest point, and landing speed.

### Tool windows

#### Calculator

A calculator window with seven tabs.

**tool-calculator.** The scientific calculator after a unit conversion, with the answer and its Copy and Insert buttons. ([dark](screens/tool-calculator-dark.png))

![The scientific calculator after a unit conversion, with the answer and its Copy and Insert buttons.](screens/tool-calculator-light.png)

Open it with the command "Open calculator".

Commands (7):

- **Basic calculator.**
- **Scientific calculator.**
- **Graphing calculator.**
- **3D graphing calculator.**
- **Programmer calculator.**
- **Statistics calculator.**
- **Matrix calculator.**

#### Export figure

Saves a graph or diagram from the page as an SVG or as a PNG at 72 to 600 DPI, numbered and captioned, with an optional source line.

Open it with the command "Export figure as a picture".

#### Formula sheet

Collects the display equations of this page, the selected pages, or the section into a new page laid out in one to four columns, grouped by heading, and without repeats.

Open it with the command "Open formula sheet builder".

#### Insert LaTeX

A window with a LaTeX field, a live preview drawn by KaTeX, a choice of in the line or on its own line, and a palette of snippets: fractions, and roots.

Open it with the command "Insert LaTeX" (Ctrl+Alt+X).

#### Math solvers

One window with a tab for each solver, and each solver shows its worked steps.

**solvers-integrals.** The Math solvers window on its integrals tab, with the worked steps. ([dark](screens/solvers-integrals-dark.png))

![The Math solvers window on its integrals tab, with the worked steps.](screens/solvers-integrals-light.png)

Open it with the command "Open Math solvers" (Ctrl+Alt+Shift+M).

Commands (9):

- **Solve a double or triple integral.** Pick a region (rectangle, region between two curves, disk, box, cylinder, ball, or cone) or type your own limits, and pick rectangular, polar, cylindrical, or spherical coordinates.
- **Solve a differential equation.** Separable, first-order linear (with the integrating factor), and second-order linear equations with constant coefficients (characteristic equation, and undetermined coefficients for polynomial, exponential, sine, and cosine forcing, including resonance).
- **Find a Laplace or Fourier transform.** Forward and inverse Laplace transforms with steps (table lookups, the shift and multiply-by-tⁿ properties, poles and partial fractions, and delays as unit steps).
- **Expand a Taylor series.** Expands f about a point to order n, with each derivative, and the polynomial written the textbook way.
- **Find a root with Newton's method.** Newton's method, bisection, and the secant method with an iteration table, a report of how the run ended (converged with the estimated order, diverged, flat tangent, and cycle.
- **Propagate uncertainty or check units.** Propagates the uncertainty of independent measurements through an expression, with each partial derivative, each variable's share, and the result rounded as a lab report writes it.
- **Find a normal, binomial, or t probability.** Normal, binomial, and Student t distributions: the probability below, above, between, or outside values with the area or bars shaded, and two-sided critical values.
- **Find eigenvalues and eigenvectors.** For a 2×2 or 3×3 matrix: the characteristic polynomial, the eigenvalues (real or complex), the eigenvectors and their eigenspaces, and whether the matrix can be diagonalized.
- **Simulate a projectile.** Range, highest point, time of flight, and landing speed and angle for a launch from a height, worked in closed form, and with optional quadratic air resistance (from mass.

#### Practice mode

Shows a worked problem with its solution steps hidden.

Open it with the command "Practice this problem".

#### Projectile simulator

Range, highest point, time of flight, and landing speed and angle for a launch from a height, worked in closed form, and with optional quadratic air resistance (from mass.

Open it with the command "Open projectile simulator".

#### Scientific constants

A searchable window of 23 physical constants from the 2022 CODATA recommended values (NIST, public domain): the speed of light, the Planck constant, the Boltzmann constant, and the Avogadro constant.

Open it with the command "Insert a scientific constant" (Ctrl+Alt+N).

#### Significant figures

A window that counts the significant figures of a number (0.00120 has 3; 1200 has 2.

Open it with the command "Open the significant-figures helper" (Ctrl+Alt+F).

#### Solids of revolution

Turns the region between two curves about y = k or x = k.

Open it with the command "Open solids of revolution".

#### Symbols

A searchable palette of Greek letters and math, science, and engineering symbols with recent symbols first (Insert tab, command palette, slash menu, and Ctrl+Alt+Shift+S).

Open it with the command "Open the symbol palette" (Ctrl+Alt+Shift+S).

#### Unit converter

Converts length, area, volume, mass, temperature, speed, time, pressure, energy, power, angle, data size, force, frequency, density, torque, fuel economy (including liters per 100 km), electric current, voltage, and resistance.

**unit-converter.** The unit converter with a length converted from meters to feet. ([dark](screens/unit-converter-dark.png))

![The unit converter with a length converted from meters to feet.](screens/unit-converter-light.png)

Open it with the command "Open the unit converter".

#### Vectors

Dot and cross products, lengths, the angle, scalar and vector projections, the unit vector, the parallelogram's area, and the triple product, with a 3D plot.

Open it with the command "Open vector tools".

### Commands

| Command | Default keys |
| --- | --- |
| Simplify |  |
| Solve |  |
| Insert graph |  |
| Insert equation |  |
| Insert inline equation | Alt+= |
| Insert 3D graph |  |
| Insert parametric or polar graph |  |
| Insert 3D function plot |  |
| Graph equation | Alt+Shift+G |
| Graph handwritten equation |  |
| Show steps for the equation |  |
| Count significant figures of the selection |  |
| Round the selection to significant figures |  |
| Check my work |  |
| Open the tutor |  |
| Give me a hint |  |
| Explain this step |  |

### Pictures

**study-tutor.** The Tutor panel giving the first of four hints on a worked line, without the answer. ([dark](screens/study-tutor-dark.png))

![The Tutor panel giving the first of four hints on a worked line, without the answer.](screens/study-tutor-light.png)

**step-checker.** Check my work on three lines of working, with the wrong line marked and the reason. ([dark](screens/step-checker-dark.png))

![Check my work on three lines of working, with the wrong line marked and the reason.](screens/step-checker-light.png)

**math-graph.** An inline equation in a sentence and a graph block with its function. ([dark](screens/math-graph-dark.png))

![An inline equation in a sentence and a graph block with its function.](screens/math-graph-light.png)

**calc-graphing.** The graphing calculator with two functions drawn, and a value read off the graph near where they cross. ([dark](screens/calc-graphing-dark.png))

![The graphing calculator with two functions drawn, and a value read off the graph near where they cross.](screens/calc-graphing-light.png)

**calc-graphing-3d.** The 3D graphing calculator with a surface plotted from one function. ([dark](screens/calc-graphing-3d-dark.png))

![The 3D graphing calculator with a surface plotted from one function.](screens/calc-graphing-3d-light.png)

**subject-statistics.** The Statistics tab of the calculator after summarizing six numbers. ([dark](screens/subject-statistics-dark.png))

![The Statistics tab of the calculator after summarizing six numbers.](screens/subject-statistics-light.png)

**solvers-equations.** The Math solvers window on its differential equations tab, with the solution and its steps. ([dark](screens/solvers-equations-dark.png))

![The Math solvers window on its differential equations tab, with the solution and its steps.](screens/solvers-equations-light.png)

**math-actions.** The math actions on an equation: a solved equation on the page, and the worked steps of a derivative inserted below an equation. ([dark](screens/math-actions-dark.png))

![The math actions on an equation: a solved equation on the page, and the worked steps of a derivative inserted below an equation.](screens/math-actions-light.png)

**graph-3d.** A 3D graph block on a page, with a surface and its axes. ([dark](screens/graph-3d-dark.png))

![A 3D graph block on a page, with a surface and its axes.](screens/graph-3d-light.png)

## Engineering kits

### Features

#### Engineering tools

- **Free-body diagram kit.** A block with a body, forces, moments, and pin, roller, and fixed supports as shapes that snap to the grid and to each other. ΣFx, and ΣFy.
- **Beam and truss solver.** A beam block with pin, roller, and fixed supports, point loads, linearly varying distributed loads, and moments that slide along the beam.
- **Circuit symbols and DC solver.** A circuit block with resistors, voltage and current sources, grounds, and wires on a grid.
- **Units and engineering notation in tables.** A smart table column can carry a unit, such as kN, MPa, or N·m.

### Kits

#### Aerospace

Standard atmosphere, compressible flow, nozzles, rocket nozzles, finite wings, performance and stability, potential flow, dynamic modes, jet engine cycles, and airfoils.

**kit-aerospace.** The Aerospace kit on its standard atmosphere tab, with the values at one altitude. ([dark](screens/kit-aerospace-dark.png))

![The Aerospace kit on its standard atmosphere tab, with the values at one altitude.](screens/kit-aerospace-light.png)

Open it with the command "Open the aerospace tools".

Commands (10):

- **Standard atmosphere.**
- **Compressible flow relations.**
- **Nozzle and diffuser flow.**
- **Rocket nozzle performance.**
- **Airfoils.**
- **Finite wings.**
- **Aircraft performance and static stability.**
- **Potential flow.**
- **Aircraft dynamic modes.**
- **Jet engine cycle analysis.**

#### Circuits and energy

Transients, a circuit simulator (DC, AC sweep, transient), op-amps and filters, semiconductors, instruments, AC power, power flow, data fitting, and energy.

**kit-circuits.** The circuit simulator of the Circuits and energy kit, with a small circuit and its results. ([dark](screens/kit-circuits-dark.png))

![The circuit simulator of the Circuits and energy kit, with a small circuit and its results.](screens/kit-circuits-light.png)

Open it with the command "Open the circuits and energy tools".

Commands (9):

- **First- and second-order circuits.**
- **Circuit simulator.**
- **Op-amp circuits and filters.**
- **Diodes and transistors.**
- **Instrumentation and measurement.**
- **AC power and three-phase systems.**
- **Power flow and economic dispatch.**
- **Lab data fitting and uncertainty.**
- **Energy systems and the environment.**

#### Civil and chemical engineering

Works structures, soils, foundations, water, transportation, material balances, and reactors.

**kit-civil.** The Civil and chemical engineering kit on its hydrology and open channels tab. ([dark](screens/kit-civil-dark.png))

![The Civil and chemical engineering kit on its hydrology and open channels tab.](screens/kit-civil-light.png)

Open it with the command "Civil and chemical engineering".

Commands (9):

- **Indeterminate structures and influence lines.** Structures: continuous beams by moment distribution, fixed-end moments, influence lines, moving loads, truss influence lines, portal and cantilever methods, response spectra, and modal combination.
- **Soil properties, consolidation, and strength.** Soils: phase relations, classification, compaction, permeability, effective stress, consolidation, and shear strength.
- **Earth pressure, foundations, and slopes.** Foundations: earth pressure, retaining walls, bearing capacity, slope stability, and piles.
- **Hydrology and open channels.** Hydrology and open channels: runoff, hydrographs, routing, flood frequency, soil loss, channel flow, jumps, profiles, weirs, and pipe networks.
- **Groundwater and wells.** Groundwater and wells: Darcy flow, wells and pumping tests, flow nets, and contaminant transport.
- **Water quality and treatment.** Water quality and treatment: oxygen balance, carbonate chemistry, softening, and treatment units.
- **Traffic, highways, surveying, and site planning.**
- **Material balances and separations.** Material balances and separations: flowsheet balances, energy balances, vapor-liquid equilibrium, flash, distillation, and absorption.
- **Chemical and biological reactors.** Chemical and biological reactors: ideal reactors, multiple reactions, temperature effects, residence times, growth, and activated sludge.

Also in this window:

- Transportation: traffic flow, queues, signals, highway geometry, travel demand, surveying, earthwork, and site planning.

#### Design tools

Tolerances and fits, machining, forming and joining, micro and nano fabrication, number representation, programming references, orthographic views, a memory tracer, and a drafting sheet.

**kit-design.** The drafting sheet of the Design kit, with a title block. ([dark](screens/kit-design-dark.png))

![The drafting sheet of the Design kit, with a title block.](screens/kit-design-light.png)

Open it with the command "Open the design tools".

Commands (12):

- **Drafting sheet.**
- **Orthographic views.**
- **Tolerances and fits.**
- **Machining speeds, feeds, and tool life.**
- **Forming, casting, and joining.**
- **Micro and nano fabrication.**
- **Memory and pointer tracer.**
- **Number representation.**
- **Programming references.**
- **Computation paper.**
- **Three-view drawing paper.**
- **Title block.**

#### Dynamics and control

System models, root locus, Bode and Nyquist, compensators and PID, state space, digital control, probability, Markov chains and queues, reliability, and Kalman filtering.

**kit-control.** The Dynamics and control kit drawing a Bode plot for a transfer function. ([dark](screens/kit-control-dark.png))

![The Dynamics and control kit drawing a Bode plot for a transfer function.](screens/kit-control-light.png)

Open it with the command "Open the dynamics and control tools".

Commands (10):

- **System models and responses.**
- **Root locus and Routh-Hurwitz.**
- **Frequency response: Bode and Nyquist.**
- **Compensator and PID design.**
- **State-space design.**
- **Digital control.**
- **Random processes and Kalman filtering.**
- **Markov chains and queues.**
- **Probability distributions and inference.**
- **Reliability, quality, and inventory.**

#### Engineering mathematics

Series, complex analysis, systems of ODEs, Fourier series and boundary value problems, numerical methods, a matrix console, a linear algebra workbench, and vector calculus.

**kit-engineering-math.** The linear algebra workbench of the Engineering mathematics kit, with a matrix and its results. ([dark](screens/kit-engineering-math-dark.png))

![The linear algebra workbench of the Engineering mathematics kit, with a matrix and its results.](screens/kit-engineering-math-light.png)

Open it with the command "Open the engineering mathematics tools".

Commands (8):

- **Series and convergence.**
- **Complex analysis.**
- **Systems of ODEs.**
- **Fourier series and boundary value problems.**
- **Numerical methods.**
- **Matrix console.**
- **Linear algebra workbench.**
- **Vector calculus and optimization.**

#### Fluids and heat transfer

Fluid statics and Bernoulli, pipe flow and pumps, dimensional analysis, viscous and external flow, conduction, fins, transient conduction, convection, heat exchangers, radiation, and water and air properties.

**kit-fluid-heat.** The Fluid mechanics and heat transfer kit on its pipe flow and pumps tab. ([dark](screens/kit-fluid-heat-dark.png))

![The Fluid mechanics and heat transfer kit on its pipe flow and pumps tab.](screens/kit-fluid-heat-light.png)

Open it with the command "Open the fluid mechanics and heat transfer tools".

Commands (12):

- **Fluid statics, Bernoulli, and flow measurement.**
- **Pipe flow and pumps.**
- **Dimensional analysis and similitude.**
- **External flow, drag, and boundary layers.**
- **Viscous and biological flows.**
- **Conduction and thermal circuits.**
- **Extended surfaces (fins).**
- **Transient conduction and diffusion.**
- **Convection correlations (heat and mass transfer).**
- **Heat exchangers.**
- **Radiation heat transfer.**
- **Water and air properties.**

#### Mechanisms and dynamics

Linkages, cams, gears, compliant mechanisms, rigid-body dynamics, Lagrangian mechanics, 3D rotations, vibration, and robot arms.

**kit-mechanisms.** The linkage analyzer of the Mechanisms and dynamics kit, with a four-bar linkage. ([dark](screens/kit-mechanisms-dark.png))

![The linkage analyzer of the Mechanisms and dynamics kit, with a four-bar linkage.](screens/kit-mechanisms-light.png)

Open it with the command "Open the mechanisms and dynamics kit".

Commands (11):

- **Linkage analyzer.**
- **Cam designer.**
- **Gears and gear trains.**
- **Compliant mechanisms.**
- **Particle and planar rigid-body dynamics.**
- **Three-dimensional rigid bodies and rotations.**
- **Lagrangian mechanics.**
- **Single-degree-of-freedom vibration.**
- **Multi-degree-of-freedom and continuous vibration.**
- **Robot arm kinematics.**
- **Robot dynamics and control.**

#### Signals and sound

Works spectra, filters, sampling, body signals, sound, images, medical imaging, coding, and RF lines.

**kit-signals.** The spectrum analyzer of the Signals and sound kit, with a signal and its spectrum. ([dark](screens/kit-signals-dark.png))

![The spectrum analyzer of the Signals and sound kit, with a signal and its spectrum.](screens/kit-signals-light.png)

Open it with the command "Open signals and sound tools".

Commands (9):

- **Spectrum analyzer.** Amplitude, power, density, Welch, and spectrogram views of pasted samples, a sound file, or a value (and time) column of a table on the open page, and with window corrections.
- **Digital filter designer.** FIR filters by the window method (with Kaiser's estimates), Butterworth, Chebyshev, and elliptic IIR filters by the bilinear transform or impulse invariance in second-order sections, and notch and moving-average filters.
- **Convolution and sampling.** Convolution as a flip, shift, multiply, and sum table, correlation lags, difference equations with their poles, aliasing and reconstruction, quantization noise, rate changes, and continuous convolution.
- **Neural and physiological time series.** Epochs with baseline correction, amplitude rejection, averages with standard errors, peaks, and mean amplitudes; canonical double-gamma HRF regressors, collinearity, and a GLM with t for a contrast; spike rasters.
- **Image lab.** Window, level, stretch, and gamma with a histogram; manual and Otsu thresholds with connected-component counts, areas, and centroids; box, Gaussian, sharpen, Sobel, Prewitt, Laplacian, custom, and Canny filters; erosion, and dilation.
- **Medical imaging physics.** Larmor frequency, spin-echo, gradient-echo, and inversion-recovery signals with contrast against TR, a Bloch simulator with spin echoes, a k-space masking demonstration on the Shepp-Logan phantom, and Hounsfield units and windows.
- **Sound analysis and acoustics.** Opens or records sound (kept on the device) and shows its waveform, wide- and narrow-band spectrograms, a YIN pitch track, intensity, Burg LPC formants, labeled intervals, jitter, and shimmer.
- **Information, coding, and modulation.** Entropy, mutual information, and channel capacity; Huffman, Shannon-Fano, and LZ78 source codes; Hamming and linear block codes; standard CRCs; Viterbi decoding; and constellations, bit-error rates, and eye diagrams.
- **Transmission lines and RF.** Reflection, VSWR, and input impedance (open and shorted loads included) on a Smith chart with the standing-wave pattern; L-section, single-stub, and quarter-wave matching; coax, two-wire, and microstrip impedance; S, and Z.

#### Solid mechanics

Columns, stress and strain, sections, members, deflection, pressure vessels, thin-walled structures, composite laminates, tissues and joints, fatigue and machine elements, and a finite element workbench.

**kit-solids-fem.** The finite element workbench of the Solid mechanics kit, with a meshed part and its stresses. ([dark](screens/kit-solids-fem-dark.png))

![The finite element workbench of the Solid mechanics kit, with a meshed part and its stresses.](screens/kit-solids-fem-light.png)

Open it with the command "Open the solid mechanics tools".

Commands (11):

- **Columns and buckling.**
- **Stress and strain at a point.**
- **Section properties.**
- **Axial, torsion, and bending.**
- **Beam deflection.**
- **Pressure vessels, fits, and curved beams.**
- **Thin-walled structures.**
- **Composite laminates.**
- **Tissues and joints.**
- **Fatigue and machine elements.**
- **Finite element workbench.**

#### Thermodynamics kit

Statistical thermodynamics, ideal gases, steam (IAPWS-IF97), psychrometrics, R-134a, steady-flow devices, cycles, real gases and mixtures, and combustion.

**kit-thermo.** The Thermodynamics kit finding a state of water from two properties. ([dark](screens/kit-thermo-dark.png))

![The Thermodynamics kit finding a state of water from two properties.](screens/kit-thermo-light.png)

Open it with the command "Open the thermodynamics kit".

Commands (9):

- **Find a state of water or steam from two properties.**
- **Find a state of refrigerant R-134a from two properties.**
- **Work an ideal-gas process or state with variable specific heats.**
- **Find Z and departures from a cubic equation of state, or the properties of a gas mixture.**
- **Balance a turbine, compressor, nozzle, or other steady-flow device with the second law.**
- **Analyze a Rankine, Brayton, Otto, Diesel, refrigeration, or Carnot cycle.**
- **Work moist-air states and air-conditioning processes.**
- **Balance a combustion reaction and find heating values and the adiabatic flame temperature.**
- **Find partition functions, heat capacities, and molecular speeds.**

### Commands

| Command | Default keys |
| --- | --- |
| Insert free-body diagram |  |
| Insert beam solver |  |
| Insert truss solver |  |
| Insert circuit |  |

### Pictures

**kit-thermo-cycles.** The Thermodynamics kit working a Rankine cycle, with its diagram and results. ([dark](screens/kit-thermo-cycles-dark.png))

![The Thermodynamics kit working a Rankine cycle, with its diagram and results.](screens/kit-thermo-cycles-light.png)

**engineering-beam.** The beam deflection tool of the solid mechanics kit, with its supports and loads. ([dark](screens/engineering-beam-dark.png))

![The beam deflection tool of the solid mechanics kit, with its supports and loads.](screens/engineering-beam-light.png)

**kit-design-code.** The memory and pointer tracer of the Design kit, stepping through a short program. ([dark](screens/kit-design-code-dark.png))

![The memory and pointer tracer of the Design kit, stepping through a short program.](screens/kit-design-code-light.png)

## Subject and catalog kits

### Features

#### Subject kit foundations

- **Data input.** A data field reads pasted text, a CSV or TSV file, or a table on the open page, with missing values, decimal commas, role pickers, and a long and wide reshape.
- **Distributions.** Exact and noncentral distributions, the studentized range, exact proportion and count intervals, and exact null distributions for rank tests, for every subject kit to use.
- **Curve fitting and likelihood.** Weighted Levenberg-Marquardt fitting with standard errors and bands, and maximum likelihood with standard errors and profile intervals.
- **Repeatable random results.** A seeded generator that gives the same results on every computer, with a seed field that shows, takes, and renews the seed.
- **Plots and coefficient tables.** Histograms, densities, ECDF, Q-Q, box, fit-band, step, forest, and ROC plots, and a coefficient table that states each verdict in words.
- **Tree and graph layouts.** Tidy tree layouts and layered and force-directed graph layouts, drawn as SVG for trees, networks, and diagrams.
- **Figure blocks.** A tool's diagram on the page as a picture with its description and an Open in tool button that reopens the inputs that made it.

#### More

- **Kit foundation.** Shared numerics (matrices, polynomial roots, quadrature, ODE solvers, special functions), air and water properties, 38 unit kinds, and the kit window parts.
- **Live calculation block.** A block that keeps a tool's answer, key results, and inputs on the page.

### Kits

#### Biology tools

Works with sequences, cloning, proteins, alignments, trees, crosses, population genetics, and pedigrees.

**kit-biology.** The Biology tools kit on its DNA and RNA sequences tab, with a sequence and its details. ([dark](screens/kit-biology-dark.png))

![The Biology tools kit on its DNA and RNA sequences tab, with a sequence and its details.](screens/kit-biology-light.png)

Open it with the command "Open the biology tools".

Commands (8):

- **DNA and RNA sequences.** Cleans, complements, translates, and counts a sequence and finds open reading frames, motifs, GC windows, CRISPR guides, and the effect of a mutation.
- **Cloning, PCR, and gels.** Digests linear or circular DNA with 56 built-in enzymes or your own, draws a virtual gel and a plasmid map, sizes bands from a ladder, and reports primer melting temperatures (Wallace.
- **Proteins and peptides.** Gives a protein's mass, isoelectric point, charge curve, extinction coefficient, and hydropathy plot.
- **Sequence alignment.** Aligns 2 DNA or protein sequences globally, locally, or semi-globally with the score matrix shown, and draws dot plots.
- **Phylogenetic trees.** Builds trees from alignments or distance matrices by UPGMA or neighbor-joining with each matrix shown, scores and searches trees by parsimony, adds seeded bootstrap support, and reads, reroots, and draws.
- **Genetic crosses and linkage.** Works Punnett squares for up to 3 genes, chi-square tests, 2- and 3-point gene maps, LOD scores, and carrier risk.
- **Population genetics.** Tests Hardy-Weinberg (chi-square and exact), and models selection, mutation, migration, seeded drift, effective size, linkage disequilibrium, and heritability.
- **Family, pedigree, and kinship charts.** Draws pedigrees in NSGC symbols from a typed list, checks 6 inheritance patterns, works genotype probabilities by peeling, sums relationship and inbreeding coefficients, reads kin types from Ego, and orders succession.

#### Chemical structures

Type SMILES text or choose a starting structure, and see a skeletal formula with its formula and molar mass.

**kit-chemistry-structure.** The chemical structure drawer of the Chemistry and materials kit, with a drawn molecule. ([dark](screens/kit-chemistry-structure-dark.png))

![The chemical structure drawer of the Chemistry and materials kit, with a drawn molecule.](screens/kit-chemistry-structure-light.png)

Open it with the command "Open the chemical structure drawer" (Ctrl+Alt+Z).

#### Chemistry and materials

Thermochemistry, equilibrium, acids and bases, electrochemistry, kinetics, solutions, crystals and diffraction, defects and diffusion, phase diagrams, and atoms and bonding.

**kit-chemistry.** The chemistry calculators of the Chemistry and materials kit, with a balanced equation. ([dark](screens/kit-chemistry-dark.png))

![The chemistry calculators of the Chemistry and materials kit, with a balanced equation.](screens/kit-chemistry-light.png)

Open it with the command "Open Chemistry and materials".

Commands (10):

- **Thermochemistry.**
- **Chemical equilibrium.**
- **Acids, bases, and buffers.**
- **Electrochemistry.**
- **Chemical kinetics.**
- **Solutions and lab calculations.**
- **Crystal structures and diffraction.**
- **Defects, diffusion, and oxidation.**
- **Phase diagrams and mechanical behavior.**
- **Atoms, light, and bonding.**

#### Chemistry calculators

One window with six tabs: balance an equation (including charges), molar mass and percent composition, stoichiometry with the limiting reagent and percent yield, gas laws (ideal, combined, Graham, and density).

Open it with the command "Open the chemistry calculators" (Ctrl+Alt+Y).

#### Earth sciences

Atmospheric thermodynamics and soundings; radiation, climate, and footprints; geochronology, isotopes, and the time scale; stereonets and structural geology; stratigraphy and classification diagrams; air quality and weather observations.

**kit-earth.** The Earth sciences kit on its atmospheric thermodynamics and soundings tab. ([dark](screens/kit-earth-dark.png))

![The Earth sciences kit on its atmospheric thermodynamics and soundings tab.](screens/kit-earth-light.png)

Open it with the command "Open the earth sciences kit".

Commands (9):

- **Atmospheric thermodynamics and soundings.**
- **Radiation, climate, and footprints.**
- **Geochronology, isotopes, and the time scale.**
- **Stereonets and structural geology.**
- **Stratigraphy and classification diagrams.**
- **Air quality and weather observations.**
- **Seismology and seismic surveys.**
- **Gravity, magnetics, heat flow, and plates.**
- **Ocean, waves, and planetary flow.**

#### Economics and finance

One window with 87 calculators in eight subjects (money over time, markets, firms, consumer choice, macroeconomics, measurement, accounting, investments).

**kit-economics.** The Economics and finance kit on its markets and welfare tab, with supply and demand curves. ([dark](screens/kit-economics-dark.png))

![The Economics and finance kit on its markets and welfare tab, with supply and demand curves.](screens/kit-economics-light.png)

Open it with the command "Open economics and finance tools".

#### History, places, languages, and texts

Builds note frames, maps, timelines, calendars, scripts, linguistic structures, text analyses, and keys.

**kit-humanities.** The map maker of the History, places, languages, and texts kit. ([dark](screens/kit-humanities-dark.png))

![The map maker of the History, places, languages, and texts kit.](screens/kit-humanities-light.png)

Open it with the command "Open the history, places, languages, and texts kit".

Commands (9):

- **Insert a note frame.** Note structures for writing, history, law, and field work, found by subject or by searching, inserted as headings, prompts, lists, and a table.
- **Map maker.** Twelve projections (Snyder's formulas and Equal Earth), the student's points, great-circle routes, and GeoJSON or TopoJSON layers with equal-interval, quantile, or Jenks choropleth classes, Tissot indicatrices, legend, and scale bar.
- **Coordinates and navigation.** Converts between latitude and longitude, UTM, and MGRS, measures geodesic distance and bearing, and works grid zone, site grid, land, and marine navigation problems.
- **Timeline builder.** Draws events and periods on parallel tracks with era bands, uncertainty bars, BCE dates without a year zero, and linear, deep-time logarithmic, or broken axes.
- **Calendar and era converter.** Converts a date among thirteen calendars and counts (Gregorian, Julian, Hebrew, tabular Islamic, astronomical Solar Hijri and Chinese, Coptic, Ethiopian, French Republican, Saka, Maya, and Roman.
- **Scripts, keyboards, and romanization.** On-screen keyboards for IPA and many scripts, ALA-LC and BGN/PCGN romanization, Hangul composition with Revised Romanization and McCune–Reischauer, kana and Hepburn both ways, and pinyin tone marks and sandhi.
- **Linguistic structures.** Syntax trees from labeled brackets and dependency trees with arcs, Leipzig-style interlinear gloss checks, a distinctive feature chart with natural classes, and ordered rules with derivations and rule interactions.
- **Text analysis and verse.** Readability formulas with heuristic flags, word lists and n-grams with a Zipf plot, a concordance with collocates, keyness by log-likelihood, word-level comparison of versions, and MLU for language samples.
- **Identification keys.** Builds a numbered dichotomous key and its tree from a character table, runs it couplet by couplet, and filters with a multi-access key.

#### Life science tools

Works physiology, neurons, drugs, curve fits, bench math, populations, models, and field sampling.

**kit-life-science.** The Life science kit on its population dynamics tab, with a population curve. ([dark](screens/kit-life-science-dark.png))

![The Life science kit on its population dynamics tab, with a population curve.](screens/kit-life-science-light.png)

Open it with the command "Open life science tools".

Commands (9):

- **Physiology calculators.** Cardiac output, MAP, resistance, Laplace tension, a beating P-V loop from a time-varying elastance, ventricular-arterial coupling, the alveolar gas equation, O₂ content, the Severinghaus curve, the Krogh cylinder, ventilation, and clearance.
- **Neurons and excitable cells.** Nernst and GHK potentials, Donnan equilibrium, RC charging, Hodgkin-Huxley current and voltage clamp with TTX and TEA, thresholds, integrate-and-fire, cables, conduction speed, and synaptic summation.
- **Pharmacokinetics and drug response.** One- and two-compartment models, multiple dosing, non-compartmental analysis, Michaelis-Menten elimination, BSA dose scaling, release kinetics, Emax, occupancy, therapeutic index, and linked PK-PD effect.
- **Binding, enzyme, and dose-response fits.** Michaelis-Menten and inhibition fits beside the linear plots, Hill fits, binding with Scatchard, Cheng-Prusoff, isotherms, 4PL and 5PL standard curves, EC50, Schild pA₂, and probit LD50 with Fieller limits.
- **Bench calculations.** Molarity, dilutions, master mixes, buffers, centrifuge force, cell and plate counts, MOI, growth rates, qPCR, microscopy, and calibration curves.
- **Population dynamics.** Growth models, harvesting, predator-prey, competition, metapopulations, island biogeography, species-area fits, and the logistic map.
- **Life tables and demography.** Life tables, fertility rates, R₀ and r, Leslie and Lefkovitch matrices with elasticities, cohort projections, and pyramids.
- **Compartment, reaction, and agent models.** SIR-type epidemics, fitting β and γ to case counts, final size, Reed-Frost, reaction networks by ODE and seeded Gillespie runs, Schelling, lattice and network SIR, thresholds, the voter model, and Life.
- **Biodiversity and field sampling.** Diversity and Hill numbers, Chao and ACE richness, rarefaction, similarity indices, quadrat and transect sampling, dispersion, and mark-recapture.

#### Modern physics and astronomy

Works quantum wells, spin, atoms, molecules, solids, plasmas, stars, the sky, and cosmology.

**kit-modern-physics.** The Modern physics and astronomy kit on its quantum wells and barriers tab. ([dark](screens/kit-modern-physics-dark.png))

![The Modern physics and astronomy kit on its quantum wells and barriers tab.](screens/kit-modern-physics-light.png)

Open it with the command "Open the modern physics and astronomy tools".

Commands (9):

- **Quantum wells and barriers.** Bound states of preset or typed potentials by finite differences beside the exact levels, with expectation values; transmission through steps, barriers, wells, and layered structures.
- **Atoms and spectra.** Hydrogen-like lines with the reduced mass and air wavelengths, radial and angular wavefunctions, fine structure, term symbols with Hund's ground level and Landé g, Zeeman patterns, and electric-dipole selection rules.
- **Spin and qubits.** Exact Clebsch-Gordan coefficients, 3j symbols, and coupling tables; spin, Pauli, and Dirac matrices with commutators and eigenvalues; Stern-Gerlach analyzers on the Bloch sphere; Larmor precession.
- **Molecular spectra and polymers.** Rotational, vibrational, and rovibrational spectra of diatomics; exact masses, isotope patterns, and unsaturation from a formula; first-order NMR multiplets and integration; and polymer molar masses, chain sizes, and Flory-Huggins mixing.
- **Solids and semiconductors.** The free-electron gas, Kronig-Penney bands, tight-binding and phonon dispersion, carriers and the Fermi level with incomplete ionization, transport and the Hall effect, p-n junctions, MOS capacitors, and solar cells.
- **Plasma and space physics.** Debye length, plasma and gyro frequencies, collisions, Alfvén and sound speeds, sheaths, a planet's dipole field and drift periods, the magnetopause, and the fusion triple product.
- **Stars and exoplanets.** Distances and magnitudes, blackbody light, HR diagrams with mass and lifetime estimates, the Saha equation, compact objects, the Jeans mass, and transit, radial-velocity, equilibrium-temperature, and habitable-zone numbers for exoplanets.
- **Sky positions and sun paths.** Julian Date and sidereal time, the Sun and Moon in the sky, coordinate conversions with precession, rise and set times with twilight, sun-path diagrams, and shadow and overhang sizes.
- **Cosmology and telescopes.** Distances and ages in a Friedmann universe, the Hubble law, galaxy rotation curves, telescope and sensor numbers, the CCD equation, and photons from a magnitude.

#### Music, script, camera, and studio tools

Writes scores and works music theory, ear training, tuning, scripts, camera math, and studio math.

**kit-music.** The Music, script, camera, and studio kit on its music theory tab. ([dark](screens/kit-music-dark.png))

![The Music, script, camera, and studio kit on its music theory tab.](screens/kit-music-light.png)

Open it with the command "Open the music, script, camera, and studio tools".

Commands (8):

- **Score block.** ABC notation read, engraved as a picture, played, transposed by interval, to a key, or for a transposing instrument, and shown as numbered notation, sargam, or guitar tablature.
- **Music theory.** Intervals, pitch and frequency, scales and modes from several traditions, melakarta by rule, maqam and gamelan in cents, chords, keys, Roman numerals, transposing instruments, pitch-class sets, twelve-tone matrices, and jazz scales.
- **Ear training.** Seeded drills for intervals, chords, scales, melodic and rhythmic dictation, and sight-singing, graded sessions, and review dates from the flashcard schedule.
- **Voice-leading checker.** Four-part chorale rules at three strictness levels and first to fourth species counterpoint, with each problem located.
- **Script formatter.** Fountain screenplays and stage plays laid out in script format, with page and time estimates and scene, character, location, and breakdown lists.
- **Camera, timing, and lighting.** Exposure, depth of field, field of view, shutter angle, timecode, footage, animation planning, lighting, and media storage arithmetic.
- **Scale, color, and materials.** Drawing scales, grid enlargement, color contrast and vision checks, color spaces, palettes, type scales, perspective grids, and material quantities.
- **Tuning and rhythm.** Cents and temperaments, beat rates, the harmonic series, a metronome, Euclidean rhythms, polyrhythms, and rhythmic cycles.

#### Physics tools

Waves and sound, relativity, wave and geometric optics, nuclear science, spacecraft sizing, fields, and orbits and maneuvers.

**kit-physics.** The Physics kit on its electric and magnetic fields tab, with field lines around two charges. ([dark](screens/kit-physics-dark.png))

![The Physics kit on its electric and magnetic fields tab, with field lines around two charges.](screens/kit-physics-light.png)

Open it with the command "Open physics tools".

Commands (9):

- **Electric and magnetic fields.**
- **Waves and sound.**
- **Geometric optics and Gaussian beams.**
- **Interference, diffraction, and polarization.**
- **Special relativity.**
- **Nuclear science.**
- **Orbital mechanics.**
- **Orbital maneuvers and Lambert’s problem.**
- **Spacecraft sizing and link budgets.**

#### Property tables

Saturated steam (by temperature or pressure, with interpolation), ideal-gas specific heats from 250 to 1000 K, and a materials table (density, modulus, yield, conductivity, specific heat).

Open it with the command "Open the steam, gas, and materials tables" (Ctrl+Alt+U).

#### Psychology and behavior

Works signal detection, psychophysics, learning, choice, response times, observation, agreement, and scales.

**kit-psychology.** The Psychology and behavior kit on its signal detection tab. ([dark](screens/kit-psychology-dark.png))

![The Psychology and behavior kit on its signal detection tab.](screens/kit-psychology-light.png)

Open it with the command "Open the psychology and behavior tools".

Commands (9):

- **Signal detection.** D′, c, β, A′, and B″ from counts or rates, m-alternative forced choice, and ROC and z-ROC fits from rating data.
- **Psychophysics.** Psychometric function fits with guess and lapse rates, thresholds, PSE, JND, and bootstrap intervals; staircases; limits and adjustment; Weber, Fechner, and Stevens; visual angle, contrast, and logMAR.
- **Learning and reinforcement.** Rescorla-Wagner and Pearce-Hall over phases, TD prediction errors, grid-world planning and Q-learning or SARSA, bandit regret, reinforcement schedules, and learning curves.
- **Decision and choice models.** Drift-diffusion accuracy, decision times, densities, and simulations; speed-accuracy curves; EZ-diffusion; prospect-theory values, weights, and gamble certainty equivalents.
- **Response times and movement.** Trimming with counts removed, condition means with within-subject intervals and inverse efficiency, ex-Gaussian fits, quantile and delta plots, and Fitts' and Hick-Hyman laws.
- **Behavior observation.** Session logs typed or recorded live give rates, durations, time budgets, bouts, latencies, and transitions; interval recording; observer agreement; single-case graphs with PND, NAP, and Tau.
- **Inter-rater agreement.** Cohen's and weighted kappa, Scott's pi, Fleiss' kappa, Krippendorff's alpha, intraclass correlations, and Bland-Altman limits.
- **Scales and psychometrics.** Questionnaire scoring with reverse items and subscales, alpha, KR-20, split-half, item analysis, score transforms, System Usability Scale, and IRT curves.
- **Qualitative coding.** Code frequencies, code-by-case and co-occurrence matrices with Jaccard similarity, passages by code, two-coder agreement, a codebook with parent codes, and content-analysis tallies.

#### Reasoning kit

Logic, automata and grammars, numbers and groups, digital logic, computer systems (caches, scheduling, pipelines, deadlock, networks, logical clocks, normal forms, relational algebra, and digests), algorithms, optimization, and games and voting.

**kit-reasoning.** The logic workbench of the Reasoning kit, with a truth table. ([dark](screens/kit-reasoning-dark.png))

![The logic workbench of the Reasoning kit, with a truth table.](screens/kit-reasoning-light.png)

Open it with the command "Open the reasoning kit".

Commands (8):

- **Logic workbench.**
- **Automata and grammars.**
- **Numbers, counting, and groups.**
- **Digital logic design.**
- **Computer systems, networks, and databases.**
- **Algorithms, data structures, and networks.**
- **Optimization, projects, and decisions.**
- **Games, voting, and apportionment.**

#### Statistical models

Fits regression, causal, survival, time-series, multivariate, machine learning, and spatial models.

**kit-stat-models.** The Statistical models kit fitting a linear regression, with its fit statistics and coefficients. ([dark](screens/kit-stat-models-dark.png))

![The Statistical models kit fitting a linear regression, with its fit statistics and coefficients.](screens/kit-stat-models-light.png)

Open it with the command "Open the statistical models tools".

Commands (8):

- **Linear regression.** Fits a model formula with categorical predictors and interactions, with robust and clustered errors, diagnostics, prediction intervals, nested-model tests, moderation, mediation, and a random intercept.
- **Logistic and Poisson regression.** Fits 0/1, grouped, and count outcomes with odds or rate ratios, likelihood-ratio tests, the ROC curve, and the IRLS steps.
- **Econometrics and causal inference.** Panel fixed effects, two-stage least squares, difference-in-differences with event-study plots, regression discontinuity, propensity-score weighting and matching, and back-door sets from causal diagrams.
- **Survival analysis.** Kaplan-Meier curves with log-rank tests, Cox proportional hazards, and life tables.
- **Time series and forecasting.** Correlograms and Ljung-Box, periodograms, decomposition, exponential smoothing, AR and ARIMA forecasts with intervals, hold-out accuracy, Mann-Kendall with Sen's slope, and Dickey-Fuller with simulated quantiles.
- **PCA, factors, and clusters.** Principal components, factor analysis with rotation and parallel analysis, k-means, Gaussian mixtures by EM, hierarchical clustering with a dendrogram, a clustered heat map, and multidimensional scaling.
- **Machine learning lab.** Nearest neighbors, trees, naive Bayes, logistic regression, the perceptron, a small neural network, ridge, and the lasso on toy sets or your data, with seeded splits, and cross-validation.
- **Spatial statistics.** Point-pattern statistics, Moran's I and Geary's C with local clusters, semivariograms, ordinary kriging with contour maps, and inverse-distance weighting.

Also in this window:

- **Live calculation block from a model.** The Insert menu's Live calculation block keeps the tool's answer with its key results on the page.

#### Statistics: inference and design

Describes data and runs tests, epidemiology, power, resampling, Bayesian updating, and sampling.

**kit-statistics.** The Statistics kit describing a column of data, with its summary table. ([dark](screens/kit-statistics-dark.png))

![The Statistics kit describing a column of data, with its summary table.](screens/kit-statistics-light.png)

Open it with the command "Open the statistics kit".

Commands (11):

- **Describe data.** Summary statistics with bias-adjusted skewness and kurtosis, trimmed and other means, outlier screens with Grubbs' test, stem-and-leaf displays, frequency tables, grouped data, and category counts.
- **Compare groups (ANOVA).** One-way and Welch ANOVA with assumption checks, Tukey, Games-Howell, and adjusted pairwise tests, contrasts, two-way (Type II and III), repeated-measures, and mixed designs, and effect sizes with exact intervals.
- **Rank-based tests.** Mann-Whitney, Wilcoxon signed-rank, sign, Kruskal-Wallis with Dunn, Friedman with Conover and Nemenyi, Hodges-Lehmann, and Kolmogorov-Smirnov tests, exact for small samples.
- **Contingency tables.** Chi-square and G tests with residuals, Fisher's exact test, McNemar, Cochran's Q, association measures, the trend test, and forecast skill scores.
- **Epidemiology and diagnostic tests.** Risk and odds ratios with intervals, Mantel-Haenszel strata with Breslow-Day, diagnostic accuracy, rates, and direct (US 2000 standard, NCHS) and indirect standardization.
- **Correlation.** Pearson, Spearman, Kendall, point-biserial, and partial correlations, matrices with adjusted p-values, and comparisons of 2 correlations.
- **Power and sample size.** Solves for n, power, the detectable effect, or alpha from exact noncentral distributions for the common tests, with a power curve.
- **Multiple testing and meta-analysis.** P-value adjustments and q-values, Fisher and Stouffer, fixed- and random-effects meta-analysis with forest and funnel plots, volcano and Manhattan plots, and printed critical-value tables.
- **Simulation and resampling.** Seeded bootstrap intervals (percentile, basic, BCa), exact or Monte Carlo permutation tests, a sampling-distribution lab, and simulations.
- **Bayesian updating.** Conjugate updates with credible and highest-density intervals, Savage-Dickey and JZS Bayes factors, grid posteriors, a Metropolis sampler, and Bayes tables.
- **Sampling and randomization.** Assignment lists, Latin and Williams squares, factorial layouts, samples from a frame, allocation, stratified estimates, design effects, and margins of error.

### Pictures

**kit-music-score.** A score block on a page, with a short melody on the staff. ([dark](screens/kit-music-score-dark.png))

![A score block on a page, with a short melody on the staff.](screens/kit-music-score-light.png)

## Study tools

### Features

#### Study tools

- Flashcard and quiz blocks can be embedded in any page.
- Make them by hand, or generate them from a page, a section or a recording's transcript.
- Card types: question and answer, fill-in-the-blank, multiple choice, and image occlusion (hide part of a diagram).
- A spaced-repetition schedule shows which cards are due.

#### More

- **Study tape.** Draw tape over any ink, text, or part of an image to hide it, then tap to show or hide it again.
- **Exam dates for decks.** Set an exam date on a deck, and the schedule spreads new and due cards so all are seen before that day.
- **Inline flashcards.** Type a question and an answer on one line, separated by `::`, and the line becomes a card in the page's deck.
- **Deck import.** Imports decks from Anki packages and from CSV or text files, with their images.
- **Repeating to-dos.** A due date can repeat: "every weekday", "every 2 weeks", "monthly on the 1st", or "3 days after I finish".
- **Class schedule.** A weekly schedule holds classes or meetings with their names, days, times, and rooms.
- **Exam countdown.** Add an exam, with a name, a date, and an optional time, to a notebook, a section, or a deck.
- **Reference tables.** A periodic table with name, symbol, atomic number, mass, group, and electron configuration, and tables of physical constants, metric prefixes, and Greek letters.
- **Calendar files and course imports.** Imports iCalendar files (`.ics`) from a calendar app or a school portal into the class schedule and the Upcoming pane.
- **Zotero citations in the page.** With Zotero running, Add or edit citation, Add or edit bibliography, Refresh, Unlink, and Document settings open Zotero's own windows.

### Tool windows

#### Citations

Keeps a list of sources for each notebook.

**citations.** The Citations window with two sources and the bibliography style. ([dark](screens/citations-dark.png))

![The Citations window with two sources and the bibliography style.](screens/citations-light.png)

Open it with the command "Open citations".

#### Dictionary

Select a word and press a shortcut, or type in the tool window, to see meanings, synonyms, and examples.

**dictionary.** The dictionary window with a word's definitions and related words. ([dark](screens/dictionary-dark.png))

![The dictionary window with a word's definitions and related words.](screens/dictionary-light.png)

Open it with the command "Open the dictionary".

Commands (1):

- **Look up the selected word.**

#### Flashcards

Reviews the cards of your decks on a spaced-repetition schedule, and imports and exports decks.

**flashcard-review.** A flashcard under review, with its answer shown and the buttons to rate it. ([dark](screens/flashcard-review-dark.png))

![A flashcard under review, with its answer shown and the buttons to rate it.](screens/flashcard-review-light.png)

Open it with the command "Open flashcards".

#### Practice exams

Make an exam-style paper from a page, a section, or a notebook: short answer, multiple choice, fill-in, worked problems with new numbers, and true or false, and each with marks.

**practice-exam.** A practice exam made from a page, with its questions ready to answer. ([dark](screens/practice-exam-dark.png))

![A practice exam made from a page, with its questions ready to answer.](screens/practice-exam-light.png)

Open it with the command "Open practice exams".

#### Reference tables

A periodic table as a keyboard-navigable grid (arrow keys, Home, and End) with a family filter, a list view, and a card for each element that shows its atomic number.

**reference-tables.** The reference tables window with a table of standard values. ([dark](screens/reference-tables-dark.png))

![The reference tables window with a table of standard values.](screens/reference-tables-light.png)

Open it with the command "Open the reference tables".

#### Timers

Three kinds: a countdown, a stopwatch with laps, and a focus timer with work and break lengths the person sets, such as 25 and 5 minutes.

**tool-timer.** The timers window with a countdown running. ([dark](screens/tool-timer-dark.png))

![The timers window with a countdown running.](screens/tool-timer-light.png)

Open it with the command "Open timers".

#### Upcoming

Any checkbox or tagged line can have a due date, typed in plain words such as "Fri 5 PM", "tomorrow", or "Dec 3".

**tool-upcoming.** The Upcoming window for tasks and due dates. ([dark](screens/tool-upcoming-dark.png))

![The Upcoming window for tasks and due dates.](screens/tool-upcoming-light.png)

Open it with the command "Open upcoming".

### Commands

| Command | Default keys |
| --- | --- |
| Insert flashcards |  |
| Insert quiz |  |
| Make flashcards from this page |  |
| Make flashcards from the selected text |  |
| Make flashcards from this section |  |
| Insert bibliography |  |
| Import cards |  |
| Insert study tape |  |
| Show all study tape |  |
| Hide all study tape |  |
| Make a practice exam from this page |  |
| Make a practice exam from this section |  |
| Make a practice exam from this notebook |  |
| Retake this practice exam |  |
| Add or edit citation with Zotero |  |
| Add or edit bibliography with Zotero |  |
| Refresh Zotero citations |  |
| Unlink Zotero citations |  |
| Zotero document settings |  |

### Pictures

**study-flashcards.** The Flashcards window, with cards made from three typed lines. ([dark](screens/study-flashcards-dark.png))

![The Flashcards window, with cards made from three typed lines.](screens/study-flashcards-light.png)

**quiz-block.** A quiz block on a page, with one answer chosen and its feedback. ([dark](screens/quiz-block-dark.png))

![A quiz block on a page, with one answer chosen and its feedback.](screens/quiz-block-light.png)

**practice-exam-results.** The marked results of a practice exam, with the score and each question's answer. ([dark](screens/practice-exam-results-dark.png))

![The marked results of a practice exam, with the score and each question's answer.](screens/practice-exam-results-light.png)

## On-device intelligence

### Features

#### On-device intelligence setup

- **Recommended.** Transcription, handwriting recognition, text in images (OCR) and summaries, all running on this device.
- **Custom.** Pick each feature, and choose a local model or your own cloud key.
- **Not now.** Everything stays off and can be turned on later in Settings.

#### On-device intelligence

- **Dictation.** A Dictate button and shortcut type spoken words at the cursor, with spoken punctuation.
- **Live captions.** While a recording runs, a caption strip shows the speech as text within seconds.
- **Background work controls.** An activity panel lists queued work in plain words, such as reading text in images, recognizing handwriting, transcribing, and indexing.
- **Custom transcript vocabulary.** A word list of names, course terms, acronyms, and spellings that the transcriber prefers.
- **Transcript lines to notes.** Select lines in a transcript and press one key to copy them into the page's notes as a quote with its timestamp.
- **Pen editing on typed text.** With the pen, a person can strike through words to delete them, draw a vertical line between words to add space or split a paragraph, and circle words to select them.
- **Reflow and tidy handwriting.** Lasso handwriting and drag its side handles, and the words rewrap to the new width.
- **Search by meaning and ask your notes.** "Find by meaning" matches pages about the same idea even when the words differ, and a Related pages list sits beside each page.
- **Writing tools.** Select text, and choose Proofread, Rewrite, Shorten, Make a list, or Tidy structure.
- **Action items and chapters.** After transcription, "Find action items" lists tasks and decisions.
- **Translate on this device.** Translates a selection, a page, or a transcript into another language and puts the translation beside or below the original, never over it.

### Pictures

**setup-intelligence.** Step 4: on-device intelligence, with Not now selected. ([dark](screens/setup-intelligence-dark.png))

![Step 4: on-device intelligence, with Not now selected.](screens/setup-intelligence-light.png)

**writing-tools.** The writing tools on a selected paragraph, with a suggested change to accept or reject. ([dark](screens/writing-tools-dark.png))

![The writing tools on a selected paragraph, with a suggested change to accept or reject.](screens/writing-tools-light.png)

**speech-model.** The speech model in Settings, with its size shown before anything is downloaded. ([dark](screens/speech-model-dark.png))

![The speech model in Settings, with its size shown before anything is downloaded.](screens/speech-model-light.png)

**translate.** The Translate window, with the language pack and its size shown before anything is downloaded. ([dark](screens/translate-dark.png))

![The Translate window, with the language pack and its size shown before anything is downloaded.](screens/translate-light.png)

**settings-intelligence.** On-device intelligence: every feature off, each marked as running on this device. ([dark](screens/settings-intelligence-dark.png))

![On-device intelligence: every feature off, each marked as running on this device.](screens/settings-intelligence-light.png)

## Import and export

### Features

#### Export a selection

- Export as PDF has an Update button once a page's PDF has been saved in this session.
- Lasso any area, then choose "Export selection" to save it as PDF, PNG, SVG or `.docx`, or copy it as an image.
- This works for annotated images: import a photo, draw on it, and export just that part.

#### Import and export

- **Import reports and undo.** Each import lands in its own notebook, with a report for each page: what came over, what was simplified, and what was skipped and why.
- **Note space around slides and PDFs.** "Add note space" widens imported slides or PDF pages with a ruled or blank margin on the right, the bottom, or both.
- **Copy meeting recap.** For a page with a recording, "Copy recap" puts the summary, decisions, and action items on the clipboard as formatted text or Markdown, ready to paste into email or chat.
- **Dim PDFs in dark mode.** Imported PDFs and slides can be dimmed or color-inverted in the Evening theme, with images kept in their own colors.
- **OneNote files from disk.** Reads OneNote notebook packages (`.onepkg`) and section files (`.one`) saved on the computer, with no sign-in.
- **Import from other apps.** Imports Notion exports (Markdown and CSV, with databases becoming smart tables), Google Keep exports from Takeout, Joplin exports, Bear TextBundle files, and Logseq folders.
- **Goodnotes, Notability, and Samsung Notes.** Imports the handwriting apps' own files (`.goodnotes` and backups of them, `.note`, `.sdocx`) into a notebook, one section for each file.
- **Windows Sticky Notes.** Imports the notes from the Sticky Notes app on this PC, with their text, colors, and dates, into a notebook of their own.
- **Open single files.** "Open with OpenNote" on a Markdown or text file opens it as a page and saves back to the same file.
- **Highlights from PDFs.** Select text on an imported PDF page and press a key to highlight it in one of the highlighter colors.
- **Scan cleanup.** "Clean up" takes a photo of a page, a whiteboard, or a slide, finds its edges, straightens the perspective, evens out the lighting, and offers color, and grayscale.
- **Web pages.** "Export as web page" writes one self-contained `.html` file with the text, images, ink as vector graphics, and recordings with a player that highlights notes as the audio plays.
- **Share as a file.** Saves a page, a section, or a notebook as one file that opens in OpenNote, with its structure, tags, properties, and, if chosen, history.

### Commands

| Command | Default keys |
| --- | --- |
| From phone |  |
| Import notes… |  |
| Export… |  |
| Export as LaTeX… |  |
| Share as a file… |  |
| Open file… |  |
| Make OpenNote the default app for Markdown and text files… |  |
| Export as PDF… |  |
| Export as Markdown… |  |
| Export as Word… |  |
| Export as HTML… |  |
| Export selection as image… |  |
| Export (not in the palette) |  |
| Import PDF as pages |  |
| Insert PDF |  |
| Add note space |  |
| Make handouts |  |
| Highlight the selected words | Ctrl+Shift+H |
| PDF highlights |  |
| Show PDF pages as they are |  |
| Dim PDF pages in the dark theme |  |
| Invert PDF pages in the dark theme |  |
| Copy the text of PDF pages |  |
| Clean up scan |  |
| Scan pages from photos |  |
| Restore the original photo |  |

### Pictures

**import.** The Import notes dialog before a file is chosen, with the supported sources. ([dark](screens/import-dark.png))

![The Import notes dialog before a file is chosen, with the supported sources.](screens/import-light.png)

**import-review.** The review after choosing a file: what comes over and what does not. ([dark](screens/import-review-dark.png))

![The review after choosing a file: what comes over and what does not.](screens/import-review-light.png)

**export.** The Export dialog with a section and the Word document format chosen. ([dark](screens/export-dark.png))

![The Export dialog with a section and the Word document format chosen.](screens/export-light.png)

**pdf-import.** A PDF inserted as locked page pictures to write on. ([dark](screens/pdf-import-dark.png))

![A PDF inserted as locked page pictures to write on.](screens/pdf-import-light.png)

## Sync and connectors

### Features

#### Office and Google Workspace

- **Word / Google Docs.** Imports `.docx`, `.odt`, Google Docs and exports `.docx`, Google Docs, PDF.
- **Excel / Google Sheets.** Imports `.xlsx`, `.csv`, Google Sheets into smart tables and exports `.xlsx`, `.csv`, Google Sheets.
- **PowerPoint / Google Slides.** Imports `.pptx`, Google Slides as annotatable pages and exports `.pptx` (one page per slide), PDF.
- **LaTeX.** Exports `.tex` for a page, section, or notebook; a `.zip` with `images/` and `references.bib` when there is more than one file.
- **OneNote / Evernote.** Imports Graph API, `.enex` and exports PDF, Markdown.
- People can link Google and Microsoft accounts in Settings, then Connectors, along with Slack, Dropbox, Box, Vimeo, Readwise, Canvas, and Moodle.
- The "Send to" menu converts a page, section, or selection to PDF, Word, or Google Docs, then uploads it to a chosen Google Drive or OneDrive folder.
- Favorite destinations are saved, so "Send to Drive: Biology/Lab reports" becomes one click.
- A page can stay linked to its exported copy and offer "Update the Drive copy" after edits.
- Linking is optional. Nothing is uploaded without an explicit action.

#### Video and audio platforms

- Paste a YouTube, Vimeo, or podcast link to embed a player.
- Video files (mp4 and webm, up to 200 MB) dropped, pasted, or chosen with Insert video file play in a block on the page.
- Transcripts come from the platform's captions when available, or from on-device transcription of audio the person has the right to use.
- Recordings can be exported as audio or as a narrated video of the page, and uploaded to a linked YouTube account as private or unlisted.

#### More integrations

- **Outlook and Google Calendar.** Opens a meeting note from any event, filled in with the title, time, attendees, and agenda.
- **Teams, Zoom, and Google Meet.** Records meeting audio without a bot (Phase 9) and links the note back to the calendar event.
- **Microsoft To Do and Google Tasks.** Two-way sync of checkboxes, due dates, and reminders.
- **Outlook and Gmail.** "Save to OpenNote" from an email keeps the text and attachments with a link back.
- **Web clipper for Edge, Chrome, and Firefox.** Clips a full page, a region, or a clean article into any section.
- **Windows share target and Snipping Tool.** "Share to OpenNote" from any app, and screenshots go straight to the current page.
- **Phone camera.** Scan a QR code shown in OpenNote to send photos and document scans from a phone.
- **Zotero and BibTeX.** Cite sources while writing and export a bibliography in any common style.
- **Canvas, Moodle, and Google Classroom.** Import assignments into a section and submit a page as PDF.
- **Desmos, GeoGebra, Figma, Miro, and Lucidchart.** Live embeds that fall back to a static image offline.
- **Kindle and Readwise.** Import book highlights into a notebook.
- **Slack and Teams chat.** Share a page as a link, PDF, or image.
- **Dropbox, OneDrive, iCloud Drive, Box, and WebDAV.** Sync folders and "Send to" destinations.
- **End-to-end-encrypted sync (Beta).** Optional sync of the notes folder between devices through a folder or a WebDAV server the person already has, with no OpenNote server ([ADR 0049](adr/0049-end-to-end-encrypted-sync.md)).
- **Webhooks and a local API.** Connect Zapier, Power Automate, or scripts to create pages and export files.
- **AI assistants (Model Context Protocol, MCP).** Lets an assistant the person chooses read or write notes, only with permission.

#### More

- **Pen settings sync.** Pens, colors, and toolbars follow the person to every device.

### Commands

| Command | Default keys |
| --- | --- |
| Share page to Slack |  |
| Share page to Teams |  |
| Bring in course assignments |  |
| Submit page as PDF |  |
| Send to Google Drive |  |
| Send to OneDrive |  |
| Send to Dropbox |  |
| Send to Box |  |
| Send to a WebDAV server |  |
| Update the copy that was sent to the cloud |  |
| Sync Dropbox, Box, and WebDAV copies |  |
| Keep Dropbox, Box, and WebDAV copies up to date automatically |  |
| Stop keeping Dropbox, Box, and WebDAV copies up to date automatically |  |
| Import from Google Docs, Sheets, or Slides |  |
| Export to Google Docs |  |
| Export tables to Google Sheets |  |
| Export to Google Slides |  |
| Import OneNote notebooks from Microsoft |  |
| Sync tasks with Microsoft To Do |  |
| Sync tasks with Google Tasks |  |
| Show task sync changes made in both places |  |
| Sync pen settings across my devices |  |
| Stop syncing pen settings on this device |  |
| Sync Readwise |  |
| Sync now |  |
| Pause sync |  |
| Preview sync changes |  |
| Change sync passphrase |  |
| Sync settings |  |

### Pictures

**sync-settings.** Settings, then Sync: step 1 of 4, choosing where sync keeps its encrypted data. ([dark](screens/sync-settings-dark.png))

![Settings, then Sync: step 1 of 4, choosing where sync keeps its encrypted data.](screens/sync-settings-light.png)

**connector-prompt.** A connector card after Connect, stopped at the sign-in step with nothing sent yet. ([dark](screens/connector-prompt-dark.png))

![A connector card after Connect, stopped at the sign-in step with nothing sent yet.](screens/connector-prompt-light.png)

**settings-connectors.** Connectors: accounts that some features use, each saying "Needs setup". ([dark](screens/settings-connectors-dark.png))

![Connectors: accounts that some features use, each saying "Needs setup".](screens/settings-connectors-light.png)

## Protection and privacy

### Features

#### Hardening and beta

- **Privacy panel and Work offline.** Settings, then Privacy, lists every kind of network use the app can make, such as update checks, model downloads, embeds, and linked accounts, with when each last ran.
- **Safe start after crashes.** After two crashes in a row, the next start offers "Start in safe mode", which turns off background work, embeds, and on-device models.
- **Fuzzed importers.** Every importer that reads files from other apps (zip, Evernote, Word, OpenDocument, Excel, PowerPoint, web pages, web archives, Markdown, CSV, and SQLite) and the search indexer have fuzz targets.

#### More

- **Password-protected sections.** Encrypted on disk, unlocked with Windows Hello.
- **Lock entry.** For lab notebooks and records, "Lock entry" makes a page read-only and stamps it with the date and time from the PC's clock.
- **Protected sections lock again.** Password-protected sections lock again after a chosen idle time, when the person leaves them, and when Windows locks or sleeps.
- **App permissions and access log.** Each app connected through the local API or an AI assistant (MCP) gets its own access: read-only or read and write, all notebooks or chosen ones, and never locked sections.

### Commands

| Command | Default keys |
| --- | --- |
| Check OpenNote |  |
| Send feedback |  |
| Privacy settings |  |
| Work offline |  |
| Lock entry |  |
| Unlock entry… |  |
| Protect with password… |  |
| Unlock section… |  |
| Lock section |  |
| Change section password… |  |
| Remove protection… |  |
| Unlock with Windows Hello |  |
| Stop unlocking with Windows Hello |  |
| Lock all protected sections |  |

### Pictures

**protected-section.** A password-protected section after it locks, with the Unlock section button. ([dark](screens/protected-section-dark.png))

![A password-protected section after it locks, with the Unlock section button.](screens/protected-section-light.png)

**settings-privacy.** Privacy: work offline and a plain list of every network use. ([dark](screens/settings-privacy-dark.png))

![Privacy: work offline and a plain list of every network use.](screens/settings-privacy-light.png)

**settings-app-permissions.** App permissions: the local API and the apps allowed to use it. ([dark](screens/settings-app-permissions-dark.png))

![App permissions: the local API and the apps allowed to use it.](screens/settings-app-permissions-light.png)

## Settings and accessibility

### Features

#### Appearance and layout

- **Themes.** Light, Dark, or Match Windows, from Settings, the moon button in the title bar, or the command palette.
- **Page color in dark mode.** A page can match the dark theme or stay paper white.
- **Text size.** Scales everything. Ctrl+= and Ctrl+- change it from anywhere, and Ctrl+0 resets it.
- **Reduce motion.** Matches the Windows setting, or always reduces motion.
- **Size of buttons and rows.** Automatic follows the pointer you used last, Standard sizes them for a mouse, and Large gives every pointer touch-size targets.
- **Windows contrast themes.** When a Windows contrast theme is on, Windows sets the colors, and your theme choice applies again when it is off.
- **Compact layout.** A narrow window or a tablet shows an app bar, one pane at a time, a drawer, and a notebooks rail.

#### More

- **Spell check.** Several languages at once, and a personal dictionary.
- **Shortcut cheat sheet.** Ctrl+/ shows every shortcut, and each one can be changed.
- **OneNote shortcuts.** Setup offers a "OneNote" shortcut set, so switchers keep their habits, such as Ctrl+1 to Ctrl+9 for tags, Ctrl+Alt+1 to 6 for headings, and Ctrl+E to search.
- **Interface size.** Scales sidebars, toolbars, and menus from 90% to 150% without changing the page zoom.
- **Language and spelling.** American English is the default, even when Windows uses another language.
- **Accessible charts.** Each chart gets an editable text summary of its type, axes, range, trend, and highest and lowest values.
- **Math that screen readers speak.** Equations carry MathML behind the rendered math, so screen readers can speak them, show them in braille, and move through them term by term.
- **Accessibility checker.** "Check accessibility" lists problems on a page or section, each with a fix.

### Settings and first-run setup

- **Settings sections.** General, Appearance, Language, Editing, Recording, Pen and touch, My handwriting, On-device intelligence, Storage and backups, Updates, Privacy, Windows and power, App permissions, Connectors, Sync, Help, Shortcuts, and About.
- **First-run setup steps.** Welcome to OpenNote, Choose your look, Language and spelling, On-device intelligence, Keys and pen, Where to keep things, and Bring in your notes.

### Commands

| Command | Default keys |
| --- | --- |
| Check accessibility |  |
| Open settings | Ctrl+, |
| Back to notes |  |
| Show keyboard shortcuts | Ctrl+/ |
| Toggle dark mode | Ctrl+Shift+D |
| Use the light theme |  |
| Use the dark theme |  |
| Match the Windows theme |  |
| Open appearance settings |  |
| Zoom in | Ctrl+= |
| Zoom out | Ctrl+- |
| Actual size | Ctrl+0 |

### Pictures

**setup-welcome.** Step 1 of 7: the welcome desk by the window. ([dark](screens/setup-welcome-dark.png))

![Step 1 of 7: the welcome desk by the window.](screens/setup-welcome-light.png)

**setup-look.** Step 2: the Light, Dark, and Match Windows preview cards. ([dark](screens/setup-look-dark.png))

![Step 2: the Light, Dark, and Match Windows preview cards.](screens/setup-look-light.png)

**setup-language.** Step 3: the language and spelling choice, with American English as the default. ([dark](screens/setup-language-dark.png))

![Step 3: the language and spelling choice, with American English as the default.](screens/setup-language-light.png)

**setup-keys-and-pen.** Step 5: the shortcut set and the pen top button. ([dark](screens/setup-keys-and-pen-dark.png))

![Step 5: the shortcut set and the pen top button.](screens/setup-keys-and-pen-light.png)

**setup-storage.** Step 6: the notes folder and the first notebook. ([dark](screens/setup-storage-dark.png))

![Step 6: the notes folder and the first notebook.](screens/setup-storage-light.png)

**setup-import.** Step 7: bringing in notes from another app. ([dark](screens/setup-import-dark.png))

![Step 7: bringing in notes from another app.](screens/setup-import-light.png)

**settings-general.** General: the notes folder and start-up. ([dark](screens/settings-general-dark.png))

![General: the notes folder and start-up.](screens/settings-general-light.png)

**settings-appearance.** Appearance: theme cards, page color, text size, and interface size. ([dark](screens/settings-appearance-dark.png))

![Appearance: theme cards, page color, text size, and interface size.](screens/settings-appearance-light.png)

**settings-language.** Language: the language and spelling choices, with American English as the default. ([dark](screens/settings-language-dark.png))

![Language: the language and spelling choices, with American English as the default.](screens/settings-language-light.png)

**settings-editing.** Editing: Markdown shortcuts, the slash menu, and AutoCorrect. ([dark](screens/settings-editing-dark.png))

![Editing: Markdown shortcuts, the slash menu, and AutoCorrect.](screens/settings-editing-light.png)

**settings-storage.** Storage and backups: backups and the notebooks that cannot be found. ([dark](screens/settings-storage-dark.png))

![Storage and backups: backups and the notebooks that cannot be found.](screens/settings-storage-light.png)

**settings-updates.** Updates: the update channel, checking for updates, and going back to the last version. ([dark](screens/settings-updates-dark.png))

![Updates: the update channel, checking for updates, and going back to the last version.](screens/settings-updates-light.png)

**settings-windows.** Windows and power: quick capture and its shortcut. ([dark](screens/settings-windows-dark.png))

![Windows and power: quick capture and its shortcut.](screens/settings-windows-light.png)

**settings-help.** Help: this copy of OpenNote and the ways to get help. ([dark](screens/settings-help-dark.png))

![Help: this copy of OpenNote and the ways to get help.](screens/settings-help-light.png)

**settings-shortcuts.** Shortcuts: the two sets and the list of commands to change. ([dark](screens/settings-shortcuts-dark.png))

![Shortcuts: the two sets and the list of commands to change.](screens/settings-shortcuts-light.png)

**settings-about.** About: version, channel, license, and the window drawing. ([dark](screens/settings-about-dark.png))

![About: version, channel, license, and the window drawing.](screens/settings-about-light.png)

**accessibility-checker.** The accessibility checker's report on a page, with each problem and how to fix it. ([dark](screens/accessibility-checker-dark.png))

![The accessibility checker's report on a page, with each problem and how to fix it.](screens/accessibility-checker-light.png)

## Platforms

### Features

#### macOS and Linux

- **macOS and Linux builds.** `OpenNote_macOS.dmg` (one universal app for macOS 11 and later) and `OpenNote_Linux.AppImage` (64-bit, glibc 2.35 or later), unsigned until the owner adds the signing secrets.
- **Menu bar on macOS.** The Mac menu bar lists OpenNote's commands, one menu per category as in the shortcut list, with each command's key equivalent (`⇧⌘D`), next to the app menu (About, Settings, and Hide.
- **Save as PDF and Print on macOS and Linux.** Save as PDF and Print use the same print window, range, and headers as on Windows.
- **Read aloud and spell check on macOS and Linux.** Read aloud uses the system voices (`say` on a Mac, `espeak-ng` on Linux), with each word marked as it is read.
- **Command line on macOS and Linux.** The `opennote` command is built for both Mac processors and Linux, and OpenNote puts it at `~/.local/bin/opennote` each time it starts.
- **Sign-ins and sync keys on macOS and Linux.** Connector tokens and sync keys go in the login Keychain on a Mac, and in the Secret Service (GNOME Keyring or KWallet) on Linux.
- **Text in pictures and handwriting on macOS and Linux.** Text in pictures is read on the device by Apple's Vision on a Mac, and by Tesseract on Linux when it is installed.

#### More

- **Low-power mode.** Reduces animations and background work on battery.
- **Portable mode.** A file named `portable` next to the program keeps settings, caches, and downloaded models in that folder instead of the Windows profile.
- **Command-line tool.** An `opennote` command creates pages, appends text to the daily note, searches, exports, and runs a backup from a terminal or a script.
- **Installed apps entry.** The installer is per user, needs no administrator rights, and adds OpenNote to Windows Installed apps so it can be removed there.
- **Updates that resume and wait for an unmetered network.** An update download that stops partway, because the PC slept or the network dropped, continues from where it stopped next time instead of starting again.
- **Update downloads that resume.** If an update download stops partway, the next try continues from the part already saved, after it is checked again.

### Commands

| Command | Default keys |
| --- | --- |
| Add the opennote command to PATH (not in the palette) |  |
| Show what works on this computer |  |
| Check for updates |  |
| Restart to update |  |
| Go back to the previous version |  |
| Download the update |  |
| Skip this update (not in the palette) |  |
| Install the skipped update (not in the palette) |  |
| Open the release notes (not in the palette) |  |
| Report a problem with an update (not in the palette) |  |
| Add OpenNote to the Start menu (not in the palette) |  |
