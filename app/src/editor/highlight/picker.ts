// Where the code language button finds the page's language picker (owner: WP6). editor/ can't import the page, so
// the page installs its picker here at start-up. The module holds no editor code, so start-up stays small.
import type { EditorView } from '@tiptap/pm/view';

export interface LanguagePickRequest {
  readonly view: EditorView;
  /** The position before the code block. */
  readonly pos: number;
  readonly anchor: HTMLElement;
  readonly language: string | null;
}

export type LanguagePicker = (request: LanguagePickRequest) => void;

let installed: LanguagePicker | null = null;

/** The page installs its filterable picker here. Without one, the language button opens a plain menu. */
export function setLanguagePicker(next: LanguagePicker | null): void {
  installed = next;
}

export function languagePicker(): LanguagePicker | null {
  return installed;
}
