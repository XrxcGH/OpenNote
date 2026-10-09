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
| A Notion export | Its pages, with each database as a smart table |

A Notion database keeps its column types. Numbers, money, dates, checkboxes, and short lists of choices are read from the cells, and the review names each typed column. A column with one value that does not fit stays as text.

Before anything is added, a review lists what comes over and what does not. Choose Save report to keep that list. Undo takes an import back.

## Export

Open Share, then Export, or press Ctrl+K and choose Export.

![The Export dialog with a section and the Word document format chosen](../screens/export-light.png)

- Pages, sections, and whole notebooks export as Markdown, Word, or a single HTML file.
- Tables export as `.xlsx` or `.csv`. Pages export as a PowerPoint file.
- Choose PDF files to export a section or a whole notebook as PDF. Each page is printed the same way as a page's own Export as PDF, into folders that follow your sections, with an `index.html` that links every file. A page that can't be printed is listed in the summary, and the rest still export. Cancel stops at once and keeps nothing.
- A page's own Export and Print menu makes one PDF of that page.
- Lasso an area to export just that part.

## Open a Markdown or text file

Choose Open file on the Home tab, or press Ctrl+K and choose Open file. In Explorer, right-click a `.md` or `.txt` file and choose Open with, then OpenNote.

- The file opens as a page in the Opened files notebook. It stays where it is, with its name.
- What you type is saved back into the file a moment later. If another app changes the file, the page shows the new text.
- If both change at once, your page is kept and saved over the file, and a note offers the file's version instead.
- To open Markdown and text files in OpenNote by double-clicking, press Ctrl+K, and choose Make OpenNote the default app. Windows shows its Default apps page, where you choose OpenNote.

## Share as a file

Right-click a page, a section, or a notebook and choose Share as a file. You can also find it in the page's Export and Print menu, on the Home tab, or with Ctrl+K.

- OpenNote saves one `.opennote` file. Anyone with OpenNote opens it with Import notes, or by opening the file, and gets a new notebook with its sections, tags, and pictures. Opening it never changes your own notes.
- Type a password to lock the file. You type it twice, and anyone who opens the file needs it. OpenNote cannot recover a forgotten password.
- Turn on Include page history to bring each page's earlier versions along. They open as pages of a "Page history" section, each titled with its page and the time it was saved.
- Handwriting comes along as a picture of each page's ink.

## Screenshots and copies

Take a screenshot with Win+Shift+S and OpenNote offers to add it to the open page. You can send copies of pages to favorite folders, then choose Update the copy after you edit.

## Not in beta 4

Opening OneNote files, importing a PDF with space for notes, and the web clipper are not built.

Import and export are built. Agents opened each dialog once. Nobody has tried a real import by hand.
