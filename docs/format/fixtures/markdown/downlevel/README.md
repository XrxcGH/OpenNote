# Stamps and older readers

`cases.json` holds pages of format versions 1, 2, and 3. Each case has these keys:

| Key | Meaning |
|---|---|
| `name`, `rules` | What the case shows, and the rule IDs it tests |
| `page` | The `page.json` |
| `stamp` | The version keys a writer of version 2 gives the page when it saves it (spec 15.6). A file of a later version keeps its keys (spec 15.2) |
| `readers` | What readers of versions 1 and 2 do with the page as it is: `edit`, `readOnly`, or `pageMd` (spec 15.2) |
| `upgrades` | `true` when saving the page first gives it a higher `formatVersion`, so the backup of spec 15.4 runs |
| `problems` | Values a reader must find invalid. Without this key, the page has none |

The cases pin every row of the stamping table, including the ones for spreadsheet data and code blocks.
