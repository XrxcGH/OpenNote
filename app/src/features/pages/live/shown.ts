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
}

export const shownPagesView = createStore<PagesViewApi | null>(null, 'pages view');

/** Notified after the view's state changes, so the View tab's toggles re-render. */
export const pagesViewEpoch = createStore<number>(0, 'pages view epoch');
