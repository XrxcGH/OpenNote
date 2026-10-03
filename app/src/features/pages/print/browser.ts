// The entry point of the print window. A page that loads this script gets `OpenNotePrint` on its window, and the host
// calls it with the page's data to prepare and show the print document, and then prints the window to PDF.

import { preparePrint, showDocument } from './prepare';

Object.assign(globalThis, { OpenNotePrint: { preparePrint, showDocument } });
