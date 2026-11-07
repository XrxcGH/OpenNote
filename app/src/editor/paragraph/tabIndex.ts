// The tab index of the tab layout (text DESIGN.md 7.2). The plugin state keeps the document's tabs and maps them
// through each change. A change scans only the paragraphs it touched, so a key costs the same in a long note as in
// a short one. It marks those paragraphs to measure. tabLayout.ts measures them and hands back their widths.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { TabLeader } from './attributes';
import styles from './tabLayout.module.css';

export interface Width {
  px: number;
  leader: TabLeader;
}

export interface TabAt {
  pos: number;
  /** The position of the paragraph that holds the tab. */
  blockPos: number;
}

export interface TabState {
  /** The tabs of the document, by position. */
  tabs: readonly TabAt[];
  /** Width in CSS pixels and leader of each tab, by its position. */
  widths: ReadonlyMap<number, Width>;
  decorations: DecorationSet;
  /** The paragraphs to measure, by position, with the passes each has left. */
  dirty: ReadonlyMap<number, number>;
}

/** What a frame measured: the new widths, and each measured paragraph with whether its widths moved. */
export interface Measurement {
  widths: ReadonlyMap<number, Width>;
  blocks: ReadonlyMap<number, boolean>;
}

/** Measuring again after a pass can move later tabs, so each change gets a few passes at most. */
const MAX_PASSES = 4;

/** Adds the tabs of one textblock at `pos`. A code block's tabs are characters, not stops. */
function scanBlock(node: PMNode, pos: number, out: TabAt[]): void {
  if (node.type.spec.code) return;
  node.forEach((child, offset) => {
    if (!child.isText || !child.text) return;
    for (let at = child.text.indexOf('\t'); at !== -1; at = child.text.indexOf('\t', at + 1)) {
      out.push({ pos: pos + 1 + offset + at, blockPos: pos });
    }
  });
}

/** The tabs of a whole document, by position. Only the first state and a remeasure walk it all. */
function tabsOf(doc: PMNode): TabAt[] {
  const found: TabAt[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    scanBlock(node, pos, found);
    return false;
  });
  return found;
}

/** The ranges of the new document that a transaction changed. */
function changedRanges(tr: Transaction): [number, number][] {
  const ranges: [number, number][] = [];
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      ranges.push([rest.map(newStart, -1), rest.map(newEnd, 1)]);
    });
  });
  return ranges;
}

/** The textblocks that touch the changed ranges: their extent and their tabs. */
function rescan(doc: PMNode, ranges: readonly [number, number][]) {
  const spans: [number, number][] = [];
  const tabs: TabAt[] = [];
  const seen = new Set<number>();
  const size = doc.content.size;
  for (const [from, to] of ranges) {
    doc.nodesBetween(Math.max(0, from - 1), Math.min(size, to + 1), (node, pos) => {
      if (!node.isTextblock) return true;
      if (!seen.has(pos)) {
        seen.add(pos);
        spans.push([pos, pos + node.nodeSize]);
        scanBlock(node, pos, tabs);
      }
      return false;
    });
  }
  return { spans, tabs };
}

function tabDecoration(pos: number, known: Width | undefined): Decoration {
  const attrs: Record<string, string> = { class: styles.tab, 'data-tab': '' };
  if (known) {
    attrs.style = `width: ${known.px.toFixed(2)}px`;
    if (known.leader !== 'none') attrs['data-leader'] = known.leader;
  }
  return Decoration.inline(pos, pos + 1, attrs);
}

const byPos = (a: TabAt, b: TabAt) => a.pos - b.pos;

export function blocksOf(tabs: readonly TabAt[]): Map<number, number> {
  return new Map(tabs.map((tab) => [tab.blockPos, MAX_PASSES]));
}

export function initial(doc: PMNode): TabState {
  const tabs = tabsOf(doc);
  const decorations = DecorationSet.create(
    doc,
    tabs.map((tab) => tabDecoration(tab.pos, undefined)),
  );
  return { tabs, widths: new Map(), decorations, dirty: blocksOf(tabs) };
}

/** The state moved through a change. Only the paragraphs the change touched are scanned and marked to measure. */
export function mapState(tr: Transaction, old: TabState): TabState {
  const scan = rescan(tr.doc, changedRanges(tr));
  const scanned = (pos: number) => scan.spans.some(([from, to]) => pos > from && pos < to);
  const moved = new Map<number, Width>();
  for (const [pos, width] of old.widths) {
    const mapped = tr.mapping.mapResult(pos, 1);
    if (!mapped.deleted) moved.set(mapped.pos, width);
  }
  const tabs: TabAt[] = [];
  for (const tab of old.tabs) {
    const mapped = tr.mapping.mapResult(tab.pos, 1);
    if (mapped.deleted || scanned(mapped.pos)) continue;
    tabs.push({ pos: mapped.pos, blockPos: tr.mapping.map(tab.blockPos, 1) });
  }
  tabs.push(...scan.tabs);
  tabs.sort(byPos);
  const widths = new Map<number, Width>();
  for (const tab of tabs) {
    const width = moved.get(tab.pos);
    if (width) widths.set(tab.pos, width);
  }
  const dirty = new Map<number, number>();
  for (const [blockPos, passes] of old.dirty) {
    const mapped = tr.mapping.mapResult(blockPos, 1);
    if (!mapped.deleted) dirty.set(mapped.pos, passes);
  }
  for (const tab of scan.tabs) dirty.set(tab.blockPos, MAX_PASSES);
  let decorations = old.decorations.map(tr.mapping, tr.doc);
  for (const [from, to] of scan.spans) {
    const stale = decorations.find(from, to);
    if (stale.length > 0) decorations = decorations.remove(stale);
  }
  if (scan.tabs.length > 0) {
    decorations = decorations.add(
      tr.doc,
      scan.tabs.map((tab) => tabDecoration(tab.pos, widths.get(tab.pos))),
    );
  }
  return { tabs, widths, decorations, dirty };
}

/** The state with a frame's widths. A paragraph whose widths moved is measured again, until its passes run out. */
export function applyMeasurement(doc: PMNode, old: TabState, measured: Measurement): TabState {
  const widths = new Map(old.widths);
  for (const [pos, width] of measured.widths) widths.set(pos, width);
  const dirty = new Map(old.dirty);
  let decorations = old.decorations;
  for (const [blockPos, moved] of measured.blocks) {
    const left = (dirty.get(blockPos) ?? 1) - 1;
    if (moved && left > 0) dirty.set(blockPos, left);
    else dirty.delete(blockPos);
    const block = moved ? doc.nodeAt(blockPos) : null;
    if (!block) continue;
    const from = blockPos;
    const to = blockPos + block.nodeSize;
    decorations = decorations.remove(decorations.find(from, to));
    const fresh = old.tabs.filter((tab) => tab.blockPos === blockPos);
    decorations = decorations.add(
      doc,
      fresh.map((tab) => tabDecoration(tab.pos, widths.get(tab.pos))),
    );
  }
  return { ...old, widths, dirty, decorations };
}
