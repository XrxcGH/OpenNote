// The shown page's editor pool, in a module light enough for start-up: the page commands reach the pool through it
// without loading ProseMirror, which pool.ts imports to place the caret.
import { createStore } from '../../../state/store';
import type { EditorPool } from './pool';

/** The pool of the page that is shown. Commands run on its active editor. */
export const shownPool = createStore<EditorPool | null>(null, 'page editor pool');
