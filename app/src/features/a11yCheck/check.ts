// The accessibility checker (docs/FEATURES.md, "Accessibility checker"). It reads a page as the page service gives
// it and lists what makes the page hard to use with a screen reader, a keyboard, or low vision: images with no
// description, skipped heading levels, tables without a header row, text colors that are hard to read, meaning
// that only color carries, and free-form pages with no reading order. Each problem carries the edit that fixes
// it, so the report can apply the fix with one press. Nothing here changes a page.

import type { BlockJson, Edit, PageJson } from '../../services/pages/types';

export type IssueKind = 'imageAlt' | 'headingSkip' | 'tableHeader' | 'lowContrast' | 'colorOnly' | 'readingOrder';

/** How an issue gets fixed: ready-made edits, or edits that need some text from the person. */
export type Fix =
  { readonly kind: 'edits'; readonly edits: readonly Edit[] } | { readonly kind: 'imageAlt'; readonly block: string };

export interface Issue {
  readonly id: string;
  readonly kind: IssueKind;
  readonly block: string | null;
  /** Message parameters: a heading level, a color, and so on. */
  readonly params: Readonly<Record<string, string | number>>;
  readonly fix: Fix;
}

const HEADING = /^(#{1,6})\s+\S/;
const COLOR_SPAN = /<span\s+[^>]*data-color="([^"]+)"[^>]*>(.*?)<\/span>/gs;
const EMPHASIS = /\*\*|__|<u>|<mark|<strong|<em>|(^|\s)\*\S|(^|\s)_\S/;

/** WCAG relative luminance of an sRGB color given as #rrggbb or #rgb. Null for anything else. */
export function luminance(hex: string): number | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const full = match[1].length === 3 ? [...match[1]].map((c) => c + c).join('') : match[1];
  const channels = [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio of two colors, from 1 to 21, or null when either isn't a hex color. */
export function contrast(a: string, b: string): number | null {
  const one = luminance(a);
  const two = luminance(b);
  if (one === null || two === null) return null;
  const [light, dark] = one > two ? [one, two] : [two, one];
  return (light + 0.05) / (dark + 0.05);
}

/** The lowest contrast ratio that passes for body text (WCAG 2.2, 1.4.3). */
export const MIN_CONTRAST = 4.5;
const PAGE_WHITE = '#ffffff';

function textOf(block: BlockJson): string {
  const markdown = block.data.markdown;
  return typeof markdown === 'string' ? markdown : '';
}

/** The blocks in the order a reader meets them: the page's reading order, else top to bottom and left to right. */
export function readingBlocks(page: PageJson): BlockJson[] {
  const preferred = page.view.readingOrder ?? [];
  const rank = new Map(preferred.map((id, i) => [id as string, i]));
  const place = (block: BlockJson) => [block.frame?.y ?? 0, block.frame?.x ?? 0] as const;
  return [...page.blocks].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra !== undefined || rb !== undefined) return (ra ?? Infinity) - (rb ?? Infinity);
    const [ay, ax] = place(a);
    const [by, bx] = place(b);
    return ay - by || ax - bx || a.order.localeCompare(b.order);
  });
}

function headingIssues(blocks: readonly BlockJson[]): Issue[] {
  const issues: Issue[] = [];
  // The page title is the first level, so the first heading in the text may be level 2.
  let previous = 1;
  for (const block of blocks) {
    if (block.type !== 'text') continue;
    const lines = textOf(block).split('\n');
    let changed = false;
    lines.forEach((line, index) => {
      const level = HEADING.exec(line)?.[1].length;
      if (!level) return;
      if (level > previous + 1) {
        const fixed = previous + 1;
        lines[index] = line.replace(/^#{1,6}/, '#'.repeat(fixed));
        changed = true;
        issues.push({
          id: `${block.id}:heading:${index}`,
          kind: 'headingSkip',
          block: block.id,
          params: { from: previous, to: level, fixed },
          // Applied together below, so two skips in one block fix in one edit.
          fix: { kind: 'edits', edits: [] },
        });
        previous = fixed;
      } else {
        previous = level;
      }
    });
    if (changed) {
      const edit: Edit = { edit: 'setText', block: block.id, markdown: lines.join('\n') };
      for (
        let i = issues.length - 1;
        i >= 0 && issues[i].block === block.id && issues[i].kind === 'headingSkip';
        i -= 1
      ) {
        issues[i] = { ...issues[i], fix: { kind: 'edits', edits: [edit] } };
      }
    }
  }
  return issues;
}

function colorIssues(blocks: readonly BlockJson[]): Issue[] {
  const issues: Issue[] = [];
  for (const block of blocks) {
    if (block.type !== 'text') continue;
    const markdown = textOf(block);
    const spans = [...markdown.matchAll(COLOR_SPAN)];
    const weak = spans.find((span) => {
      const ratio = contrast(span[1], PAGE_WHITE);
      return ratio !== null && ratio < MIN_CONTRAST;
    });
    if (weak) {
      const cleaned = markdown.replace(COLOR_SPAN, (all, color: string, inner: string) =>
        (contrast(color, PAGE_WHITE) ?? 21) < MIN_CONTRAST ? inner : all,
      );
      issues.push({
        id: `${block.id}:contrast`,
        kind: 'lowContrast',
        block: block.id,
        params: { color: weak[1], ratio: Number((contrast(weak[1], PAGE_WHITE) ?? 0).toFixed(1)) },
        fix: { kind: 'edits', edits: [{ edit: 'setText', block: block.id, markdown: cleaned }] },
      });
    }
    const colors = new Set(spans.map((span) => span[1]));
    if (colors.size >= 2 && !EMPHASIS.test(markdown.replace(COLOR_SPAN, '$2'))) {
      const bolded = markdown.replace(
        COLOR_SPAN,
        (_all, color: string, inner: string) => `<span data-color="${color}">**${inner}**</span>`,
      );
      issues.push({
        id: `${block.id}:colorOnly`,
        kind: 'colorOnly',
        block: block.id,
        params: { count: colors.size },
        fix: { kind: 'edits', edits: [{ edit: 'setText', block: block.id, markdown: bolded }] },
      });
    }
  }
  return issues;
}

function objectIssues(blocks: readonly BlockJson[]): Issue[] {
  const issues: Issue[] = [];
  for (const block of blocks) {
    if (block.type === 'image') {
      const alt = typeof block.data.alt === 'string' ? block.data.alt.trim() : '';
      if (!alt && block.data.decorative !== true) {
        issues.push({
          id: `${block.id}:alt`,
          kind: 'imageAlt',
          block: block.id,
          params: {},
          fix: { kind: 'imageAlt', block: block.id },
        });
      }
    }
    if (block.type === 'table') {
      const rows = Array.isArray(block.data.rows) ? block.data.rows.length : 0;
      if (rows > 1 && block.data.header !== true) {
        issues.push({
          id: `${block.id}:header`,
          kind: 'tableHeader',
          block: block.id,
          params: {},
          fix: { kind: 'edits', edits: [{ edit: 'patchBlock', block: block.id, data: { header: true } }] },
        });
      }
    }
  }
  return issues;
}

function orderIssues(page: PageJson): Issue[] {
  const framed = page.blocks.filter((block) => block.frame);
  if (page.view.layout !== 'freeform' || framed.length < 2 || (page.view.readingOrder?.length ?? 0) > 0) return [];
  const order = readingBlocks({ ...page, view: { ...page.view, readingOrder: [] } }).map((block) => block.id);
  return [
    {
      id: 'page:readingOrder',
      kind: 'readingOrder',
      block: null,
      params: { count: framed.length },
      fix: { kind: 'edits', edits: [{ edit: 'setPage', view: { readingOrder: order } }] },
    },
  ];
}

/** Every accessibility problem of a page, in the order a reader meets them. */
export function checkPage(page: PageJson): Issue[] {
  const blocks = readingBlocks(page);
  return [...objectIssues(blocks), ...headingIssues(blocks), ...colorIssues(blocks), ...orderIssues(page)];
}

/** The edits for a description the person typed, or for marking the image as decorative. */
export function imageAltEdits(block: string, alt: string, decorative: boolean): Edit[] {
  return [
    {
      edit: 'patchBlock',
      block,
      data: decorative ? { decorative: true, alt: '' } : { alt: alt.trim(), decorative: false },
    },
  ];
}
