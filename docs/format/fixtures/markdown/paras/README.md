# Paragraph formatting and other version 1 data

Version 2 adds data that a version 1 reader keeps without misreading: paragraph formatting, lists, text layout, text settings, headers and footers, and page style sheets (spec 4.6, 5.4.2, 5.4.3, 6.8, 6.9, and 6.11). Pages that use only these stay at version 1 (spec 15.6).

Each `.json` file other than `cases.json`, `styles.json`, and `layers.json` is a `page.json` written byte for byte as a version 1 writer writes it: version 2 keys come after the version 1 keys of their object, in code point order (rule `R-JSON-1`). A version 1 reader that saves the page writes the same bytes.

`cases.json` lists each page with its `name`, its `rules`, its `file`, and its expected `stamp`. A case may add `problems`, the values a reader must find invalid and treat as missing, and `ignored`, the keys a reader ignores.

`styles.json` holds two copies of a notebook's styles, how they merge (rule `R-STY-9`), and the style chains a reader follows (rule `R-STY-4`). `layers.json` lists the layers that give a character its look, lowest first (rule `R-STY-6`).

`notebook-theme-color.json` is a whole `notebook.json` whose styles use theme colors (rules `R-COL-1` and `R-STY-2`). A theme color sits only in the version 2 key `textColor`. Beside it, the version 1 key `color` is either absent, for a theme color, or the same pen name or `#rrggbb`, so a version 1 reader such as Beta 8 opens the notebook and draws the styles with the colors it knows. The file stays at version 1.
