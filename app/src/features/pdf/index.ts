// The PDF feature's public face for other features: pdf.js with its worker, loaded on first use, and the reader's
// safe choices (no scripting, no XFA forms, no WebAssembly, nothing fetched). My handwriting reads the ink of an
// uploaded PDF from its drawing through it.
export const loadPdfJs = () => import('./render').then((module) => module.pdfjs());
export { MAX_PDF_BYTES, MAX_PICTURE_PIXELS } from './render';
