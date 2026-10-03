# Reading order fixtures

`cases.json` tests the reading order of [spec 6.2](../../README.md#62-layout-floating-and-flowing-blocks): the default order, rows of floating blocks, and `view.readingOrder`. It holds a list of cases. Each case has:

| Field | Meaning |
|---|---|
| `name` | A short name |
| `about` | The rule the case covers |
| `page` | A complete `page.json` |
| `expected` | The IDs of the page's blocks, in the order a reader must give them |

A reader finds the reading order of `page` and compares the block IDs with `expected`. A reader that follows the spec finds the same order from the file alone: it needs no other fixture file. The Rust core and the Python reference reader in `docs/format/tools` both run these cases.

Version 1 is still a draft, so the Rust tests can write this file again with `OPENNOTE_BLESS=1 cargo test -p opennote-core --all-features fixture -- --test-threads=1`.
