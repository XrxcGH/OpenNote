// The page side of the tutor (ADR 0050): the panel docked at the right of the shown page, and the three ways in.
// Give me a hint takes the selected lines (lassoed handwriting, selected typed lines, or else the page's math
// lines), Explain this step takes a step that Check my work flagged, and Open the tutor opens the panel as it is.
// Only the lines the person picked reach the tutor; it never reads the rest of the page or the notebook.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { shownMedia } from '../images/shown';
import { pageSelection } from '../seams/selectionStore';
import { shownViewport } from '../viewport/viewport';
import { inkLines, inOrder, typedSelection, type GatheredLine } from '../stepcheck/gather';
import { shownCheck } from '../stepcheck/overlay';
import { endSession, explainMistake, loadMathKit, nextHint, setContext, TutorPanel, tutorStyles } from '../../tutor';
import type { Seed } from '../../tutor';

let panel: { host: HTMLElement; root: Root; returnTo: HTMLElement | null } | null = null;
let stopFollowing: (() => void) | null = null;

/** Puts the panel beside the shown page; it follows the page when another one opens, and keeps the conversation. */
function place(): boolean {
  const parent = shownViewport.get()?.viewport.parentElement;
  if (!panel || !parent) return false;
  if (panel.host.parentElement !== parent) parent.appendChild(panel.host);
  return true;
}

/** Opens the Tutor panel, or brings the focus to it when it is open. */
export async function openTutor(): Promise<void> {
  await loadMathKit();
  if (!panel) {
    const host = document.createElement('div');
    host.className = tutorStyles.host ?? '';
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel = { host, root: createRoot(host), returnTo };
    panel.root.render(createElement(TutorPanel, { onClose: closeTutor, onUseSelection: () => void takeSelection() }));
    stopFollowing = shownViewport.subscribe(() => void place());
  }
  if (!place()) document.body.appendChild(panel.host);
  const host = panel.host;
  requestAnimationFrame(() => host.querySelector<HTMLElement>('textarea, button:not(:disabled)')?.focus());
}

/** Closes the panel and ends the session: the conversation and every consent are forgotten. */
export function closeTutor(): void {
  if (!panel) return;
  const { host, root, returnTo } = panel;
  panel = null;
  stopFollowing?.();
  stopFollowing = null;
  const hadFocus = host.contains(document.activeElement);
  root.unmount();
  host.remove();
  endSession();
  if (hadFocus && returnTo?.isConnected) returnTo.focus({ preventScroll: true });
}

export function isTutorOpen(): boolean {
  return panel !== null;
}

const asText = async (lines: readonly GatheredLine[]): Promise<string[]> => {
  const { latexToLine } = await (await import('../../math')).loadStepCheck();
  return lines.map((line) => (line.format === 'latex' ? latexToLine(line.text) : line.text).trim());
};

/** The lines the person picked, as a seed with Check my work's verdicts, or null (and a calm message why). */
async function pickedLines(): Promise<(Seed & { text: string }) | null> {
  const mounted = shownMedia.get();
  if (!mounted) return null;
  const strokes = pageSelection.get().strokes;
  let lines: GatheredLine[];
  if (strokes.length > 0) {
    const read = await inkLines(strokes);
    if (!read.ok) {
      showToast({ message: t(read.reason === 'off' ? 'tutor.errors.handwritingOff' : 'tutor.errors.readFailed') });
      return null;
    }
    lines = read.lines;
  } else lines = typedSelection(mounted);
  const texts = (await asText(inOrder(lines))).filter((text) => text !== '');
  if (texts.length === 0) return null;
  const { checkSteps } = await (await import('../../math')).loadStepCheck();
  const steps = texts.map((text) => ({ text }));
  return { lines: steps, results: checkSteps(steps, { budgetMs: 1500 }), text: texts.join('\n') };
}

/** The panel's "Use selected lines". */
async function takeSelection(): Promise<void> {
  const picked = await pickedLines();
  if (!picked) {
    showToast({ message: t('tutor.errors.nothing') });
    return;
  }
  setContext(picked.text, picked);
  announce(t('tutor.panel.contextLabel'));
}

/** Give me a hint: the selected problem goes in front of the tutor, and the first rung shows. */
export async function hintForSelection(): Promise<void> {
  const picked = await pickedLines();
  await openTutor();
  if (picked) setContext(picked.text, picked);
  await nextHint();
}

/** Explain this step: the step Check my work flagged (or the first one it flagged), without the corrected line. */
export async function explainStep(index?: number): Promise<void> {
  const check = shownCheck();
  const texts = check ? await asText(check.lines) : [];
  const seed: (Seed & { text: string }) | null = check
    ? { lines: texts.map((text) => ({ text })), results: [...check.results], focus: index, text: texts.join('\n') }
    : await pickedLines();
  await openTutor();
  if (seed) setContext(seed.text, seed);
  await explainMistake();
}

/** Tests start over. */
export function resetTutor(): void {
  closeTutor();
}
