# Import and export

Bring notes in from other apps and take them out again. Your notes stay in plain files either way.

![The review after choosing a file: what comes over and what does not](../screens/import-review-light.png)

## Contents

- [Import](#import)
- [PDF files](#pdf-files)
- [Clean up a scan](#clean-up-a-scan)
- [Export](#export)
- [Open a Markdown or text file](#open-a-markdown-or-text-file)
- [Share as a file](#share-as-a-file)
- [Screenshots and copies](#screenshots-and-copies)
- [Send to Google Drive or OneDrive](#send-to-google-drive-or-onedrive)
- [Send to Dropbox, Box, or a WebDAV server](#send-to-dropbox-box-or-a-webdav-server)
- [Google Docs, Sheets, and Slides](#google-docs-sheets-and-slides)
- [OneNote through your Microsoft account](#onenote-through-your-microsoft-account)
- [Share to OpenNote](#share-to-opennote)
- [Not built yet](#not-built-yet)

## Import

Press Ctrl+K and choose Import. First-time setup has the same step. Pick a source, then choose a file or folder.

| Source | What you get |
|---|---|
| An Obsidian vault or a folder of Markdown | A notebook with its pages |
| Word (`.docx`) and OpenDocument (`.odt`) | A page for each file |
| Excel (`.xlsx`) | Table pages |
| PowerPoint (`.pptx`) | One page for each slide, with the slide as a picture you can write on |
| Older files: Word 97-2003 (`.doc`), Rich Text (`.rtf`), Excel 97-2003 (`.xls`), Excel binary (`.xlsb`), and OpenDocument spreadsheets (`.ods`) | A page for each document, and table pages for each workbook. Text, lists, tables, and links come over. Pictures in older Word files do not, so save those as `.docx` first. Files locked with a password must be unlocked in their own app first |
| Email (`.eml`) | A page with its attachments |
| Kindle clippings and a Readwise CSV file | Your highlights |
| Windows Sticky Notes | Your notes and their pictures |
| A Notion export | Its pages, with each database as a smart table |
| OneNote files (`.one`, `.onepkg`, or a notebook folder) | Its sections and pages, with no sign-in |

Each slide is drawn from the file as a locked picture at the top of its page, so your ink stays where you wrote it. Charts, diagrams, videos, and some picture formats are not drawn, and the review lists them.

A Notion database keeps its column types. Numbers, money, dates, checkboxes, and short lists of choices are read from the cells, and the review names each typed column. A column with one value that does not fit stays as text.

OneNote files come over without a Microsoft account. Pick a section file (`.one`), a notebook package (`.onepkg`), or the notebook's folder. Each section becomes a section, and folders of sections become section groups. Subpages stay under their page.

Text, headings, lists, to-do tags, tables, pictures, and attached files come over. Other tags become page tags. Ink and other content that Microsoft does not describe in its published format are listed in the review. A password-protected section is skipped; unlock it in OneNote first. To make a package, in OneNote choose File, then Export, then OneNote Package.

Charts and clip art that Word and PowerPoint save as EMF or WMF pictures come over as sharp SVG pictures. If one is damaged, it becomes its description in brackets and the review counts it.

Before anything is added, a review lists what comes over and what does not. Choose Save report to keep that list. Undo takes an import back.

## PDF files

Bring a PDF in to write on it. Each PDF page becomes a picture locked in place, so your ink and typed notes stay where you put them.

- Choose Import PDF as pages on the Home tab, or press Ctrl+K and choose it, to add a page to the open section for each PDF page.
- Choose Insert PDF on the Insert tab to put every PDF page into the open page, one below the other. Ctrl+Z takes them all back.
- The words of each PDF page come with it, so search finds them.
- Choose Add note space to put ruled or blank paper on the right of a PDF page or slide, below it, or both. It works on this page, a range of pages, or every page in the section.
- Choose Make handouts to lay out PDF pages or slides 2 or 3 to a page, with lines beside each one. The handouts are new pages at the end of the section.

Drag across the words of a PDF page to select them, and press Ctrl+C to copy them. To copy all the text of the PDF pages on a page, press Ctrl+K and choose Copy the text of PDF pages.

To highlight, select words on a PDF page and press Ctrl+Shift+H (Ctrl+Alt+H with the OneNote shortcuts). Click a highlight to change its color, remove it, or choose Send to notes, which adds the words as a quote beside the page with a link back to the spot. Press Ctrl+K and choose PDF highlights to see every highlight of the PDF in this section by color and page, and to copy or save them as Markdown.

In the dark theme, PDF pages and slides are dimmed so they are easier on the eyes, and the pictures in them keep their own colors. The Original switch at the top right of the page shows it as it is. Press Ctrl+K and choose Invert PDF pages in the dark theme to turn white pages dark instead. If you chose Always paper white for the page color in Settings, PDF pages stay as they are. Printing and export always use the PDF as it is.

A PDF that is damaged or locked with a password is not opened, and nothing is added. OpenNote reads the PDF on this PC and sends it nowhere.

## Clean up a scan

Take a photo of a page, a whiteboard, or a slide, and OpenNote can tidy it.

- Select the photo on a page, press Ctrl+K, and choose Clean up scan. OpenNote finds the edges of the page, straightens it, and evens out the lighting. Choose Color, Grayscale, or Black and white, and look at the preview before you choose Clean up.
- If the edges are not quite right, choose Adjust the corners, and drag each corner onto a corner of the page. You can also select a corner and move it with the arrow keys, or with Shift and the arrow keys to move farther. The preview follows.
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

## Send to Google Drive or OneDrive

Connect Google or Microsoft in Settings, then Connectors. Press Ctrl+K and choose Send to Google Drive or Send to OneDrive. Choose what to send: what you selected with the lasso, this page, this section, or this notebook. Choose a file type (a PDF, a Word file, or on Google Drive a Google Doc), then walk to a folder and choose Send. Nothing is sent before that last button.

OpenNote remembers which file a page, section, or notebook was sent as. After you change the page, choose Update the Drive or OneDrive copy in Ctrl+K, and OpenNote replaces the file. When you open a page that has changed since you sent it, OpenNote offers once to update the copy. It never updates by itself. A selection can be sent but not updated, because the selection is gone later.

## Send to Dropbox, Box, or a WebDAV server

Connect Dropbox or Box in Settings, then Connectors. For a WebDAV server (Nextcloud, ownCloud, a NAS), choose Connect on the WebDAV card and type the server's address, your user name, and a password (an app password is best). Then press Ctrl+K and choose Send to Dropbox, Send to Box, or Send to a WebDAV server. The steps are the same as for Google Drive: choose what to send, the file type, and the folder.

A name that is already taken is never overwritten. The new file gets a number after its name. Update the copy replaces a file OpenNote sent earlier, and only that one.

To keep every copy current, press Ctrl+K and choose Sync Dropbox, Box, and WebDAV copies. OpenNote sends again each page you changed since it was sent, and each section or notebook copy, over the file that is already there. It runs when you choose it. To have it done for you, choose Keep Dropbox, Box, and WebDAV copies up to date automatically. While OpenNote is open, a few minutes after start and then every 15 minutes, any copy whose page changed is sent again, quietly. Choose Stop keeping Dropbox, Box, and WebDAV copies up to date automatically to turn it off.

iCloud has no sign-in that an app can use. Send a copy to the `iCloud Drive` folder on this PC instead, and iCloud for Windows uploads it.

## Google Docs, Sheets, and Slides

Connect Google in Settings, then Connectors. To bring a file in, press Ctrl+K and choose Import from Google Docs, Sheets, or Slides. Pick the kind of file and then the file. Google turns it into a Word, Excel, or PowerPoint file, and Import notes opens on it so you can see what comes over before anything is added. A Google Sheet becomes pages with tables, and Google Slides becomes a page for each slide that you can write on.

To send a page the other way, choose Export to Google Docs, Export tables to Google Sheets, or Export to Google Slides. These are Send to Google Drive with the type already chosen. Google converts the file as it arrives, so it opens as a Google Doc, Sheet, or Slides file.

## OneNote through your Microsoft account

Connect Microsoft in Settings, then Connectors. Press Ctrl+K and choose Import OneNote notebooks from Microsoft. Choose one notebook or all of them. Each notebook becomes a notebook here, each section a section (sections inside section groups come over with the group's name in front), and each page a page, with subpages kept. Text, headings, lists, to-do boxes, tables, links, and pictures come over.

Some things do not. Ink and handwriting are not given out by Microsoft. Attached files stay in OneNote, and their names are marked in the text. Tables come over as text tables. A page named Import report in the new notebook lists all of it, page by page.

Run the import again at any time. It adds pages that are new and leaves the pages already here alone, because they may hold your own writing. Pages that changed in OneNote since are listed in the report. If you switch to another Microsoft account, its notebooks are kept apart from the first account's.

## Share to OpenNote

In another app, choose Share, then OpenNote. Text, a web link, a picture, or up to 10 files can come over, each file up to 15 MB.

- When a page is open, what you shared goes onto that page, the same way a paste would.
- When no page is open, or the open page is locked or read-only, OpenNote makes a new page in Quick notes in your first notebook.
- Anything OpenNote can't take is left out, and the rest still comes over.

Share to OpenNote is on in Beta builds. Windows only lists OpenNote in the Share window once the app has its package identity. A signed release gets it from its installer. A developer can try it with `packaging/msix/register-dev.ps1`. To save web pages, use the [web clipper](web-clipper.md).

## Not built yet

Share as a file is not finished and has no screen yet. Ink in OneNote files does not come over yet.

Import and export are built. Agents opened each dialog once. Nobody has tried a real import by hand. OneNote files were tested with files made to match Microsoft's published description, not yet with files OneNote saved.
