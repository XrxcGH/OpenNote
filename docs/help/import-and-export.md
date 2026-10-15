# Import and export

Bring notes in from other apps and take them out again. Your notes stay in plain files either way.

![The review after choosing a file: what comes over and what does not](../screens/import-review-light.png)

## Import

Press Ctrl+K and choose Import. First-time setup has the same step. Pick a source, then choose a file or folder.

| Source | What you get |
|---|---|
| An Obsidian vault or a folder of Markdown | A notebook with its pages |
| Word (`.docx`) and OpenDocument (`.odt`) | A page for each file |
| Excel (`.xlsx`) | Table pages |
| PowerPoint (`.pptx`) | One page for each slide |
| Email (`.eml`) | A page with its attachments |
| Kindle clippings and a Readwise CSV file | Your highlights |
| Windows Sticky Notes | Your notes and their pictures |

Before anything is added, a review lists what comes over and what does not. Choose Save report to keep that list. Undo takes an import back.

## Export

Open Share, then Export, or press Ctrl+K and choose Export.

![The Export dialog with a section and the Word document format chosen](../screens/export-light.png)

- Pages, sections, and whole notebooks export as Markdown, Word, or a single HTML file.
- Tables export as `.xlsx` or `.csv`. Pages export as a PowerPoint file.
- A page's own Export and Print menu makes a PDF. The PDF format is not in the Import and export dialog yet.
- Lasso an area to export just that part.

## Screenshots and copies

Take a screenshot with Win+Shift+S and OpenNote offers to add it to the open page. You can send copies of pages to favorite folders, then choose Update the copy after you edit.

## Share to OpenNote

In another app, choose Share, then OpenNote. Text, a web link, a picture, or up to 10 files can come over, each file up to 15 MB.

- When a page is open, what you shared goes onto that page, the same way a paste would.
- When no page is open, or the open page is locked or read-only, OpenNote makes a new page in Quick notes in your first notebook.
- Anything OpenNote can't take is left out, and the rest still comes over.

Share to OpenNote is on in Beta builds. Windows only lists OpenNote in the Share window once the app has its package identity. A signed release gets it from its installer. A developer can try it with `packaging/msix/register-dev.ps1`. To save web pages, use the [web clipper](web-clipper.md).

## Not in beta 4

Share as a file is not finished and has no screen yet. Opening OneNote files and importing a PDF with space for notes are not built.

Import and export are built. Agents opened each dialog once. Nobody has tried a real import by hand.
