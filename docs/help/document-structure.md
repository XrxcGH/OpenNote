# Document structure

Number your equations and refer to them, gather a formula sheet, practice a worked problem, start from a problem-set template, and save a graph as a captioned figure.

## Number equations and refer to them

1. Put the caret on a display equation (the kind written between `$$` lines).
2. Press Ctrl+K and choose **Number this equation**, or choose it from the Insert tab. The equation gets a number at its right edge.
3. To number every display equation on the page, choose **Number all equations**. **Remove equation number** takes one off.
4. To refer to a numbered equation, put the caret in your text, press Ctrl+K, and choose **Insert equation reference** (it is also in the Insert tab and the slash menu). Pick the equation. The reference shows its number, such as (2).

Numbers follow the order of the equations on the page, so moving an equation renumbers the rest and every reference follows. Click a reference to jump to its equation. A reference to an equation that no longer exists shows (??).

Under the surface, a numbered equation holds `\label{name}` in its source, and a reference is the inline equation `\eqref{name}`. You can type them by hand.

PDF, HTML, Markdown, and Word exports write the numbers in: the equation gets `\tag{n}` and each reference becomes the text "(n)".

## Formula sheet

Open the command palette (Ctrl+K) and choose **Open formula sheet builder**. Pick where to take equations from: this page, the pages you selected in the page list (Ctrl-click to select several), or every page in the section. Choose a number of columns, or leave it on Automatic. **Build the sheet** makes a new page with the equations, grouped by the heading they sat under, laid out in columns so that they fit one sheet. Equations that appear twice are listed once. If more than 64 equations are found, the ones that do not fit are left off and you are told how many.

Turn on **Write the sheet in my handwriting** to turn the new page into your own writing. It needs My handwriting to be set up in Settings first.

## Practice mode

Open **Practice this problem** from the command palette on a page that holds a worked problem. Put the steps under a heading called Solution, as a numbered list, and an Answer heading after them. Everything before the Solution heading is the problem.

The steps start hidden. Press Space or Right Arrow to show the next one, Left Arrow to hide the last one, and Home to start over. After the last step, one more press shows the answer. The buttons do the same. Reading the page again, or showing another page, hides everything again.

## Problem-set templates

**New page from template** lists three templates that come with OpenNote, before your own:

- **Problem set**: for each problem, Given, Find, Solution (a numbered list), and Answer.
- **Cornell notes**: cues and questions, notes, and a summary.
- **Lab report**: purpose, hypothesis, materials, procedure, data, analysis, uncertainty, conclusion, and references.

## Export a figure

Open **Export figure as a picture** from the command palette. It lists the graphs and diagrams on the page. Choose one, give it a number and a caption, and optionally a source line. The caption is written under the picture as "Figure 3. Your caption". Save it as an SVG, which stays sharp at any size, or as a PNG at 72, 150, 300, or 600 DPI. The PNG says what its DPI is, so Word and other programs place it at the right size.
