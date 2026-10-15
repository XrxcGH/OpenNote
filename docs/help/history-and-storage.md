# History, Trash, and storage

OpenNote keeps every notebook as an ordinary folder in your notes folder. This guide covers page history, Trash, where your notes live, locked entries, and how to check a notebook.

## Page history

OpenNote saves versions of a page while you work. Open a page's History panel to compare two versions or restore part of one.

### How long history is kept

Open Settings, then Editing, and choose how long history keeps versions: 30 days, 1 year, or forever. One year is the default. The choice applies at once. Versions older than the choice are removed page by page, each time a page is tidied after you close it. Named versions and the newest version of each page are always kept.

### Delete history

To clear old versions, open the page's History panel and choose Delete history. The same command is in a section's or a notebook's menu and in the command palette, where it acts on the open page's section or notebook. Choose whether to keep the versions you named. The page itself is not changed.

## Trash

Deleted pages, sections, and notebooks wait in Trash until you restore them.

- To bring one back, choose Restore.
- To remove one for good, choose Delete forever on it, or Empty Trash to remove everything. Both ask first. Removing an item also removes its history, its search entries, and its recording transcripts. This cannot be undone.
- A notebook in Trash keeps its folder on disk. Choose Delete folder on it to remove the folder. The folder goes to the Windows Recycle Bin, so you can still get it back from there until the Recycle Bin is emptied.

## Where your notes live

Open Settings, then Storage, to see the notes folder. Choose Change notes folder to pick another one. You can move your notebooks there (OpenNote checks each copy before it removes the old one, and a cancel leaves everything where it was), or use the notebooks already in the folder you picked.

When you rename a notebook, its folder is renamed to match. Turn off Rename folders with notebooks in Settings, then Storage, to keep folder names as they are.

## Edits from other apps, and files in the cloud

If you edit a page's `page.md` in another program, OpenNote shows a notice on the page. Choose Bring in the text changes to see a preview and apply them as one change you can undo, or discard the copy. A page's menu has Open in another editor.

If your notes folder is in a cloud service that keeps some files online only, OpenNote tells you before opening a page whose files are not on this computer yet, and shows download progress or a warning.

## Check a notebook

Choose Check notebook in a notebook's menu, in the command palette, or in Settings, then Storage. It looks for damaged files, missing images and recordings, links that lead to a page or file that isn't there, and pages whose `page.md` doesn't match the page. Nothing changes until you pick a repair:

- Restore from page history puts back a damaged page from the newest version in its history that reads.
- Restore from the newest backup puts back a damaged or missing file from your newest scheduled backup.
- Write page.md again writes the page's readable copy afresh. If someone edited it in another app, that copy is kept aside first.
- Open the page takes you to a page with a broken link, so you can fix the link.

Each repair has Undo in the same window, until you close OpenNote. If OpenNote closed unexpectedly, the next start shows a short note with a Check notebook button.

## Lock an entry

For lab notebooks and records, Lock entry makes a page read-only and stamps it with the date, the time from this PC's clock, and this PC's name in OpenNote. Choose Lock entry in the command palette, or on the page itself when it uses the Lab notebook layout. OpenNote asks first.

A locked page shows its stamp above the page. To change it again, choose Unlock entry, and say why. The reason is kept in page history as the name of the locked version, and that version is never removed when history is thinned.

The lock only stops edits in OpenNote. It isn't tamper-proof: anyone with access to the files can change them, and the PC's clock can be wrong.

## Protect a section with a password

A protected section is encrypted in your notes folder. Its pages open only after you unlock it, with its password or with Windows Hello. To protect one, right-click the section and choose Protect with password. Pick a password of at least 8 characters. If you forget it, nobody can open the section, not even OpenNote.

A locked section shows a closed lock and its title, but none of its pages. Choose it and select Unlock section. You can also turn on Unlock with Windows Hello for a section while it is unlocked. Pages of a protected section stay out of search, recent pages, readable copies (`page.md`), and page history. Their lines don't become flashcards or Upcoming items either.

Protected sections lock again on their own:

- When Windows locks or the PC sleeps, and when OpenNote closes.
- After a time without use, which you set in Settings, then Storage, under Protected sections.
- When you leave the section, unless you turn that off there.

While a section is unlocked, OpenNote keeps its newest changes in memory and seals them when the page saves. If OpenNote or the PC crashes first, those changes are lost, and OpenNote can't warn you, so lock the section when you finish.

Pages can't move into or out of a protected section, and they skip the Trash. Deleting one deletes it for good, after a warning. Recordings aren't available in protected sections yet. Remove protection writes the pages back as plain files.

Backups made after you protect a section hold it encrypted. Backups made before still hold its pages in plain text. The drive may also keep old copies of the removed plain files for a while.
