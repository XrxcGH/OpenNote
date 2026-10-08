// What an editor may ask of the page around it (PLAN.md section 3.8, owned by WP0). editor/ is a library layer: it
// never imports stores, services, features, or the shell, so everything it needs from them comes through this
// interface, which the page feature implements.

import type { FlagId } from '../app/flags';
import type { MenuAnchor, MenuItemSpec } from '../ui';

/** A block's ID, as the page stores it. The same string as services/pages' BlockId. */
export type BlockId = string;

/** A snapshot of settings.editing, as the editor needs it. */
export interface EditingSettingsView {
  markdownShortcuts: boolean;
  slashMenu: boolean;
  formattingBar: 'touchAndPen' | 'always' | 'never';
  autocorrect: { enabled: boolean; entries: readonly { from: string; to: string }[] };
  spelling: { enabled: boolean; languages: readonly string[] };
}

/** Spelling results for the text of one textblock, from the page's cache. */
export interface SpellingService {
  /** UTF-16 ranges of the misspelled words, or null when the text hasn't been checked yet. */
  errorsFor(textblockText: string): readonly { start: number; length: number }[] | null;
  requestCheck(key: string, text: string): void;
}

export interface EditorHost {
  settings(): EditingSettingsView;
  flag(id: FlagId): boolean;
  announce(text: string, politeness?: 'polite' | 'assertive'): void;
  openMenu(options: { label: string; items: readonly MenuItemSpec[]; anchor: MenuAnchor }): Promise<string | null>;
  screenReader(): boolean;
  spelling(): SpellingService | null;
  /** Selects blocks as objects: when a selection grows past one block, on the second Ctrl+A, or on Escape. */
  selectBlocks(blocks: readonly BlockId[], reason: 'escalate' | 'selectAll' | 'escape'): void;
  /** Loads the LaTeX drawing code (Phase 10) on first use. Absent or null shows math as its source. */
  math?(): Promise<MathRenderer> | null;
  /** Loads the function grapher (Phase 10) on first use. Absent or null leaves a graph as its code block. */
  graph?(): Promise<GraphRenderer> | null;
}

/** What a graph is given: the text of its code block, and a way to replace that text. */
export interface GraphProps {
  source: string;
  editable: boolean;
  onSource(next: string): void;
}

export interface GraphHandle {
  update(props: GraphProps): void;
  destroy(): void;
}

/** Draws a graph into an element the editor owns. */
export interface GraphRenderer {
  mount(container: HTMLElement, props: GraphProps): GraphHandle;
}

/** One drawn equation, or what is wrong with its LaTeX and where. */
export type MathDrawing = { ok: true; html: string } | { ok: false; message: string; position: number; length: number };

/** What an action did to some LaTeX: new LaTeX, or why it could not. */
export type MathActionResult =
  { ok: true; latex: string } | { ok: false; reason: 'unsupported' | 'unchanged' | 'none' | 'letters' };

export interface MathRenderer {
  render(source: string, display: boolean): MathDrawing;
  /** Simplify and Solve for the source field, when the page offers them. */
  actions?: {
    simplify(latex: string): MathActionResult;
    solve(latex: string): MathActionResult;
  };
}

/** The settings.editing defaults, for hosts in tests and before settings load. */
export const DEFAULT_EDITING_VIEW: EditingSettingsView = {
  markdownShortcuts: true,
  slashMenu: true,
  formattingBar: 'touchAndPen',
  autocorrect: { enabled: true, entries: [] },
  spelling: { enabled: true, languages: [] },
};
