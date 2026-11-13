// Static DOM from a document (PLAN.md section 3.3; ARCHITECTURE.md section 7.1). Text renders through the schema's
// DOMSerializer, never through innerHTML, so note content can't become script. Long pages render in slices, so
// no task runs past its budget and the viewport's blocks come first.
import { DOMSerializer } from '@tiptap/pm/model';
import type { DOMOutputSpec, Node as PMNode, Schema } from '@tiptap/pm/model';
import type { EditorHost } from '../host';
import type { ListDefinitions } from '../paragraph/numbering';
import { applyBlockMarks } from '../render/blocks';
import { PARA_NODES } from '../paragraph/attributes';
import { directionDom } from '../paragraph/directionDom';

export interface StaticOptions {
  /**
   * Draws each paragraph's direction, language, and hyphenation as the editor's decorations do (text.language), so
   * the page does not reflow when the editor mounts. `hyphenate` is the page's default (`view.text.hyphenate`).
   */
  direction?: { hyphenate: boolean };
}

/** The static options for an editor host: direction drawn when text.language is on, as the editor draws it. */
export function staticOptions(host: Pick<EditorHost, 'flag' | 'pageSettings'>): StaticOptions {
  if (!host.flag('text.language')) return {};
  return { direction: { hyphenate: host.pageSettings?.().text.hyphenate ?? false } };
}

const isAttrs = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !('nodeType' in value);

/** The spec with `extra` added to its element's attributes. Styles are joined, the spec's first. */
function withAttrs(spec: DOMOutputSpec, extra: Record<string, string> | null): DOMOutputSpec {
  if (!extra) return spec;
  if (Array.isArray(spec)) {
    const [tag, second, ...rest] = spec as unknown as [string, ...unknown[]];
    if (!isAttrs(second)) return [tag, extra, ...spec.slice(1)];
    const style = [second.style, extra.style].filter(Boolean).join('; ');
    return [tag, { ...second, ...extra, ...(style ? { style } : {}) }, ...rest];
  }
  const element = typeof spec === 'object' && 'dom' in spec ? spec.dom : spec;
  if (element instanceof Element) {
    for (const [name, value] of Object.entries(extra)) {
      const old = name === 'style' ? element.getAttribute('style') : null;
      element.setAttribute(name, old ? `${old}; ${value}` : value);
    }
  }
  return spec;
}

const directed = new WeakMap<Schema, Map<boolean, DOMSerializer>>();

/** The schema's serializer, with each paragraph's direction attributes when `options.direction` asks for them. */
function serializerFor(schema: Schema, options: StaticOptions): DOMSerializer {
  const base = DOMSerializer.fromSchema(schema);
  if (!options.direction) return base;
  const { hyphenate } = options.direction;
  const cached = directed.get(schema)?.get(hyphenate);
  if (cached) return cached;
  const nodes = { ...base.nodes };
  for (const name of PARA_NODES) {
    const toDOM = base.nodes[name];
    if (toDOM) nodes[name] = (node) => withAttrs(toDOM(node), directionDom(node.attrs, hyphenate));
  }
  const serializer = new DOMSerializer(nodes, base.marks);
  const bySetting = directed.get(schema) ?? new Map<boolean, DOMSerializer>();
  bySetting.set(hyphenate, serializer);
  directed.set(schema, bySetting);
  return serializer;
}

/** Replaces the children of `into` with the document's static DOM. */
export function renderStatic(
  doc: PMNode,
  into: HTMLElement,
  lists?: ListDefinitions,
  options: StaticOptions = {},
): void {
  const serializer = serializerFor(doc.type.schema, options);
  const fragment = serializer.serializeFragment(doc.content, { document: into.ownerDocument });
  into.replaceChildren(fragment);
  // Border groups, list labels, and scaled words need the whole document, so they come after the serializer.
  applyBlockMarks(doc, into, lists);
  // The editor keeps an empty line below a last equation (extensions/math.ts), so the static view has it too, and the
  // page reads the same and keeps its height when the editor mounts.
  if (doc.lastChild?.type.name === 'mathBlock') {
    const line = into.appendChild(into.ownerDocument.createElement('p'));
    line.appendChild(into.ownerDocument.createElement('br'));
  }
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
