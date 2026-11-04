# ADR 0085: The default shortcut set follows Word, with a Google Docs preset beside the OneNote set

- Status: Proposed
- Date: 2026-11-01

## Context

The default set has Ctrl+E for inline code, Ctrl+Shift+S for strikethrough, and Ctrl+Enter for checking a task. It has no keys for alignment, line spacing, indents, subscript and superscript, clearing character formatting, the format painter, or changing the size by 1 point. Word and Docs disagree in places: Ctrl+[ and Ctrl+] change the font size in Word and the indent in Docs. People coming from either app expect their own keys.

## Decision

- The default set follows Word for Windows. Docs keys are added where they do not collide.
- A new **Google Docs** preset (`KeymapPresetId` gains `docs`) follows Docs exactly, as the OneNote set follows OneNote.
- The default changes:
  - Ctrl+E centers, and inline code moves to Ctrl+`.
  - Ctrl+Shift+S applies a style by name, and strikethrough moves to Alt+Shift+5 (Docs).
  - Ctrl+[ and Ctrl+] change the size by 1 point in the editor scope. Object order keeps them in the `pageObject` scope.
  - Ctrl+Space clears character formatting.
  - Ctrl+Enter inserts a page break on paginated pages outside task items. In a task item it still toggles the check.
  - Ctrl+= and Ctrl+Shift+= apply subscript and superscript.
- The OneNote set keeps its meanings.
- macOS maps Ctrl to Cmd and follows Word for Mac and Docs for Mac where they differ. For example, Docs on macOS uses Cmd+Shift+X for strikethrough.
- A table-driven test lists every Word and Docs formatting shortcut and checks the command it runs in each set. The existing conflict test must still pass.

## Options considered

| Option | For | Against |
|---|---|---|
| Word defaults, Docs preset (chosen) | Matches the most common app; Docs users get their keys with one switch | Moves two built keys (code and strikethrough) |
| Docs defaults, Word preset | Docs is popular with students | Word is the reference for printed documents and DOCX |
| Keep today's keys and add only free ones | No change for current users | Ctrl+E and Ctrl+Shift+S would never match either app |

## Consequences

The release notes and the shortcuts help page say which keys moved. `app/src/features/page/keys.ts` gains a `keys/text.ts` part, so one lane owns the text keys. This is PLAN.md owner decision 3.
