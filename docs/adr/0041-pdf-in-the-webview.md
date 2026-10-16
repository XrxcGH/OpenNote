# ADR 0041: PDF files are read by pdf.js in the webview

- Status: Proposed
- Date: 2026-10-15

## Context

PDF import, note space, highlights, dim in dark mode, and text from scanned PDFs all need PDF pages drawn as pictures, with their words and the boxes of those words. A PDF is a complex, often hostile format, and readers written in native code have a long history of memory safety bugs. OpenNote's Rust code has no PDF reader, and adding one, or a native library such as PDFium, would put untrusted parsing in the process that holds the person's notes and their file access.

## Decision

We will read PDF files with pdf.js (`pdfjs-dist`, pinned to an exact version) inside the webview. The person picks the file with the webview's own file chooser, so the page gets the bytes of that one file and never a path. pdf.js parses it in its own web worker, inside the browser engine's sandbox. Scripting, XFA forms, and WebAssembly are off, and nothing is fetched from the network. Each page is drawn to a PNG at twice its printed size. Its words, plain text, and picture boxes are kept in the page's image block. The native side only stores the PNG as an asset, as it does for any pasted picture.

## Options considered

| Option | For | Against |
|---|---|---|
| pdf.js in the webview (chosen) | Widely used and fuzzed; parsing stays in the sandbox and a worker; gives words with boxes; no native dependency | About 1.5 MB more in the app, loaded only on first use; drawing is slower than native for very large files |
| PDFium through a Rust binding | Fast, faithful drawing | A large C++ library parsing untrusted files in the main process; a native build for each platform |
| A pure Rust PDF reader | Memory safe | No mature crate draws pages faithfully, and text positions are incomplete |

## Consequences

PDF parsing never runs in native code. The worker file ships with the app, and the content security policy's `worker-src 'self'` allows it without change. JPEG 2000 pictures inside a PDF need WebAssembly, which the policy blocks, so they are left out of the drawing. Revisit if a memory safe native reader becomes good enough, or if drawing speed on large files becomes a problem.
