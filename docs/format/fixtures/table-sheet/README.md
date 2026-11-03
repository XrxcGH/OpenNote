# Spreadsheet data

Each file holds one case for `data.sheet` (spec 6.3): one for each key, one for every style key, and a page that version 2 wrote (`beta8-before.json`) and that Beta 8 then edited (`beta8-after.json`).

| Key | Meaning |
|---|---|
| `name`, `rules` | What the case shows, and the rule IDs it tests |
| `page` | A `page.json` whose first block is the table |
| `stamp` | The version keys a writer of version 2 gives the page |
| `problems` | Values a reader must find invalid. Without this key, the page has none |
| `expect` | What a reader must compute from the table, as below |

| Key of `expect` | Meaning |
|---|---|
| `formulaCells` | The formula cells, as `[row ID, column ID]` in table order (`R-SHT-5`) |
| `styleIds` | Styles, the IDs already in the table, and the ID a writer gives each one (`R-SHT-6`) |
| `activeMerges` | The merges a reader uses, by ID (`R-SHT-12`) |
| `applyOrder` | The order conditional formats apply in (`R-SHT-15`) |
| `fingerprint`, `fresh` | The fingerprint of the cells, and whether `values` may be used (`R-SHT-18`) |
| `orphans` | Entries that name rows or columns the table no longer has (`R-SHT-2`) |
| `layers` | The layers of a cell's look, lowest first (`R-SHT-9`) |
