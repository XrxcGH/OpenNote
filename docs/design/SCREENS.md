# OpenNote screens

These wireframes show the layout of each major screen, with sizes, keep-out zones and the rules behind them. They follow [BRAND.md](../../BRAND.md) and use its exact colors from [`brand/tokens.json`](../../brand/tokens.json). They are layout guides, not pixel-perfect mockups: icons are placeholders, and gray bars stand in for text.

## Contents

- [Reading the drawings](#reading-the-drawings)
- [First run](#first-run)
- [A new page](#a-new-page)
- [Organizing notebooks](#organizing-notebooks)
- [Paginated view](#paginated-view)
- [Recording](#recording)
- [Search and commands](#search-and-commands)
- [Settings](#settings)
- [Size classes](#size-classes)
- [Phone](#phone)
- [Study tools](#study-tools)
- [Send to](#send-to)
- [Changing the drawings](#changing-the-drawings)

## Reading the drawings

- **Magenta hatching** marks a keep-out zone. Nothing interactive or important may be placed there, because the system or another control owns that space.
- **Violet dashed outlines** mark layout regions, with sizes in pixels at 100% display scaling.
- Desktop screens are drawn at 1440 × 900, the "wide" size class.

Keep-out zones that apply to every desktop screen:

| Zone | Size | Why |
|---|---|---|
| Window buttons | 138 × 40, top right | Windows draws minimize, maximize, and close here. Hovering maximize opens Snap Layouts. |
| Title bar drag area | At least 200 px wide | People must always be able to grab the window to move it |
| Compact title bar | Drag area and window buttons only | The theme toggle and other items move to the app bar below, so the drag area stays wide. Setup shows the logo, the name, the drag area, and the window buttons |
| Pane resize handles | 8 px wide | Dragging the divider resizes a pane, so nothing clickable may sit on it |

## First run

![First run, step 2: three theme cards, with Match Windows selected](images/01-first-run-look.svg)

Setup has five short steps in a centered 720 × 600 card:

1. **Welcome:** what OpenNote is, in one sentence.
2. **Choose your look:** Light, Dark, or Match Windows (shown above). Match Windows is selected in advance, with a caption that names the Windows setting, and clicking a card repaints the whole screen at once.
3. **Where to keep things:** the notes folder, where the app lives, and the first notebook (shown below).
4. **Smart features:** choose on-device transcription, handwriting, and image text (see FEATURES.md).
5. **Bring your notes (optional):** import from OneNote or Evernote, or skip.

![First run, step 3: notes folder, app location, and first notebook](images/02-first-run-storage.svg)

![First run, step 4: smart features with Recommended, Custom, and Not now](images/02b-first-run-smart.svg)

Step 4 lists each option as a full-width card, with model download sizes shown before anything downloads.

Paths are shown in full and wrap onto a second line rather than being cut in the middle. Back never loses what was entered.

## A new page

![A new, empty page in the three-pane layout, light theme](images/03-new-page.svg)

- **Title bar:** logo, breadcrumb, save status, the dark mode toggle, then the window buttons.
- **Command bar:** Home, Insert, Draw, and View tabs, with the active tab's tools to the right.
- **Notebooks pane (272, resizable 220 to 400):** notebooks, section groups, and sections, each with a color.
- **Pages pane (300, resizable 240 to 420):** pages in the selected section. Subpages are indented.
- **Page:** fills the rest and is never narrower than 480. Text starts 48 px in, and lines stop at 72 characters.
- **Pen palette:** floats at the bottom center of the page by default and can be dragged anywhere. Its home spot stays clear of other controls.

The same screen in the dark theme:

![The same new page in the dark theme](images/03-new-page-dark.svg)

## Organizing notebooks

![Dragging a page onto a section, and a page's right-click menu](images/04-organize.svg)

Two interactions are shown together here:

- **Drag and drop:** pages can be dragged onto any section, and sections onto any notebook. The target fills with the accent color, and a label on the dragged card says what will happen ("Move 1 page to Final"). Lists scroll by themselves when the pointer reaches the 28 px strips at either end.
- **Right-click or long-press** a page for Move to, Make subpage, Duplicate, Copy link, Export, and Delete. Delete sits last, in red, away from common actions.

Tree rows are 32 px tall with a pointer and 44 px on touch, indented 16 px per level. Keyboard users can move items with Ctrl+Shift+Up and Ctrl+Shift+Down.

## Paginated view

![A lab report in paginated view, with page margins, a table, a chart, and a page break](images/05-paginated-view.svg)

The View tab switches any page between the infinite canvas and paginated view. In paginated view:

- Pages are shown as sheets on the sunken background, at the chosen paper size (Letter here).
- The print margins are keep-out zones. Content placed there moves inside when the page is paginated.
- The gap between sheets is the page break, labeled with the page number. Tables, charts, and images never split across pages; they move to the next page whole.
- Tables and charts are live blocks. Editing the table redraws the chart.
- The side panes collapse to a 48 px rail to give the page more room.

What you see here is exactly what prints or exports to PDF.

## Recording

![A lecture page while recording, with timestamps and a live transcript](images/06-recording.svg)

- **Recording bar (48 px):** pinned above the page and never covering its title. It shows the recording dot, elapsed time, the audio source, a level meter, and Pause, Stop and Transcript buttons.
- **Time gutter (56 px):** shows when each paragraph or drawing was written. Tapping a time, or any stroke later, plays the recording from that moment.
- **Transcript panel (320 px, optional):** fills in live, on the device, with speaker labels.

## Search and commands

![The search and command palette over a dimmed page](images/07-search.svg)

Ctrl+K opens one box for both search and commands. It is 680 px wide and sits 90 px from the top, so the page stays visible below. Results cover typed text, handwriting, recording transcripts, and commands, with filter chips to narrow them. The title bar is never dimmed, so the window can still be moved or closed.

## Settings

![Settings with the Appearance and Updates sections](images/08-settings.svg)

Settings replaces the workspace, with a "Back to notes" link at the top left. The drawing shows two sections side by side for reference; the app shows one at a time.

- **Appearance:** theme (Light, Dark, Match Windows), page color in dark mode, text size and reduced motion.
- **Updates:** a ready update with "Restart to update", install preference, channel, and a one-click way back to the previous version.

The "Update ready" notice appears in the title bar only. It never pops up or interrupts work.

## Size classes

![The four layouts from phone to wide desktop](images/09-size-classes.svg)

The layout follows the window width, as set out in BRAND.md section 6. Snapping OpenNote to half of a laptop screen gives the medium layout, and a phone always gets the compact one.

## Phone

![Phone screens: the notebook list in light theme and a page in Reading view in dark theme](images/10-phone.svg)

- One pane at a time, with a bottom bar whose targets are at least 44 × 44.
- The status bar (47), home indicator (34) and left-edge back gesture (20) are keep-out zones.
- Freeform pages open in **Reading** view, where blocks flow in one column with 24 px margins. **Canvas** shows the original layout with pinch-zoom.
- With the pen tool active, a finger scrolls, and only the pen draws.

## Study tools

![A review page with a flashcard, a quiz, and the card generation panel](images/11-study-tools.svg)

- **Flashcard block (380 × 250):** shows the question, then the answer, then Again, Hard, Good, and Easy buttons that schedule the next review.
- **Quiz block (340 × 250):** multiple choice with instant feedback, shown with a check mark on the right answer.
- **Generate panel:** picks sources (this page, a recording, or a whole section) and card types, then makes editable cards on the device.
- The page list shows how many cards are due, so review is one click away.

## Send to

![The Send to dialog with Google Drive selected as the destination](images/12-send-to.svg)

- Sends this page, the whole section, or a lassoed selection as PDF, Word, Google Docs, or a PNG image.
- Destinations come from linked accounts (Google Drive, OneDrive) or this PC, with favorites listed first.
- "Keep linked" lets OpenNote offer to update the uploaded copy after later edits.
- The upload runs in the background, and a toast shows the link when it finishes.

## Changing the drawings

The drawings are generated by code in this folder, so they stay in step with the design tokens:

```sh
npm run design     # rebuild every SVG in docs/design/images
```

Each screen is a function in `docs/design/screens/`. Shared window parts live in `docs/design/lib/chrome.ts`, and drawing helpers in `docs/design/lib/svg.ts`. After changing `brand/tokens.json`, run `npm run design` and commit the updated images.
