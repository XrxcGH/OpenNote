# Keyboard and screen reader checklist

A person runs this checklist at each phase exit and before each beta, on Windows 11 with a mouse put away. Automated suites cover what they can (axe, focus walks, ARIA snapshots, the keyboard specs); this list covers what needs a person, a real screen reader, or real hardware. Record each run in the table at the end, and file an issue for every item that fails.

## Phase 4: typed notes

### With Narrator and NVDA, no mouse

- [ ] Write and format a page. In browse mode, move through its headings and lists, both before the text's editor mounts and after.
- [ ] Toggle checkboxes. Fix a misspelling with F7. Insert a table and move through its cells. Add alt text to an image.
- [ ] Open the slash menu and hear its options. Move a text box in object mode. Change the reading order and hear it followed.
- [ ] Fold and unfold with the fold button and with the keys. Read a page aloud. Compare two versions.
- [ ] In every text box, hear "Press Escape, then Tab, to leave the text box."

### On a Surface, with a finger and the pen

- [ ] Create, move, and resize text boxes with the grip and the width handle while editing.
- [ ] Pinch to zoom, pan with one finger, and draw a marquee with the pen.
- [ ] Long-press a text box and an image to open their menus.
- [ ] Select text by touch and use the formatting bar that follows.
- [ ] Crop an image by touch.
- [ ] With a Wacom tablet, tap to type, then drag a handle.

### Text entry

In a text box, a table cell, and the page title, enter text with each of these, then undo. Each composition is one undo step, and nothing is saved mid-composition.

- [ ] The Japanese, Chinese (Pinyin), and Korean IMEs.
- [ ] The emoji panel (Win+.).
- [ ] The touch keyboard, with suggestions.
- [ ] Voice typing (Win+H) and Voice Access dictation.
- [ ] The Windows handwriting panel with a Surface Pen. Note what the "write in text fields" setting does on the page.

### Keyboard layouts

- [ ] With the Polish, German, and French layouts, type every AltGr character in a text box.
- [ ] Ctrl+Alt shortcuts that don't clash with AltGr characters still work on those layouts.

### Contrast and size

- [ ] In the Aquatic and Desert contrast themes, every page element is visible: rules, borders, highlights, the selection, handles, squiggles, and callouts.
- [ ] At 200% text size and at 320 CSS pixels wide, the page reflows. Nothing is cut off.

## Automated NVDA run

The nightly workflow runs a short part of this list by itself: NVDA, driven by Guidepup, opens the web build, moves by landmark, heading, tree, and tab, focuses the page text box, and opens the command palette, and a script checks that NVDA said the names and roles the app sets. The checks are in `tests/nvda/checklist.ts`. The run keeps its table and the full spoken log as the `nvda-results` artifact of the night's run. It does not replace the list above: it hears nothing in the desktop app, nothing from Narrator, and nothing a person would judge by ear.

## Runs

| Date | Build | Who | Result | Issues |
|---|---|---|---|---|
| | | | Not yet run for Phase 4 | |
