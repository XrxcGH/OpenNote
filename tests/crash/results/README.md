# Week-one results of WP2

These files hold the first runs of measurements M3, M5, and M6 and of the kill harness, from plan section 2. They ran on a Surface Laptop Studio 2, which is much faster than the reference laptop in BRAND.md. Every report says `"reference_laptop": false`, and none of these numbers counts as a pass on the reference laptop.

## The machine

- Surface Laptop Studio 2 with an Intel Core i7-13800H.
- A KXG80ZNV1T02 solid-state drive from Kioxia on NVMe (Non-Volatile Memory Express), formatted with NTFS (New Technology File System).
- Windows 11 build 26200, with Microsoft Defender real-time protection on.

Other work ran on the machine at the same time, so the numbers are noisy. Two runs of the same measurement differed by up to half. No USB stick, no volume with exFAT or the 32-bit file allocation table (FAT32), and no remote network share was available. The share results come from the loopback share `\\localhost\C$` on the same drive, through the Windows network redirector. They show the semantics of a network share, but not its speed.

## The files

| File | What it holds |
|---|---|
| `2026-09-30-surface-laptop-studio-2-nvme.json` | M3, M5, and M6 on the internal drive |
| `2026-09-30-surface-laptop-studio-2-share-loopback-m5.json` | M5 on the loopback share |
| `2026-09-30-surface-laptop-studio-2-share-loopback-m6.json` | M6 on the loopback share |
| `2026-09-30-kill-harness-fs-100.json` | 100 kills of the file system workload, with no failures |

Times are in milliseconds, at the 50th, 95th, and 99th percentiles. Run them again with `opennote-crashtest measure all --dir <folder> --label <drive> --out <file>`.

## What they show

M5: a save of a budget page after one stroke took 16 to 23 ms at the 95th percentile over two runs on the internal drive. The gate is 25 ms on the reference drive, so the slower reference laptop will likely miss it. The fallback in plan section 2 is to merge the two page flushes where the file system allows it.

M3: reading and parsing the files of a budget page, with the cache emptied first, took 16 to 31 ms at the 95th percentile with 1 or 4 segments, over three runs. With 8 segments it took 25 to 63 ms. Decoding the ink comes on top, once the formats package (WP1) lands. The fallback, compacting to at most 4 segments per page, looks prudent.

M6 on NTFS:

- A rename by handle with POSIX (Portable Operating System Interface) semantics replaces a file that another process holds with delete sharing. That process keeps reading the old file.
- Without delete sharing, the replace fails with a sharing violation, which is Busy.
- A folder can't be renamed while a file inside it is open.

M6 on the loopback share:

- POSIX semantics aren't available, so the rename falls back to `FileRenameInfo`.
- Any held target then refuses the replace with access denied, and flushing a folder handle fails.
- Every save there is unconfirmed, as the table in spec 17.5 says.
