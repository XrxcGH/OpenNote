// The marks Check my work puts beside the lines: a layer over the page (never ink, never part of the note), one mark
// per checked step, and a small summary card with what needs a look, Check again, and Dismiss. The marks are buttons
// with their whole finding as their name, so a keyboard, a pen, a finger, and a screen reader all reach them.
import type { StepResult } from '../../math';
import type { MessageKey } from '../../../strings/t';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import type { MountedPage } from '../mount';
import type { GatheredLine } from './gather';
import styles from './stepCheck.module.css';

export interface ShownCheck {
  lines: readonly GatheredLine[];
  results: readonly StepResult[];
}

interface Shown {
  layer: HTMLElement;
  panel: HTMLElement;
  stop: () => void;
  /** Where focus was when the card opened (the editor), given back when it is dismissed. */
  back: HTMLElement | null;
}

let shown: Shown | null = null;

/** The reason's sentence, with its values. */
export function reasonText(result: StepResult): string {
  const key = `stepCheck.reasons.${result.reason}` as MessageKey;
  return (t as (key: MessageKey, values?: Record<string, string>) => string)(key, { ...result.params });
}

/** Unchecked steps whose reason is itself a finding, such as a dropped solution: no "I could not check" before it. */
const NOTED = new Set<string>(['lostSolutions', 'someValues', 'outsideDomain', 'ambiguous', 'neverEqual']);

function markLabel(result: StepResult, number: number): string {
  if (result.method === 'given') return t('stepCheck.mark.given', { number });
  const reason = reasonText(result);
  if (result.verdict === 'ok') return `${t('stepCheck.mark.ok', { number })} ${reason}`;
  const label =
    result.verdict === 'broken'
      ? t('stepCheck.mark.broken', { number, reason })
      : t(NOTED.has(result.reason) ? 'stepCheck.mark.noted' : 'stepCheck.mark.unchecked', { number, reason });
  return result.suggestion ? `${label} ${t('stepCheck.panel.suggestion', { line: result.suggestion })}` : label;
}

const GLYPH: Record<StepResult['verdict'], string> = { ok: '✓', broken: '!', unchecked: '?' };

/** Takes the marks and the card away. */
export function dismissMarks(): void {
  if (!shown) return;
  const { back, panel } = shown;
  shown.stop();
  shown.layer.remove();
  // Focus goes back to where it was only when it was in the card; never taken from somewhere the person moved to.
  const doc = panel.ownerDocument;
  const inCard = panel.contains(doc.activeElement) || doc.activeElement === doc.body;
  panel.remove();
  shown = null;
  if (inCard && back?.isConnected) back.focus({ preventScroll: true });
}

export function marksShown(): boolean {
  return shown !== null;
}

function summaryText(results: readonly StepResult[]): string {
  const steps = results.filter((r) => r.method !== 'given');
  if (steps.length === 0) return t('stepCheck.panel.nothing');
  const ok = steps.filter((r) => r.verdict === 'ok').length;
  const broken = steps.filter((r) => r.verdict === 'broken').length;
  const unchecked = steps.filter((r) => r.verdict === 'unchecked').length;
  const counts = t('stepCheck.panel.summary', { ok, broken, unchecked });
  return broken === 0 && unchecked === 0 ? `${counts} ${t('stepCheck.panel.allGood')}` : counts;
}

function button(doc: Document, label: string, run: () => void): HTMLButtonElement {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = styles.action;
  b.textContent = label;
  b.addEventListener('click', run);
  return b;
}

/** The mark beside one line: a button named with its finding, which takes focus to that finding in the card. */
function markButton(
  doc: Document,
  result: StepResult,
  i: number,
  line: GatheredLine,
  item: () => HTMLElement | undefined,
): HTMLButtonElement {
  const mark = doc.createElement('button');
  mark.type = 'button';
  mark.className = styles.mark;
  mark.dataset.stepMark = result.method === 'given' ? 'given' : result.verdict;
  const label = markLabel(result, i + 1);
  mark.setAttribute('aria-label', label);
  mark.title = label;
  const glyph = doc.createElement('span');
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = result.method === 'given' ? '·' : GLYPH[result.verdict];
  mark.append(glyph);
  const height = Math.max(16, line.box.y1 - line.box.y0);
  Object.assign(mark.style, {
    left: `${line.box.x1 + 8}px`,
    top: `${line.box.y0 + height / 2}px`,
  });
  mark.addEventListener('click', () => {
    const found = item();
    if (!found) return announce(label);
    found.focus();
    found.scrollIntoView({ block: 'nearest' });
  });
  return mark;
}

/** Shows the marks beside the lines and the summary card. `recheck` reads the lines again and checks them. */
export function showMarks(mounted: MountedPage, check: ShownCheck, recheck: () => void): void {
  dismissMarks();
  const doc = mounted.viewport.world.ownerDocument;
  const layer = doc.createElement('div');
  layer.className = styles.layer;
  layer.dataset.stepCheck = '';
  const panel = doc.createElement('section');
  panel.className = styles.panel;
  panel.dataset.stepCheckPanel = '';
  panel.setAttribute('aria-label', t('stepCheck.panel.title'));
  const items = new Map<number, HTMLElement>();

  const heading = doc.createElement('h2');
  heading.className = styles.title;
  heading.textContent = t('stepCheck.panel.title');
  heading.tabIndex = -1;
  const summary = doc.createElement('p');
  summary.className = styles.summary;
  summary.textContent = summaryText(check.results);
  const list = doc.createElement('ol');
  list.className = styles.list;
  check.results.forEach((result, i) => {
    if (result.method === 'given' || result.verdict === 'ok') return;
    const item = doc.createElement('li');
    item.className = styles.item;
    item.dataset.verdict = result.verdict;
    item.tabIndex = -1;
    const name = doc.createElement('strong');
    name.textContent = t('stepCheck.panel.line', { number: i + 1 });
    const why = doc.createElement('span');
    why.textContent = ` ${reasonText(result)}`;
    item.append(name, why);
    if (result.suggestion) {
      const fix = doc.createElement('code');
      fix.className = styles.fix;
      fix.textContent = t('stepCheck.panel.suggestion', { line: result.suggestion });
      item.append(fix);
    }
    items.set(i, item);
    list.append(item);
  });
  const sampled = check.results.some((r) => r.method === 'numeric' && r.verdict === 'ok');
  const foot = doc.createElement('p');
  foot.className = styles.foot;
  foot.textContent = sampled
    ? `${t('stepCheck.panel.offline')} ${t('stepCheck.panel.numeric')}`
    : t('stepCheck.panel.offline');
  const actions = doc.createElement('div');
  actions.className = styles.actions;
  actions.append(
    button(doc, t('stepCheck.panel.recheck'), recheck),
    button(doc, t('stepCheck.panel.dismiss'), dismissMarks),
  );
  panel.append(heading, summary, list, foot, actions);

  check.results.forEach((result, i) => {
    const line = check.lines[i];
    if (line) layer.append(markButton(doc, result, i, line, () => items.get(i)));
  });

  // Escape dismisses from anywhere while the marks are shown, not only from inside the card.
  const onKey = (event: KeyboardEvent) => {
    const inDialog = event.target instanceof Element && event.target.closest('dialog, [role="dialog"]') !== null;
    if (event.key === 'Escape' && !event.defaultPrevented && !inDialog) {
      event.stopPropagation();
      dismissMarks();
    }
  };
  const active = doc.activeElement;
  const back =
    active instanceof HTMLElement && active !== doc.body && !active.closest('[data-step-check-panel]') ? active : null;
  doc.addEventListener('keydown', onKey);
  mounted.viewport.world.append(layer);
  doc.body.append(panel);
  shown = { layer, panel, back, stop: () => doc.removeEventListener('keydown', onKey) };
  announce(summary.textContent);
  // The card is last on the page: focus moves to its heading so a keyboard reaches the findings at once.
  heading.focus({ preventScroll: true });
}
