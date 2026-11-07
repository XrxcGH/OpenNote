// The rows of the open font list: a section header, then its fonts. Theme first, then Recent, then All.
import { t } from '../../strings/t';
import type { FontCatalog } from './service';
import { THEME_TOKENS } from './service';

export type Row =
  | { kind: 'header'; id: string; text: string }
  | { kind: 'option'; id: string; name: string; label: string; hint: string | null };

export function buildRows(catalog: FontCatalog): Row[] {
  const rows: Row[] = [{ kind: 'header', id: 'h-theme', text: t('textFonts.sectionTheme') }];
  const labels = {
    '+body': t('textFonts.themeBody'),
    '+heading': t('textFonts.themeHeading'),
    '+mono': t('textFonts.themeMono'),
  } as const;
  for (const token of THEME_TOKENS) {
    const target = catalog.theme[token.slice(1) as keyof typeof catalog.theme];
    rows.push({ kind: 'option', id: `t-${token}`, name: token, label: target, hint: labels[token] });
  }
  if (catalog.recent.length > 0) {
    rows.push({ kind: 'header', id: 'h-recent', text: t('textFonts.sectionRecent') });
    catalog.recent.forEach((name) => rows.push({ kind: 'option', id: `r-${name}`, name, label: name, hint: null }));
  }
  rows.push({ kind: 'header', id: 'h-all', text: t('textFonts.sectionAll') });
  for (const family of catalog.families) {
    rows.push({ kind: 'option', id: `a-${family.name}`, name: family.name, label: family.name, hint: null });
  }
  return rows;
}

/**
 * The row that type-ahead lands on. It is the first font in All that starts with the text, else the first that
 * contains it. Names compare without case. The result is -1 when nothing matches or the text is empty.
 */
export function typeAheadIndex(rows: readonly Row[], text: string): number {
  const wanted = text.trim().toLowerCase();
  if (wanted === '') return -1;
  const all = rows.findIndex((row) => row.kind === 'header' && row.id === 'h-all');
  const from = all < 0 ? 0 : all;
  const at = (test: (name: string) => boolean) =>
    rows.findIndex((row, i) => i >= from && row.kind === 'option' && test(row.label.toLowerCase()));
  const starts = at((name) => name.startsWith(wanted));
  return starts >= 0 ? starts : at((name) => name.includes(wanted));
}

/** How many fonts match the text, for the live result count. */
export function matchCount(rows: readonly Row[], text: string): number {
  const wanted = text.trim().toLowerCase();
  const all = rows.findIndex((row) => row.kind === 'header' && row.id === 'h-all');
  return rows.filter(
    (row, i) => i > all && row.kind === 'option' && (wanted === '' || row.label.toLowerCase().includes(wanted)),
  ).length;
}
