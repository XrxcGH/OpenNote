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

/** A visual equation field: the page's math editor with its own keyboard, which reads and writes LaTeX. */
export interface VisualMathField {
  /** The element to put in the page. It takes focus, key events, and blur like any field. */
  element: HTMLElement;
  /** The LaTeX of what is in the field. */
  value: string;
  /** The equation as words, for a screen reader. */
  spoken(): string;
  /** Puts LaTeX in at the caret. */
  insert(latex: string): void;
  focus(): void;
}

export interface VisualMath {
  create(options: { value: string; label: string; display: boolean }): Promise<VisualMathField>;
}

/** Reads handwritten math. Each stroke is a list of points in one shared space. */
export interface PenMath {
  recognize(strokes: [number, number][][]): Promise<string | null>;
}

export interface MathRenderer {
  /** Handwriting to LaTeX, when the page offers it. */
  pen?: PenMath;
  /** The visual editor, when the page offers it. */
  visual?: VisualMath;
  render(source: string, display: boolean): MathDrawing;
  /** Simplify and Solve for the source field, when the page offers them. */
  actions?: {
    simplify(latex: string): MathActionResult;
    solve(latex: string): MathActionResult;
  };
  /** A short answer shown beside an equation, such as "x = 4", when the page offers live answers. */
  live?(latex: string): string | null;
}

/** The settings.editing defaults, for hosts in tests and before settings load. */
export const DEFAULT_EDITING_VIEW: EditingSettingsView = {
  markdownShortcuts: true,
  slashMenu: true,
  formattingBar: 'touchAndPen',
  autocorrect: { enabled: true, entries: [] },
  spelling: { enabled: true, languages: [] },
};
