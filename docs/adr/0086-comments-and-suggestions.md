# ADR 0086: Comments and suggestions are stored in the page, anchored by inline tags, with local author names

- Status: Proposed
- Date: 2026-11-01

## Context

Word, Docs, and Pages have comments on text ranges and tracked changes (Docs calls them suggestions). DOCX files that classmates and colleagues send carry both. OpenNote has neither, and it has no shared accounts: notebooks sync as files.

## Decision

- A comment's range is a `<span data-comment="ID">` tag in the Markdown. Its record is `data.comments[ID]`: author, time, Markdown text, replies, and resolved state.
- Suggestions are `<span data-ins="ID">`, `<span data-del="ID">`, and `<span data-fmt="ID">` tags, with records in `data.suggestions`. A record holds the kind, author, and time, and for a format change the marks it had before.
- Suggesting mode turns typing into insertion marks and deletion into deletion marks. Accept and reject are commands, each one undo step.
- The author is the display name in settings, never an account ID. DOCX export can replace author names and times ("Remove personal information").
- Pages that use these tags are version 2 (ADR 0078).

## Options considered

| Option                                               | For                                                                                                 | Against                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Inline anchor tags, records in `data` (chosen)       | Ranges move with their text in every edit; merge and history need nothing new; DOCX maps one to one | Version 1 apps open such pages read-only                                    |
| Anchors as text-quote selectors (W3C Web Annotation) | Markdown untouched                                                                                  | Anchors break when the quoted text changes; needs fuzzy re-anchoring        |
| A separate comments file per page                    | Keeps `page.json` small                                                                             | A second file to sync and conflict; breaks the rule that a page is one file |

## Consequences

The schema gains the comment and suggestion marks. A Review tab and a comments pane come with them, and the compare view shows suggestions. Mentions and assignments are out of scope.

## Implementation notes (review, Beta 12)

- **Records.** `data.comments[ID]` is `{author, time, markdown, replies: [{author, time, markdown}], resolved}` (`R-CMT-1`). `data.suggestions[ID]` is `{kind, author, time}`, plus `before` for a format change: the canonical inline Markdown of the range before the change (`R-SUG-1`). Times are in Coordinated Universal Time (UTC), with milliseconds.
- **One undo step.** A mark and its record change together. The review model is a text rider, as in ADR 0087. It sends the record of each new mark in the same batch as the block's new Markdown. A command or suggesting mode stages that record first. It drops the records of marks that left the block (`R-CMT-2`, `R-SUG-2`) and brings them back on undo or paste. A comment's text, its replies, and its resolved state change the record alone, in a `patchBlock` batch of their own.
- **Suggesting mode** (Track changes, Ctrl+Shift+E, Word's chord) is per window and starts off. Typed text gets an insertion mark, and typing next to one's own insertion joins it. Deleted text comes back with a deletion mark; Backspace leaves the caret before it. Deleting one's own insertion just removes it. A formatting command puts a formatChange mark over each paragraph's changed text. Paragraph splits and joins and paragraph formatting are not tracked yet. Code blocks take no marks, so edits there are plain.
- **Accept and reject.** At the caret (the changes the selection touches, then the caret moves to the next one), all on the page, or all by one author. Rejecting a format change puts the old Markdown back when the text is unchanged; otherwise it only drops the mark. Each block's change is one undo step.
- **Markup views.** All shows every mark. Simple shows the text with the changes made and a quiet bar at each insertion. None also hides comment highlights. The choice is kept on this device. Under forced colors the marks keep a dashed underline in `Highlight`.
- **Comments.** New comment covers the selection, or the word at the caret. The comments pane lists the page's comments in reading order with the quoted text, author, time, text, and replies; it posts, replies, resolves, reopens, deletes, and goes to the text. Next and Previous comment go around the page. Resolved comments lose their highlight. Word's Ctrl+Alt+M is taken by the Markdown source view, so New comment has no default key.
- **Author.** The name new comments and suggestions carry is typed in the comments pane and kept on this device. It defaults to "Author". It is never an account ID. A settings key for it is left to the settings owner.
- **Screen readers.** The caret entering a suggestion speaks "Insertion by Sam" (or Deletion, or Format change).
- **Compare.** A paragraph can keep its text and change its Markdown. Then the compare view shows "Formatting changed:" with each mark added, removed, or changed, and the text it covers. `paras` compare key by key, so an alignment change alone shows "alignment: center".
