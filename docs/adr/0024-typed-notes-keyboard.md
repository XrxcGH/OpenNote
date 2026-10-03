# ADR 0024: The keyboard model for typed notes

- Status: Proposed, pending the owner's confirmation of the OneNote set's editor keys
- Date: 2026-10-02

## Context

BRAND.md section 12 requires that everything works without a mouse, that focus is visible, and that shortcuts are listed and changeable. Web Content Accessibility Guidelines (WCAG) 2.1.2 forbids keyboard traps unless the way out is standard and stated. Phase 2 built one command registry with scopes, layout-aware chord matching, and a promise that defaults avoid Ctrl+Alt, because Ctrl+Alt is AltGr on many European keyboards. FEATURES.md adds a OneNote shortcut set that keeps OneNote's meaning where the sets clash. The reviews found three problems in the candidates:

- Tab moving focus out of a plain paragraph surprises people coming from OneNote and Word, where Tab indents.
- Ctrl+Alt letter and digit defaults capture AltGr characters: Polish "ć" (AltGr+C), and German "²" and "³" (AltGr+2 and 3).
- Reassigning Ctrl+= and Ctrl+- inside the page removes a text-size tool that low-vision people use.

## Decision

We will use this keyboard model (ARCHITECTURE.md section 22):

1. **Tab stays inside an editor.** It indents list items, turns a plain paragraph at its start into a list item, moves between table cells, indents code, and otherwise inserts a tab character. **Escape** leaves the editor and selects the block as an object; Tab and Shift+Tab then move between blocks in reading order, and Enter or F2 edits again. Every editor's accessible description says "Press Escape, then Tab, to leave the text box.", and the shortcut list says the same. F6 moves between regions.
2. **AltGr text always wins.** While AltGr is active, a Ctrl+Alt chord matches only when `event.key` is the chord's own key. An `event.key` match beats an `event.code` match. The default set has no Ctrl+Alt letter keys.
3. **Every command in both sets.** Each Phase 4 command has a key in the default set and in the OneNote set, or in neither. The OneNote set keeps OneNote's keys, including Ctrl+Alt+H, R, and E, and inside editors only, Ctrl+= (subscript), Ctrl+- (strikethrough), and Ctrl+/ (numbered list).
4. **Text size stays on Ctrl+=, Ctrl+-, and Ctrl+0 in the default set, everywhere.** Page zoom uses Ctrl+Alt+=, Ctrl+Alt+-, Ctrl+Alt+0, Ctrl+wheel over the page, and pinch.
5. Arrow keys stay inside a floating text box; they cross only between flowing blocks.

## Options considered

| Option | For | Against |
|---|---|---|
| Tab stays in the editor, Escape leaves (chosen) | OneNote and Word habits; indentation by keyboard; WCAG 2.1.2 met by a stated standard exit | Keyboard users must learn Escape, then Tab; the hint and the shortcut list teach it |
| Tab moves to the next block, as in form fields | No trap at all | Surprises switchers; indentation needs other keys |
| Tab after text makes a table (OneNote's Tab-to-table) | Exact OneNote behavior | An unwanted automatic change for most people; left out |
| Ctrl+Alt+0 for Normal text | Word-like | Clashes with page zoom 100% |
| Subscript and superscript on Ctrl+= in the default set | Word and OneNote habit | Removes text size inside the page for low-vision users |
| A Ctrl+Alt chord matches under AltGr whenever it names Alt (Phase 2's rule as written) | Simple | Polish, German, and French keyboards lose characters |

## Consequences

- Easier: switchers keep their habits; European keyboards keep every character; the conflict test and recorded layout fixtures catch regressions.
- Harder: some layouts lose some Ctrl+Alt shortcuts (Heading 2 and 3 on German keyboards, for example), which stay in menus, the slash menu, Markdown shortcuts, and the palette, and can be rebound. Phase 2's dispatcher needs the AltGr and exact-key rules (P2-3) and shortcut sets (P2-4).
- Follow-up work: layout fixtures recorded in spike S7; the fixed-keys table in the shortcut list; the manual checks with Polish, German, and French layouts.
- Revisit if screen reader users report that the Escape exit isn't discoverable, or if Phase 2's shortcut sets take another shape. The Phase 4 owner and the accessibility reviewer check at each beta.
