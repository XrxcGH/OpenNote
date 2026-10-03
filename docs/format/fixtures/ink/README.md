# Ink fixtures

Each segment file `<name>.onk` has a JSON file `<name>.json` beside it. A reader decodes the segment as spec 9.6 says, checks it against `expect` and `page`, and compares what it finds with `result` or `error`. Every checksum here is the CRC-32 of spec 2.1, a cyclic redundancy check (CRC).

| Key | Meaning |
|---|---|
| `description` | What the case tests |
| `file` | The segment file |
| `page` | The ID of the page the segment is read for |
| `expect` | The segment's entry in `page.json`: `id`, `bytes`, `records`, and `crc32` as 8 hexadecimal digits |
| `error` | Present when the segment can't be read at all. One of `syntax`, `newerVersion`, `unknownRecord`, `checksum`, `validation`, `truncated`, or `limit` |
| `result` | Present when the segment reads, perhaps with damaged records |

## Errors

A reader reports an error, and no records, in these cases:

| Error | Cause |
|---|---|
| `syntax` | The file is shorter than 72 bytes, has the wrong magic, or has segment version 0 |
| `newerVersion` | The segment version is above 1 |
| `checksum` | The header's CRC-32 fails. Or the footer is intact, but the size, record count, or footer CRC-32 differ from `expect` |
| `unknownRecord` | The header has flags or reserved bytes that version 1 doesn't know |
| `validation` | The segment ID differs from `expect.id`, the page ID differs from `page`, or the header time is outside years 1 to 9999 |

## Results

`result` has these keys:

| Key | Meaning |
|---|---|
| `header` | The segment's `id`, `page`, and `created` time in Unix milliseconds |
| `footerOk` | Whether the footer magic is there and its CRC-32 covers the file |
| `unknownRecords` | Records of an unknown kind, with unknown stroke flags or property mask bits, or with nonzero flags or reserved bytes. They are kept, not shown |
| `damaged` | Damaged records: `index`, byte `offset`, `stroke` (the ID in the body, or null), and `reason` |
| `records` | The records that decoded, in order |

When the footer is intact, a reader parses exactly the stated number of records, which must end at the footer. If anything is off, or the footer isn't intact, it walks the records one at a time. The reasons in `damaged` are:

| Reason | Meaning |
|---|---|
| `truncated` | The 12-byte frame of the record doesn't fit before the end |
| `length` | The body runs past the end |
| `checksum` | The record's CRC-32 fails |
| `body` | The body is too short or too long for its kind, holds a value that isn't finite, or has a time outside years 1 to 9999 |
| `points` | The point data breaks spec 9.4, or doesn't match the bounding box |

After `truncated` or `length`, the reader scans forward byte by byte for the next frame that fits, has zero flags and reserved bytes, and has a matching CRC-32. The walk goes on from there, or stops when there is none. The walk counts `index` across damaged records too. The end of the records is 8 bytes before the end of the file when the footer magic is there, and the end of the file otherwise.

## Records

A stroke record has `kind` set to `stroke`, then `id`, `block`, `start` (Unix milliseconds), `startUnknown`, and `style`. The style holds `tool`, `palette`, `color` as 4 bytes, and `width`. Then come `bbox` as 4 numbers, `channels` (stroke flag bits 0 to 2), and `transform` as 6 numbers or null. Last are `origin` as an ID or null, and `points`, each written `[x, y, pressure, tiltX, tiltY, t]` with 0 for absent channels.

A property record has `kind` set to `props`, then `id`, `style` or null, `transform`, and `block` or null. The `transform` is null when unchanged, `"remove"` when the record holds the exact bytes of the identity, and otherwise 6 numbers. A removal record has `kind` set to `remove` and `id`.
