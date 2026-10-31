# Goodnotes, Notability, and Samsung Notes

Bring notes over from the handwriting apps on a tablet or phone. There are two ways in: the app's own file, or a PDF that the app exports. The PDF always works and keeps every page as it looks. The app's own file keeps more of what you can still edit, where OpenNote can read it.

## Contents

- [The dependable way: a PDF](#the-dependable-way-a-pdf)
- [The app's own file](#the-apps-own-file)
- [What comes over](#what-comes-over)
- [If something is missing](#if-something-is-missing)

## The dependable way: a PDF

1. Export a PDF from the app:
   - **Goodnotes**: open the notebook, choose Share, then Export, then PDF.
   - **Notability**: open the note, choose Share, then PDF.
   - **Samsung Notes**: open the note, choose Share, then PDF file.
2. Copy the PDF to this computer.
3. In OpenNote, open the section the pages should go in. Press Ctrl+K and choose Import PDF as pages, or choose Import notes and press **Import a PDF…**.

Each PDF page becomes a page you can write and type on. The writing from the app is part of the picture, so it looks exactly as it did, but it is not strokes you can change.

## The app's own file

1. Send the file to this computer: a Goodnotes document (`.goodnotes`, or a backup of several in a folder or ZIP file), a Notability note (`.note`), or a Samsung Notes note (`.sdocx`).
2. Press Ctrl+K and choose Import notes, then **Choose a file…** or **Choose a folder…**.
3. Read the check. It lists what comes over and what does not, before anything is added.
4. Press **Import**. Each file becomes a section in a new notebook. A folder of files keeps its folders in the section names. **Undo import** removes it all.

This reader is new and starts in the Beta build. You can turn it off in Settings, under Experimental features (`interop.notesApps`).

## What comes over

| App           | Comes over                                                                                                                                                                                                                                           | Stays behind, and the report says so                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Notability    | Handwriting as strokes you can change, with pen colors, widths, and pressure. Highlighter strokes stay highlighters. Typed text, pictures, recordings (as files you can play), and imported PDF files (as attachments). Erased writing is expected to stay erased; no real note has confirmed it yet. | Shapes, and where text boxes and pictures sat on the page: they come after the writing instead.       |
| Goodnotes     | The pages in their order, with the pictures and PDF files each page uses.                                                                                                                                                                            | The handwriting and typed text, which Goodnotes keeps in a private format. Bookmarks and the outline. |
| Samsung Notes | The pages in their order, with their pictures, recordings, and PDF files, and text the file keeps in a readable form.                                                                                                                                | The handwriting and shapes, which Samsung Notes keeps in a private format.                            |

Everything stays on this computer. Nothing is sent anywhere.

## If something is missing

- **"Not imported: handwriting"**: export a PDF from the app and import that, as above. You can keep both: the PDF pages for how the notes looked, and the imported pages for the pictures and text.
- **"It is not a ZIP package"**: the file was saved by an older or different version of the app. Export a PDF instead.
- **A part was left out "to keep this computer safe"**: the file holds a part that expands far more than real notes do, or a name that points outside the file. The rest still imports.
