// The code editor's public shapes: its options, the editor handle the studio and code cells hold, and the
// suggestion source the completion lanes (code:L12, code:L13b) provide.

import type { Extension } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import type { CompletionSource, Diagnostic, GhostSuggestion } from '../contracts';
import type { AcceptPart } from './ghost';
import type { EditorLanguage, IndentStyle } from './indent';
import type { InlineValue } from './marks';
import type { CodeEditorHandle } from './views';

/** An on-demand request gives up after this long (the abandon limit of DESIGN 10.3). */
export const ABANDON_MS = 1500;
/** Automatic suggestions wait for this typing pause. */
export const AUTO_PAUSE_MS = 300;

/** What a suggestion source reads. L12's pattern predictor and L13b's model answer it. */
export interface GhostRequest {
  language: EditorLanguage;
  text: string;
  pos: number;
  /** True when the person asked (Ctrl+Tab or Alt+\), not just paused. */
  explicit: boolean;
  signal: AbortSignal;
}

export type GhostAnswer = GhostSuggestion | readonly GhostSuggestion[] | null;

export type GhostSource = (request: GhostRequest) => GhostAnswer | Promise<GhostAnswer>;

export interface CodeEditorOptions {
  language: EditorLanguage;
  text: string;
  readOnly?: boolean;
  /** Forces the indent stop; otherwise the setting, the file's own style, or the language default. */
  tabSize?: number;
  onChange?: (text: string, update: ViewUpdate) => void;
  extensions?: Extension;
  /** The accessible name, such as the file name. Default "Code editor". */
  label?: string;
  /** The project path, for completion sources. */
  file?: string;
  /** Escape with nothing to close: a code cell stops its running program here and returns true. */
  onEscape?: () => boolean;
  /** A click in the breakpoint gutter. */
  onBreakpointToggle?: (line: number) => void;
  /** Long-press, right-click, or the pen's barrel button on the text: the studio's menu (Quick fix, Explain). */
  onContextMenu?: (event: MouseEvent) => void;
}

export interface CodeEditor extends CodeEditorHandle {
  readonly view: EditorView;
  /** Resolves when the language support has loaded. */
  readonly ready: Promise<void>;
  getText(): string;
  /** An outside change (page undo, sync): a minimal change outside the undo history. */
  setText(text: string): void;
  setLanguage(language: EditorLanguage): Promise<void>;
  setReadOnly(readOnly: boolean): void;
  /** The ghost text source (L12, L13b), or null for none. */
  setSuggestionSource(source: GhostSource | null): void;
  /** The completion list's sources (L12). */
  setCompletionSources(sources: readonly CompletionSource[]): void;
  showGhost(suggestions: readonly GhostSuggestion[] | null): void;
  acceptSuggestion(part: AcceptPart): string | null;
  /** Asks the source now; inserts the answer when `insert`, else shows it. Resolves whether something came. */
  requestSuggestion(insert: boolean): Promise<boolean>;
  showProblems(items: readonly Diagnostic[]): void;
  setBreakpoints(lines: readonly number[]): void;
  setCurrentLine(line: number | null): void;
  setInlineValues(values: readonly InlineValue[]): void;
  readonly zoom: number;
  readonly indent: IndentStyle;
  destroy(): void;
}
