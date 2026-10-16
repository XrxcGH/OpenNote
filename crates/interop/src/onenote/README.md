# OneNote files

This folder reads OneNote's own files: section files (`.one`) and notebook packages (`.onepkg`). It is feature A3-17.

## How it was written

The reader follows a clean-room method. Every fact about the format comes from one of two places:

- Microsoft's published format descriptions: [MS-ONESTORE] for the revision store and [MS-ONE] for sections and pages. Both are free to implement under the Open Specifications terms.
- Test files that we made ourselves and looked at byte by byte.

No code from other OneNote readers was read or copied, and nothing was decompiled. The table below gives the source of each fact. When a description and a test file disagree, the table says so, and the code follows the safer reading.

Every file is treated as hostile. Every read checks its bounds. Every count, loop, and nesting level has a cap in `limits` (in `mod.rs`). Damage ends a read with an error, never a panic. The fuzz target `onenote` runs the reader on damaged input.

## Layers

- `bytes.rs`: checked little-endian reads, GUIDs, ExtendedGUIDs, CompactIDs.
- `store.rs`: the header, the transaction log, and file node lists.
- `space.rs`: object spaces, revisions, object groups, and file data.
- `props.rs`: property sets and their streams of object references.
- `model.rs` and `outline.rs`: sections, pages, outlines, text, tables, pictures, and files.
- `cab.rs`: the Cabinet container of a `.onepkg` file.
- `write/`: a writer of small test files, built from the same descriptions. Only tests use it.

## Format facts and their evidence

| Fact | Evidence |
|---|---|
| A `.one` file starts with a 1024-byte header. `guidFileType` is `{7B5C52E4-D88C-4DA7-AEB1-5378D02996D3}` and `guidFileFormat` is `{109ADD3F-911B-49F5-A5D0-1791EDC8AED8}`. | [MS-ONESTORE] 2.3.1. A `.one` file that OneNote 2016 wrote on the dev machine starts with these bytes; we looked at the header only. |
| The header holds `cTransactionsInLog` at byte 96, `fcrTransactionLog` at 160, and `fcrFileNodeListRoot` at 172. | Field sizes in [MS-ONESTORE] 2.3.1, added up. |
| A file node list is a chain of fragments. Each has a 16-byte header with magic `0xA4567AB1F5F7F4C4`, then nodes, then a 12-byte next reference and an 8-byte footer `0x8BC215C38233BA4B`. | [MS-ONESTORE] 2.4.1, 2.4.2. |
| Nodes past the count in the last committed transaction must be ignored. | [MS-ONESTORE] 2.3.3. Tested with a file that has an extra root node. |
| A node header packs the ID (10 bits), size (13), StpFormat (2), CbFormat (2), BaseType (4), and a reserved bit. Compressed references are multiplied by 8. | [MS-ONESTORE] 2.4.3. The example in 3.2 decodes this way: `0x95001C10` gives ID `0x010`, size 7, formats 2, and 2, base type 2. |
| Whether a node starts with a reference is decided by its ID, not by its BaseType field. | The example in [MS-ONESTORE] 3.3 shows header `0x0880600C` for a node with no reference. Its BaseType bits read as 1 and its reserved bit as 0, unlike the text of 2.4.3. |
| The current revision is the one labeled with the default context and revision role 1. A later label for the same pair replaces an earlier one. | [MS-ONESTORE] 2.1.11, 2.1.12. |
| A revision includes the objects of the revision it depends on, except where it declares its own. | [MS-ONESTORE] 2.1.9. Tested with a page whose title changed in a later revision. |
| CompactIDs are resolved with the global identification table that comes before them in the same object group. | [MS-ONESTORE] 2.1.3, 2.1.13. |
| Object references in a property set come from the OIDs stream in the order the properties are read, nested sets included. | [MS-ONESTORE] 2.6.1, 2.1.1. |
| [MS-ONE] 2.1.12 lists NoteTagStates as `0x04003489`, whose type bits say NoData. Section 2.2.88 describes an array of property sets. | The reader matches properties on their 26-bit ID only, and reads the data by the type the file gives. |
| Pictures and files are file data objects. Their data is in a FileDataStoreObject inside the file (`<ifndf>{GUID}`), or in the `name_onefiles` folder beside it (`<file>NAME`). | [MS-ONESTORE] 2.5.27, 2.6.13, and the glossary. Only names made of a UUID and `.onebin` are opened from that folder. |
| A section is password-protected when a revision says `odcsDefault = 2`, or holds an ObjectDataEncryptionKeyV2FNDX node. | [MS-ONESTORE] 2.5.7, 2.5.19. Such sections are reported, not read. |
| Files saved by OneNote on the web use another packaging, with `guidFileFormat` `{638DE92F-A6D4-4BC1-9A36-B3FC2511A5B7}`. | [MS-ONESTORE] 2.8.1. The reader names it and gives advice. It does not read it. |
| Ink, and some other content, has no JCID in [MS-ONE]. | The JCID list in [MS-ONE] 2.2 has no ink type. The reader counts such objects and the report names them. |
| The whole reader works on a file that OneNote wrote, not only on our own test files. | A small `Quick Notes.one` that OneNote 2016 wrote on the dev machine reads as 1 section with 1 page, with nothing lost. The ignored test `real_files_from_a_corpus_folder` prints only counts, never the notes, and is how the owner can check more files. |
| A `.onepkg` file is a Cabinet file: `MSCF`, CFHEADER, CFFOLDER, CFFILE, and CFDATA records. Its MSZIP blocks start with `CK`, and each block may refer back into the 32 KB before it. | Microsoft's Cabinet format description, and `tests/data/onenote/Trip.onepkg`, which Windows' own `makecab` made. The fixture spreads a 100 KB file over several blocks. |

## Not covered yet

- Hyperlink targets inside text. [MS-ONE] 2.3.75 marks a run as a link but gives no place for the address. Such links come over as plain text, and the report says so.
- Heading styles. [MS-ONE] 2.2.83 names a paragraph's style but does not list the names. Styles named `h1` to `h6` or `Heading 1` to `Heading 6` become headings.
- Section order. The `.onetoc2` file keeps it, but this reader orders sections by name.
- The server packaging of [MS-ONESTORE] 2.8, and Cabinet folders compressed with LZX or Quantum.

## Needs the owner

These checks need files that OneNote itself wrote:

1. In OneNote for Windows, export a small notebook as a package (File, Export, Notebook, OneNote Package). Import it and compare the pages.
2. Check which compression OneNote uses inside `.onepkg` files. If it is LZX, the reader says so, and gives advice; an LZX decoder would be the next step.
3. Draw some ink and add a password-protected section. Check that the report names both.
