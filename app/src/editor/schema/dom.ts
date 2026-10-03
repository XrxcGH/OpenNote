// Static DOM from a document (PLAN.md section 3.3; ARCHITECTURE.md section 7.1). Text renders through the schema's
// DOMSerializer, never through innerHTML, so note content can't become script. Long pages render in slices, so
// no task runs past its budget and the viewport's blocks come first.
import { DOMSerializer } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';

/** Replaces the children of `into` with the document's static DOM. */
export function renderStatic(doc: PMNode, into: HTMLElement): void {
  const serializer = DOMSerializer.fromSchema(doc.type.schema);
  const fragment = serializer.serializeFragment(doc.content, { document: into.ownerDocument });
  into.replaceChildren(fragment);
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Renders each item in order, yielding to the browser whenever a slice has run for `budgetMs`. Rejects with the
 * signal's reason when it aborts; items rendered before then stay.
 */
export async function renderStaticSliced(
  items: readonly { doc: PMNode; into: HTMLElement }[],
  budgetMs: number,
  signal: AbortSignal,
): Promise<void> {
  let sliceStart = performance.now();
  for (const { doc, into } of items) {
    signal.throwIfAborted();
    if (performance.now() - sliceStart >= budgetMs) {
      await nextTask();
      signal.throwIfAborted();
      sliceStart = performance.now();
    }
    renderStatic(doc, into);
  }
}
