# Where OpenNote's number formats differ

OpenNote follows Excel's documented behavior for number format codes (ADR 0057) except where a line below says
otherwise. Each fixture file says how its expected values were worked out.

| Case                                                                | Excel                                          | OpenNote                                                                          |
| ------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| Dates before 1900-03-01                                             | One day later, for a 1900-02-29 that never was | The true calendar, day 0 on 1899-12-30, as the engine counts (fn/DIFFERENCES.md)  |
| Negative serials with a date code                                   | A row of `#`                                   | The date before 1899-12-30, as Sheets shows it                                    |
| `[Red]` and the other colors                                        | Fixed colors                                   | Theme tokens with the same names, so they keep contrast in dark mode              |
| General width                                                       | Depends on the column width                    | Always 11 characters, the sign included, as Sheets' Automatic ignores the width   |
| Percent in a region that writes a space before `%`                  | No space (`25,60%` in German Excel)            | The region's space (`25,60 %` in de-DE), as the column showed before codes        |
| Built-in ID 22                                                      | The region's short date and `h:mm`             | The same, read from `Intl`                                                        |
| East Asian built-in IDs 27 to 36 and 50 to 81 outside their regions | The region's own codes                         | The short date, or the nearest region-neutral time or number code                 |
| A section with a condition                                          | Not fully documented for negative values       | A minus sign, unless the condition is `<` or `<=` a number at or below zero       |
| Localized date letters (`TT.MM.JJJJ` in German)                     | Shown and typed in the region's letters        | Not converted: date codes show and are typed with the invariant letters           |
| A cell that doesn't fit                                             | `#` fills the column width                     | `#` repeats `maxChars` times when the caller gives a width, and 8 times otherwise |
| The date column preset                                              | No preset: a date cell gets the short date     | The region's medium date (`mmm d, yyyy` in en-US), as the column showed before codes |
| A tag with extension subtags (`[$-en-US-u-ca-islamic]`)             | Not documented                                 | The extension is dropped: names always come from the Gregorian calendar           |
| Spanish (Spain) currency presets                                    | `[$€-C0A]` (modern sort)                       | The same: es-ES writes 0x0C0A, and both 0x040A and 0x0C0A read as es-ES           |
