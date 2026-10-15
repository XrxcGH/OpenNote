# Study tools

Make flashcards from your notes, plan what is due, and keep small tools one click away.

![The Upcoming window listing tasks and due dates](../screens/tool-upcoming-light.png)

## Flashcards

Open Insert, then Flashcards. A page can hold several decks.

- Card types are question and answer, fill in the blank, multiple choice, and image occlusion, which hides part of a diagram.
- Type `Q :: A` on a line to make a card in place. Type `{{blank}}` in a sentence for a fill-in-the-blank card.
- Review cards in the review screen. A schedule shows which cards are due.
- Set an exam date for a deck and the schedule works back from it.
- Import and export Anki decks (`.apkg`) and CSV files.

Open a deck and press Quiz, or insert a quiz block, to be asked a random set of the deck's cards. Type each answer and check it. If the check missed a good answer, press "I had it right". The end tells you how many were right and lists the cards to look at again. A quiz does not change when cards come back for review, and it keeps no score history.

Study tape covers part of a page. Press it to show what is under it.
To make a worksheet, turn on Turn study tape into blanks in the Print or PDF dialog, or from the command palette. What the tape covers then prints as blanks, and an answer key follows at the end. This applies to print, PDF, pictures, Markdown, and web pages. A tape is matched to the text and pictures that lie mostly under it.

## Make cards from a section or a transcript

Open the menu on a section in the notebook tree, or press Ctrl+K and choose "Make flashcards from this section", to turn its pages into cards. On a transcript, press Make cards. You see the cards before they are added.

## Upcoming

The Upcoming window lists exams, classes, and tasks, from every notebook you have open. Locked sections are left out. It has Day, Week, and Month views you can move around with the arrow keys. Check an item off and a checkbox line on the page is checked too. Press an item to go to it.

- Import a calendar (.ics) file to fill in your classes.
- Put a due date on a checkbox, and repeat it if you need to. Type phrases such as "every weekday", "every 2 weeks", or "monthly on the 1st". When you check a repeating line on a page, the next one appears.
- Set a reminder on any item, page lines included, and Windows shows a notification.
- An exam can belong to a notebook or a section.
- A class can be linked to a section. "Open class" makes a dated page from the class template. Record sits beside it, and recording never starts by itself.

## Small tools

Press Ctrl+K and choose one by name. Each opens in its own window, which remembers its size, its place, and its monitor. Choose Reset tool windows to put them all back. You can give each tool its own shortcut in Settings, under Keyboard shortcuts.

| Tool | What it does |
|---|---|
| Timers | Countdowns that keep running while you write. A running timer shows in the title bar, and you can ask each timer to notify you when it finishes, even with the window closed. |
| Calculator | Works out sums and unit conversions, and keeps a history. |
| Unit converter | Converts length, mass, time, temperature, area, volume, speed, pressure, energy, power, angle, and data size. |
| Reference tables | Looks up the periodic table (with group, period, and electron configuration for each element), constants, metric prefixes, and Greek letters. |
| Exam countdown | Counts the days to each exam. |
| Citations | Keeps a list of sources from BibTeX, RIS, and Zotero, and inserts citations that follow your chosen style (APA, MLA, Chicago, Vancouver, ACS, AMA, Turabian, and more), so changing the style updates them. A DOI or ISBN look-up happens only when you ask, and is listed in the Privacy panel. With Zotero running, it also adds, edits, and refreshes Zotero citations and bibliographies in the page. |
| Dictionary and thesaurus | Meanings, synonyms, and examples, offline. Select a word and press the shortcut, or type in the window. Insert synonym replaces the selected word. Other languages are optional downloads. |

![The timers window with a countdown running](../screens/tool-timer-light.png)

## Math across a page

Define a variable such as rent = 1,200 in one text box and use it in another on the same page. Text that handwriting recognition adds to the page works the same way.

Study tools are built. Agents opened the tool windows once. Nobody has tried the rest by hand.

## Citing with Zotero

Open Zotero 7 or later first (its setting to allow other applications to communicate with it stays on). In Citations, under Zotero in the page, choose Add or edit citation. Zotero shows its own window to pick the source and the style, and OpenNote puts the citation where the caret is. To change a citation, put the caret inside it and choose the same button. Add or edit bibliography puts the list of sources in the page, and Refresh brings every citation and the bibliography up to date after you change a source or the style. Unlink keeps the text and removes the link to Zotero. The same commands are in the command palette.

Zotero works with one text block at a time: the citations and the bibliography it updates must be in the block that has the caret. If Zotero is not running, OpenNote says so without changing anything.
