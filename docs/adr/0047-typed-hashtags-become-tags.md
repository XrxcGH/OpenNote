# ADR 0047: Typed #words become page tags

- Status: Proposed
- Date: 2026-10-21

## Context

People type `#word` to tag a line the way they do in other note apps. The format already reserves `#` at the start of a word (spec section 7.6) and stores a typed `#word` as `\#word`, so the text can never turn into a heading or a later inline syntax. The editor already copied a finished `#word` to the page's `tags` in the same step as the text. That left four gaps: no way to turn it off, a tag only after a space, no rule for code, numbers, `C#`, or web addresses, and no way to keep the plain `#word` (one Undo removed the text and the tag together).

## Decision

We will turn a typed `#word` into one of the page's tags when a space or punctuation ends it, behind a setting, "Turn typed #words into tags", on by default and kept on this device.

- The text does not change in either state of the setting: the `#` is stored escaped. Only `tags` differs, so the file format does not change and old pages load as they were. Spec section 7.6 and Appendix B.5 say so, with a fixture row.
- A tag is not made inside code spans or code blocks, for words of digits only (`#1`), after a letter (`C#`), or inside link destinations and web addresses.
- The tag is its own step in page history, sent right after the text. One Ctrl+Z leaves the plain `#word`; the next Undo removes the text as before.
- The tags pane reads `tags`; search already reads both `tags` and inline `#word` text, and the in-memory index now reads the escaped form too.
- The feature is behind the flag `page.hashtags` (on in Beta, off in Stable until it meets the definition of done).

## Options considered

| Option | For | Against |
|---|---|---|
| Keep the text, add to `tags`, own Undo step (chosen) | No format change; Undo is predictable; tags pane and `tag:` search work | The word is not drawn as a chip |
| An inline tag node in the Markdown | Could be drawn as a chip | A format change: every reader and tool needs it, and old text with `#` changes meaning |
| Tags only from text at search time | Nothing stored | The tags pane and renames cannot see them; the page's own tags would disagree |
| Do nothing | No work | The gaps above stay |

## Consequences

Turning the setting off stops new tags but does not remove tags already added; they are ordinary page tags the person can remove in Manage tags. Revisit if people want a chip look, which needs a format change and a new ADR.
