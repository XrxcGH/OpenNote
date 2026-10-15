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
| PowerPoint (`.pptx`) | One page for each slide, with the slide as a picture you can write on |
| Email (`.eml`) | A page with its attachments |
| Kindle clippings and a Readwise CSV file | Your highlights |
| Windows Sticky Notes | Your notes and their pictures |
| A Notion export | Its pages, with each database as a smart table |

Each slide is drawn from the file as a locked picture at the top of its page, so your ink stays where you wrote it. Charts, diagrams, videos, and some picture formats are not drawn, and the review lists them.

A Notion database keeps its column types. Numbers, money, dates, checkboxes, and short lists of choices are read from the cells, and the review names each typed column. A column with one value that does not fit stays as text.

Before anything is added, a review lists what comes over and what does not. Choose Save report to keep that list. Undo takes an import back.

## PDF files

Bring a PDF in to write on it. Each PDF page becomes a picture locked in place, so your ink and typed notes stay where you put them.

- Choose Import PDF as pages on the Home tab, or press Ctrl+K and choose it, to add a page to the open section for each PDF page.
- Choose Insert PDF on the Insert tab to put every PDF page into the open page, one below the other. Ctrl+Z takes them all back.
- The words of each PDF page come with it, so search finds them.
- Choose Add note space to put ruled or blank paper on the right of a PDF page or slide, below it, or both. It works on this page, a range of pages, or every page in the section.
- Choose Make handouts to lay out PDF pages or slides 2 or 3 to a page, with lines beside each one. The handouts are new pages at the end of the section.

Drag across the words of a PDF page to select them, and press Ctrl+C to copy them. To copy all the text of the PDF pages on a page, press Ctrl+K and choose Copy the text of PDF pages.

To highlight, select words on a PDF page and press Ctrl+Alt+H (Ctrl+Shift+H with the OneNote shortcuts). Click a highlight to change its color, remove it, or choose Send to notes, which adds the words as a quote beside the page with a link back to the spot. Press Ctrl+K and choose PDF highlights to see every highlight of the PDF in this section by color and page, and to copy or save them as Markdown.

In the dark theme, PDF pages and slides are dimmed so they are easier on the eyes, and the pictures in them keep their own colors. The Original switch at the top right of the page shows it as it is. Press Ctrl+K and choose Invert PDF pages in the dark theme to turn white pages dark instead. If you chose Always paper white for the page color in Settings, PDF pages stay as they are. Printing and export always use the PDF as it is.

A PDF that is damaged or locked with a password is not opened, and nothing is added. OpenNote reads the PDF on this PC and sends it nowhere.

## Clean up a scan

Take a photo of a page, a whiteboard, or a slide, and OpenNote can tidy it.

- Select the photo on a page, press Ctrl+K, and choose Clean up scan. OpenNote finds the edges of the page, straightens it, and evens out the lighting. Choose Color, Grayscale, or Black and white, and look at the preview before you choose Clean up.
- To scan several pages at once, choose Scan pages from photos on the Insert tab and pick the photos. Each one becomes a cleaned page, one below the other.
- The original photo is kept. Ctrl+Z undoes the cleanup in one step, and Restore the original photo brings it back later.

The cleanup runs on this PC. If the edges of the page are not clear, the whole photo is used.

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
