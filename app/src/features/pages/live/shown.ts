// The shown page's page view, in a module light enough for start-up: the commands and the View tab read it without
// loading the paginated view's code. The code attaches when a page is mounted and fills this in.
import { createStore } from '../../../state/store';
import type { PageViewSpec } from '../layout';

export type PaperName = 'letter' | 'a4' | 'a5' | 'legal' | 'tabloid';
export type MarginName = 'narrow' | 'normal' | 'wide';

/** What the commands do to the shown page's view. Each change is one undo step. */
export interface PagesViewState {
  readonly mode: 'infinite' | 'paginated';
  readonly layout: 'flow' | 'freeform';
  readonly paper: PaperName | 'custom';
  readonly orientation: 'portrait' | 'landscape';
  readonly margins: MarginName | 'custom';
  /** The paper preset the background matches, such as 'ruled-college', or 'custom'. */
  readonly background: string;
  /** How many sheets the page takes. */
  readonly sheets: number;
}

export interface PagesViewApi {
  state(): PagesViewState;
  setMode(mode: 'infinite' | 'paginated'): void;
  setLayout(layout: 'flow' | 'freeform'): void;
  setPaper(size: PaperName): void;
  setOrientation(orientation: 'portrait' | 'landscape'): void;
  setMargins(margins: MarginName): void;
  setBackground(preset: string): void;
  /** Zooms so the whole sheet shows. */
  fitSheet(): void;
  /** The page's view settings as they are now. */
  view(): PageViewSpec;
  /** Changes the view with a pure edit from the layout module. The change is one undo step. */
  edit(change: (view: PageViewSpec) => PageViewSpec, announcement?: string): void;
  /** The reading aids panel and the line focus. */
  readingAids(): void;
  /** How many sheets the page shows, and the one the window is on (from 0). */
  sheets(): { count: number; current: number };
  goToSheet(sheet: number): void;
  /** Adds a sheet with the same paper at the end, as one undo step. */
  addSheet(): void;
}

export const shownPagesView = createStore<PagesViewApi | null>(null, 'pages view');

/** Notified after the view's state changes, so the View tab's toggles re-render. */
export const pagesViewEpoch = createStore<number>(0, 'pages view epoch');

/** The sheet strip and flipping, a setting of this device. */
export interface SheetNav {
  /** The strip of thumbnails beside the page. */
  readonly open: boolean;
  /** Sheets go one at a time, each fitted whole in the window. */
  readonly flip: boolean;
}

const NAV_KEY = 'opennote.sheetNav';

function loadNav(): SheetNav {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(NAV_KEY) ?? '{}') as Partial<SheetNav>;
    return { open: raw.open === true, flip: raw.flip === true };
  } catch {
    return { open: false, flip: false };
  }
}

export const sheetNav = createStore<SheetNav>(loadNav(), 'sheet navigator');

export function setSheetNav(next: Partial<SheetNav>): void {
  sheetNav.set((now) => ({ ...now, ...next }));
  try {
    globalThis.localStorage?.setItem(NAV_KEY, JSON.stringify(sheetNav.get()));
  } catch {
    // The setting lasts until the window closes.
  }
}
