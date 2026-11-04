# ADR 0078: Writers stamp the lowest format version a file needs

- Status: Proposed
- Date: 2026-11-01

## Context

Spec 15.3 says a file is written in the new version whenever an edit saves it. Text formatting adds two kinds of data:

- Inline tags, which a version 1 reader would corrupt, so it must not edit them.
- Keys beside the Markdown: `paras`, `lists`, `layout`, a page's `styles`, `view.text`, and new style keys. A version 1 reader already keeps these unchanged (spec 2.9), and element IDs keep them attached to their paragraphs (spec 6.6).

People sync one notebook across devices that update at different times. If every save stamps version 2, a phone on Beta 8 can no longer edit any page the laptop touched, even pages that only gained a centered paragraph.

## Decision

We will stamp each file with the lowest format version whose features it uses, and change spec 15.3 and 15.5 to say so.

- Each version's section of the spec lists the features that require it. For version 2, those are inline tags beyond version 1, `[^id]` footnote references, `data.notes`, comments, suggestions, and `break` blocks.
- Keys that a version 1 reader keeps without misreading do not raise the version.
- The core computes the stamp at save time from the page's contents, and fixtures test both outcomes.
- The backup before the first upgrade (spec 15.4) runs when a file first needs the higher version.

## Options considered

| Option | For | Against |
|---|---|---|
| Stamp the lowest version needed (chosen) | Older devices keep editing pages that use only additive keys; paragraph formatting and styles never lock anyone out | The writer must know which features need which version; a page can move up and down as features are added and removed |
| Always stamp the newest version (spec 15.3 today) | Simple | Locks older devices out after any edit |
| Never raise the version for formatting | Old devices edit everything | Old devices would corrupt inline tags |

## Consequences

A page can go back to version 1 when its last version 2 feature is removed. That is safe, because version 1 readers already accept every remaining key. The rule also applies to features from other designers in the same release, such as tables, so the format change is one bundle with one owner (PLAN.md owner decision 2).
