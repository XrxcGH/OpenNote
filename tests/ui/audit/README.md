# Layout audit

`npm run audit:layout` walks the whole app on the web build and measures what is on screen. It looks for these:

- text that is clipped or spills out of its box;
- overlapping text and controls, and boxes cut by an ancestor;
- scroll bars covered by another box;
- menus and windows that leave the window;
- targets that are too small or too close;
- the document itself scrolling;
- dead space: an empty box of 32 px or more in a window, panel, card, or dialog that also cuts its content off or scrolls.

## What it visits

The surfaces come from the code, not from a list kept here (`app/src/app/auditHooks.ts`, built only in test mode):

- first-run setup, walked with Continue, and every settings section;
- the workspace, every command bar tab, the palette, the tree, page, and slash menus;
- every tool window in `TOOLS`, and every tab inside it, docked beside a page long enough to scroll;
- every page block a slash item or command inserts, each on a page of its own;
- in three cells, every command that is safe to run, and whatever dialog, panel, or menu it opens.

A new tool, command, settings section, setup step, or slash item is therefore audited the day it is registered.

## The matrix

Sizes 1280x800, 820x620, and 2560x1600 (device scale factor 2 in screenshots), light and dark, and mouse and touch
density: 12 cells, one test each (`layout.audit.spec.ts`).

## The ratchet

`ratchet.spec.ts` merges the cells' findings and compares them with `known.json`. A finding not in the list fails the
run, and so does a listed finding that no longer occurs, so a fix shrinks the list and nothing new gets in. A finding
is `surface | kind | selector`, where the surface is the tool, or the first word of the others (`settings`, `command`, `block`). To accept the current findings after a deliberate change, run with
`OPENNOTE_AUDIT_UPDATE=1`, and say why in the commit.

## Looking at the results

- `OPENNOTE_AUDIT_OUT=<folder>` keeps the per-cell results and `findings.json` (surface, kind, selector, what was
  measured, the cells, the screenshot) outside the repository. The default is `tests/ui/audit/out/`.
- `OPENNOTE_AUDIT_SHOTS=<folder>` saves a screenshot per surface, theme, and size, named
  `<surface>-<theme>-<size>.png` (touch density adds `-touch` and is saved only when it finds something).
- `OPENNOTE_AUDIT_TRACE=1` prints each surface as it is measured.
- Run one cell with `-g "w1280 light mouse"`. The ratchet then skips the staleness check, because a cell that did not
  run cannot show that a finding is gone.
