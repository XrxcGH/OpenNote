# Text formatting: NVDA and Narrator checklist

A person runs this checklist before each beta that changes text formatting, on Windows 11 with a mouse put away. The automated runs cover what they can: `npm run test:e2e:text` (axe over the Home tab, the Format pane, the font picker, the ruler, the notes area, the comment and suggestion marks, and the Header and footer dialog, and the forced-colors check), `npm run perf:typing` (the formatted 20-page note, with and without footnotes, comments, and suggestions), and the component tests of each control. The nightly run sets `OPENNOTE_TYPING_GATE=1` on `perf:typing`, so the formatted note fails the night at a painted p95 over 16 ms. The export-then-import flow is tested in `crates/interop/tests/word_round_trip.rs`. A native tauri-driver spec that drives it through the window is deferred to a later release. This list covers what needs a person and a real screen reader. File an issue for every item that fails, and record each run in the table at the end.

Turn the text flags on first (Settings, Experimental), or use a build where they are on.

## Home tab, with Narrator and with NVDA

- [ ] Tab into the Home tab. Each control says its name, its role, and its state: "Bold, toggle button, pressed" when the selection is bold.
- [ ] The Font box says "Font, combo box" and the current typeface. Arrow Down opens the list and says each typeface. Enter chooses one and the selection changes.
- [ ] The size box says its value. Type 14 and press Enter, and the screen reader says the new size.
- [ ] The Styles gallery says each style's name and its look, such as "Heading 2: 16 point, bold".
- [ ] Underline, Strikethrough, Highlight, and Text color say their menu state. The color grid says each color's name, not a hex number.
- [ ] Escape closes a menu and returns focus to the button that opened it.

## Format pane

- [ ] Ctrl+D opens the pane and focus lands on the selected tab. The pane is announced as "Format".
- [ ] Left and Right Arrow move between the tabs. Each tab panel is named for its tab.
- [ ] Every field says its label and unit ("Left indent, edit, 0 points"). A bad value is announced with the reason.
- [ ] Reveal formatting reads where each format comes from ("Bold, set directly").
- [ ] Close returns focus to the text.

## Ruler

- [ ] View, Ruler shows the ruler, and says "Ruler shown."
- [ ] The indent markers and tab stops are reachable by keyboard, and each says its position in the chosen unit.
- [ ] Moving a marker with the arrow keys says the new value.

## Find with format, language, and direction

- [ ] Ctrl+F opens Find on page. The Format button opens the Find format group, and each switch says whether it is on.
- [ ] A format criterion with no match says that nothing was found.
- [ ] Review, Language opens a menu named for the selection or the paragraph. Arrow keys move through the languages and each is read by name.
- [ ] Choosing a language says "Language set to" and the name. Do not check spelling says whether it is on or off.
- [ ] Right-to-left text direction on a paragraph makes the caret and the arrow keys follow the new direction.

## Symbol dialog and Alt+X

- [ ] Insert, Symbol opens a dialog named Symbol. Focus lands in the search box.
- [ ] The symbol grid is a list. Arrow keys move through it and each symbol is read by name and code (for example "euro sign, U+20AC").
- [ ] Choosing a symbol says which one is chosen. Insert is off until one is chosen, and it puts the character at the caret.
- [ ] Alt+X turns the hex code before the caret into its character, and turns a selected character back into its code.
- [ ] With a high contrast theme on, the grid, the chosen symbol, and the focus outline are all visible.

## Footnotes, comments, and suggestions

- [ ] A footnote reference reads as its number and name, such as "Footnote 3". Activating it moves to the note, and the number in the notes area moves back to the reference.
- [ ] The notes area is named "Notes". Each note is read with its number and its text, and a note with no text says so.
- [ ] Review, Show comments opens the Comments pane. Each comment is read with its author, its text, and whether it is resolved. Reply, Resolve, and Delete are reachable by keyboard.
- [ ] A suggested insertion or deletion is announced as such when the caret enters it, and Accept and Reject say how many changes they decided.
- [ ] Layout, Header and footer opens a dialog named "Header, footer, and page numbers". Each field says its label, and the number format list reads each choice.

## Text in the page

- [ ] Browse mode reads a formatted note in order. Headings, lists, and links are found by their quick keys.
- [ ] Bold, italic, and underline are not announced on every word, but are announced when the caret enters formatted text, if the screen reader's setting for font attributes is on.
- [ ] A paragraph with a border or shading reads the same as one without.
- [ ] A numbered list in a custom format (letters, Roman numerals) reads its numbers.

## Forced colors and high contrast

- [ ] Turn on a high contrast theme. Every control on the Home tab, the Format pane, and the ruler is readable and has a visible focus outline.
- [ ] A formatted note keeps its text readable: colored text, shaded paragraphs, and highlights give way to system colors, and no text disappears into its background.
- [ ] Underline styles and strikethrough still show.

## Runs

| Date | Build | Screen reader and version | Person | Result |
| ---- | ----- | ------------------------- | ------ | ------ |
