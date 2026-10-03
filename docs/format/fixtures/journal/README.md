# Journal fixtures

These files test readers of the device-local journal in [section 20 of the note format specification](../../README.md#20-device-local-data-and-the-journal). Each folder holds a page's `page.json` as it was on disk when the app stopped, and one journal generation of that page.

| File or folder | What it holds | What a reader must do |
|---|---|---|
| `save-begin-b3.bin` | The `SaveBegin` record of Appendix B.3 | Read sequence number 1044, revision `01m3sa8yf8bryf28a7sjgb7mmc`, and `throughSeq` 1043 |
| `text-edits/` | A text edit, a title and tag change, and a `SaveBegin` for a save that never replaced `page.json` | Replay both transactions from the base, because the base revision is still on disk. The result is `expected.json`, except for its revision |
| `ink-progress/` | The stroke of section 9.7, still being drawn when the app stopped | Read one `InkProgress` record whose blob is the stroke record of Appendix B.2, and turn it into a normal stroke |

The header metadata of every generation gives the notebook folder identity `5eed` followed by 44 zeros. A reader that checks identities must use that value for the notebook folder.

`make_journal_fixtures.py` writes every file here from the values it lists, using only the Python standard library. Run it from this folder after changing it, and commit the files it writes.
