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

## Send to Google Drive or OneDrive

Connect Google or Microsoft in Settings, then Connectors. Press Ctrl+K and choose Send to Google Drive or Send to OneDrive. Choose what to send: what you selected with the lasso, this page, this section, or this notebook. Choose a file type (a PDF, a Word file, or on Google Drive a Google Doc), then walk to a folder and choose Send. Nothing is sent before that last button.

OpenNote remembers which file a page, section, or notebook was sent as. After you change the page, choose Update the Drive or OneDrive copy in Ctrl+K, and OpenNote replaces the file. When you open a page that has changed since you sent it, OpenNote offers once to update the copy. It never updates by itself. A selection can be sent but not updated, because the selection is gone later.

## Google Docs, Sheets, and Slides

Connect Google in Settings, then Connectors. To bring a file in, press Ctrl+K and choose Import from Google Docs, Sheets, or Slides. Pick the kind of file and then the file. Google turns it into a Word, Excel, or PowerPoint file, and Import notes opens on it so you can see what comes over before anything is added. A Google Sheet becomes pages with tables, and Google Slides becomes a page for each slide that you can write on.

To send a page the other way, choose Export to Google Docs, Export tables to Google Sheets, or Export to Google Slides. These are Send to Google Drive with the type already chosen. Google converts the file as it arrives, so it opens as a Google Doc, Sheet, or Slides file.

## Not in beta 4

Share as a file is not finished and has no screen yet. Opening OneNote files, importing a PDF with space for notes, and the web clipper are not built.

Import and export are built. Agents opened each dialog once. Nobody has tried a real import by hand.
