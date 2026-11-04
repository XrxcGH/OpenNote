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

| Option | For | Against |
|---|---|---|
| Inline anchor tags, records in `data` (chosen) | Ranges move with their text in every edit; merge and history need nothing new; DOCX maps one to one | Version 1 apps open such pages read-only |
| Anchors as text-quote selectors (W3C Web Annotation) | Markdown untouched | Anchors break when the quoted text changes; needs fuzzy re-anchoring |
| A separate comments file per page | Keeps `page.json` small | A second file to sync and conflict; breaks the rule that a page is one file |

## Consequences

The schema gains the comment and suggestion marks. A Review tab and a comments pane come with them, and the compare view shows suggestions. Mentions and assignments are out of scope.
