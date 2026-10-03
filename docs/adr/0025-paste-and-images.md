# ADR 0025: Paste, clipboard facts, and image import

- Status: Proposed, pending real captures for spike S4 and the image memory measurement in spike S3
- Date: 2026-10-03

## Context

Phase 4's tests require pastes from Word, OneNote, web pages, and plain text. FEATURES.md asks for clean pastes from the web (structure without stray fonts and colors), Ctrl+Shift+V for plain text, source links, joined PDF lines, and web images saved into the page. Images come by paste, drag, or file picker, with resize and crop. The forces:

- **Security.** Pasted HTML can hold scripts, event attributes, `javascript:` links, and tracking pixels. The WebView must never name arbitrary files for the core to import.
- **What the browser can't see.** The paste event doesn't expose the CF_HTML `SourceURL` header or Word's temporary image files (`%TEMP%\msohtmlclip*`), and the context menu's Paste can't call `navigator.clipboard.read()` without a WebView2 permission prompt.
- **Memory.** Phase 4 has 40 MB. Decoding a 12-megapixel photo in the page to learn its size costs about 48 MB, and pasting many at once multiplies it.
- **Immutable assets.** SPEC 10.3: an asset is written durably before any block refers to it, and crop is data.

## Decision

We will:

1. Handle every paste and drop in one pipeline: read, facts, classify, normalize (small pure functions per source), split, import images, apply, then extras as separate undo steps. The editor schema's parse rules are the allowlist; pasted HTML is parsed in an inert document and reaches the page only as schema nodes.
2. Keep structure, highlights, and text colors from Word, OneNote, Google Docs, and Excel, and drop colors, fonts, and sizes from web pages. A background maps to the nearest of the five highlighters. A text color maps to the nearest pen within a CIEDE2000 distance of 10, or else to a hex color, and black is no color.
3. Read clipboard facts in Rust (`clipboard_facts`): the sequence number, a SHA-256 of the plain text, the source address, and Word's temporary images as random tokens that expire after 60 seconds, for files whose resolved path Rust checked. The page uses the facts only when the text hash matches its own paste, and it never passes a path.
4. Import images through Rust commands (`image_import`, `image_import_url`, and `image_import_clip`) that read the pixel size, orientation, and format from the file header (confirmed by the Windows Imaging Component on Windows), check the type, and call the core's `import_asset` with the size. The page runs at most 4 imports and 64 MB of source bytes at once, reading each file only when its turn comes. Web images are downloaded once, with size, type, redirect, and address limits.
5. Keep display-size renditions as the defined fallback behind `page.imageRenditions`, turned on only if spike S3 shows images above their 12 MB share. HEIC and TIFF conversion through WIC is built behind `page.heicImport`, off by default.

## Options considered

| Option | For | Against |
|---|---|---|
| Schema as the allowlist, Rust facts and tokens, header probe (chosen) | Nothing from a paste can run or load; the source address and Word's images provably belong to the paste; no full decode in the page | More Rust code (clipboard, probe, import commands); tokens and hashes to test |
| DOMPurify before parsing | A well-known sanitizer | A second sanitizer adds time on large pastes for no extra safety, because only schema nodes survive |
| Pass Word's `file:///` paths to the core | Less code | The page would name files for the core to read |
| `createImageBitmap` in the page to read sizes | No Rust | A full decode per image, about 48 MB for one photo |
| Display-size renditions always | Lowest memory | A cache and a scheme to maintain before we know they're needed |
| The `image` crate in Rust | Portable | WIC is already compiled, reads more Windows formats, and applies orientation metadata |

## Findings so far (spike S4)

- The corpus in `tests/fixtures/clipboard/<source>/<case>` holds what each program writes (`fragment.html`, `text.txt`, and `facts.json` for what only the shell reads) and the expected Markdown. Its Word, OneNote, Google Docs, Excel, VS Code, and web cases were modeled on each program's documented clipboard HTML; captures from real Office and browser builds replace them through `tests/e2e/tools/clipset` when the spike runs on a machine with Office.
- Word's default heading blue (#2F5496) is within 10 of the Indigo pen, so Word headings keep a pen color; documents write black text as a color, so black maps to no color.
- Web selections pick up wiki furniture (edit links, citation marks); the web normalizer drops it with the page chrome.
- On Windows, WebView2 reaches the `opennote-asset` scheme as `http://opennote-asset.localhost/<page>/<asset>`, so that origin is in the Content Security Policy's `img-src`.

## Consequences

- Easier: pastes are predictable and safe; the fixture corpus and the real-clipboard end-to-end spec prove them; image memory stays bounded; later phases add paste sources and clipboard formats through registries.
- Harder: the normalizers need recaptured fixtures when Office changes its HTML; the Rust commands need their own tests on Windows.
- A paste that makes new blocks (tables, more text boxes, images) undoes in two steps: the text in the editor, then the blocks. The text sync owns the editor's batches, so one batch would need a sync seam.
- The source link prompt is a toast with one action, Always; Never lives in Settings, Editing, Paste. Until answered, no link is added, and the prompt shows once a session.
- Follow-up work: the privacy panel entry for web image downloads (Phase 13), and the context menu's Paste through `clipboard_read` once the page context menu lands.
- Revisit if spike S3 shows image memory above its share (turn on renditions), if people ask for HEIC often (turn on conversion), or if WebView2 exposes the clipboard facts itself.
