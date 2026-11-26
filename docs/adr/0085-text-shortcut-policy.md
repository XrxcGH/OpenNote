# ADR 0085: The default shortcut set follows Word, with a Google Docs preset beside the OneNote set

- Status: Accepted
- Date: 2026-11-01

## Context

The default set has Ctrl+E for inline code, Ctrl+Shift+S for strikethrough, and Ctrl+Enter for checking a task. It has no keys for alignment, line spacing, indents, subscript and superscript, clearing character formatting, the format painter, or changing the size by 1 point. Word and Docs disagree in places: Ctrl+[ and Ctrl+] change the font size in Word and the indent in Docs. People coming from either app expect their own keys.

## Decision

- The default set follows Word for Windows. Docs keys are added where they do not collide.
- A new **Google Docs** preset (`KeymapPresetId` gains `docs`) follows Docs, as the OneNote set follows OneNote. A key lists its chords per set, so a set never inherits a chord that means something else there.
- The default changes:
  - Ctrl+E centers, and inline code moves to Ctrl+`.
  - Ctrl+Shift+S applies a style by name, and strikethrough moves to Ctrl+Shift+X (Word and Docs on a Mac). The Docs set also has Alt+Shift+5. The default set does not, because Alt+Shift+5 shows outline level 5 there.
  - Ctrl+[ and Ctrl+] change the size by 1 point in the editor scope. Object order keeps them in the `pageObject` scope. In the Docs set they indent and outdent.
  - Ctrl+Space clears character formatting.
  - Ctrl+Enter inserts a page break on a paginated page outside task items. In a task item it still toggles the check. `insert.pageBreak` is in the `page` scope and `block.toggleCheck` refines it, so the check wins when it applies and the key then falls through.
  - Ctrl+= and Ctrl++ apply subscript and superscript. The Docs set also has Ctrl+. for superscript. Docs' Ctrl+, stays Settings.
  - Ctrl+> and Ctrl+< step the size on Word's list while `text.v2Controls` is on, and by the four named sizes otherwise.
  - Also from Word: Ctrl+L, Ctrl+R, Ctrl+J, and Ctrl+Shift+J (distribute).
  - Line spacing on Ctrl+1, Ctrl+2, and Ctrl+5. Indent on Ctrl+M, outdent on Ctrl+Shift+M.
  - Hanging indent on Ctrl+T, reset paragraph on Ctrl+Q.
  - Caps on Ctrl+Shift+A and Ctrl+Shift+K, change case on Shift+F3, repeat on F4.
  - Copy formatting on Ctrl+Shift+C, and bullets on Ctrl+Shift+L.
- Some Word keys stay unbound, because OpenNote already uses them.
  - Ctrl+0 resets the interface text size.
  - Ctrl+Shift+T reopens a closed tab.
  - Ctrl+Shift+V pastes as plain text, a fixed key.
  - Pasting a format is Ctrl+Alt+Shift+V in every set, because Ctrl+Alt+V is dictation.
- Ctrl+T hanging indent takes the key from New section while the caret is in text. The command and the palette still make a section.
- The OneNote set keeps its meanings: Ctrl+E searches, Ctrl+1 to Ctrl+9 tag, and Ctrl+Enter checks. It has Ctrl+L and Ctrl+R, which OneNote shares.
- macOS maps Ctrl to Cmd. Cmd+M and Cmd+Q belong to the system menus there, so indent and reset paragraph have no key on a Mac, and Tab and Shift+Tab indent in a list.
- Ctrl+Shift+C and Ctrl+Shift+X reach commands from a text field (they edit nothing there); Ctrl+A, C, V, X, Y, Z keep their editing meaning.
- A table-driven test (`commands/textShortcuts.test.ts`) reads `commands/fixtures/textShortcuts.json`, which lists the documented Word and Docs shortcuts with their sources, and checks the command each runs in its set. The conflict test runs in all three sets.
- Every text key's command is registered behind `text.v2Controls`. The page break and the style box are seams (`features/page/textSeams.ts`): the page layout and the styles gallery set their handlers, and until they do the keys pass on.

## Options considered

| Option                                   | For                                                                    | Against                                              |
| ---------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| Word defaults, Docs preset (chosen)      | Matches the most common app; Docs users get their keys with one switch | Moves two built keys (code and strikethrough)        |
| Docs defaults, Word preset               | Docs is popular with students                                          | Word is the reference for printed documents and DOCX |
| Keep today's keys and add only free ones | No change for current users                                            | Ctrl+E and Ctrl+Shift+S would never match either app |

## Consequences

The release notes and the shortcuts help page say which keys moved. `app/src/features/page/keys.ts` gains a `keys/text.ts` part, so one lane owns the text keys. This is PLAN.md owner decision 3. Settings, Shortcuts offers the Google Docs set.
