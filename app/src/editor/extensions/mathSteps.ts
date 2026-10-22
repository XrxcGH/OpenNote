// The equation panel's Steps, drawn: a heading, the steps in order with each rule named, and the answer. A step that
// holds steps of its own folds open and closed, so long working stays short until it is wanted. Insert steps puts the
// whole working on the page as display math, below the equation. A question with no answer says why, calmly.
import { t } from '../../strings/t';
import type { MathStep, MathStepsView, MathSuggestion } from '../host';
import drawn from './mathDrawn.module.css';

/** Draws LaTeX as HTML, or null when it cannot be drawn. */
export type DrawLatex = (latex: string) => string | null;

function mathSpan(latex: string, draw: DrawLatex): HTMLElement {
  const span = document.createElement('span');
  span.className = drawn.stepMath;
  const html = draw(latex);
  if (html === null) span.textContent = latex;
  else span.innerHTML = html;
  return span;
}

function stepLine(step: MathStep, draw: DrawLatex): HTMLElement[] {
  const name = document.createElement('span');
  name.className = drawn.stepRule;
  name.textContent = step.name;
  name.title = step.rule;
  const parts: HTMLElement[] = [name, mathSpan(step.latex, draw)];
  if (step.note) {
    const note = mathSpan(step.note, draw);
    note.classList.add(drawn.stepNote);
    parts.push(note);
  }
  return parts;
}

function stepList(steps: readonly MathStep[], draw: DrawLatex, depth = 0): HTMLOListElement {
  const list = document.createElement('ol');
  for (const step of steps) {
    const item = document.createElement('li');
    item.setAttribute('aria-description', step.rule);
    if (step.children?.length) {
      const fold = document.createElement('details');
      // The outer steps start open; the working inside them starts folded.
      fold.open = depth === 0 && steps.length <= 2;
      const summary = document.createElement('summary');
      summary.append(...stepLine(step, draw));
      fold.append(summary, stepList(step.children, draw, depth + 1));
      item.append(fold);
    } else item.append(...stepLine(step, draw));
    list.append(item);
  }
  return list;
}

/** The Steps panel for a view. `insert` puts the working on the page; the button is left out without it. */
export function stepsPanel(view: MathStepsView, draw: DrawLatex, insert?: (block: string) => void): HTMLElement {
  const panel = document.createElement('section');
  panel.className = drawn.steps;
  panel.dataset.mathSteps = '';
  panel.setAttribute('aria-live', 'polite');
  if (!view.ok) {
    const message = document.createElement('p');
    message.textContent = view.message;
    panel.append(message);
    if (view.steps?.length) panel.append(stepList(view.steps, draw));
    return panel;
  }
  const heading = document.createElement('h4');
  heading.textContent = view.title;
  const result = document.createElement('p');
  result.className = drawn.stepResult;
  result.append(t('mathTools.steps.answerLabel'), ' ', mathSpan(view.result, draw));
  panel.append(heading, stepList(view.steps, draw), result);
  if (insert) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = drawn.toggle;
    button.textContent = t('mathTools.steps.insert');
    button.setAttribute('aria-label', t('mathTools.steps.insertLabel'));
    button.dataset.mathStepsInsert = '';
    // A press must not take focus from the field, or the field would close and save.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => insert(view.block));
    panel.append(button);
  }
  return panel;
}

/** The answer offered after a closed equation that ends in "=": pressing it adds the answer. */
export function suggestionButton(accept: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = drawn.suggestion;
  button.contentEditable = 'false';
  button.dataset.mathSuggestion = '';
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    accept();
  });
  return button;
}

export function fillSuggestion(button: HTMLElement, found: MathSuggestion, draw: DrawLatex): void {
  const html = draw(found.latex);
  if (html === null) button.textContent = found.text;
  else button.innerHTML = html;
  const label = t('mathTools.live.accept', { answer: found.text });
  button.title = label;
  button.setAttribute('aria-label', label);
}

/** The gray answer in the open field's preview, with the Tab key that adds it. */
export function previewGhost(found: MathSuggestion, draw: DrawLatex): HTMLElement {
  const ghost = document.createElement('span');
  ghost.className = drawn.ghost;
  ghost.dataset.mathGhost = '';
  ghost.append(mathSpan(found.latex, draw));
  const key = document.createElement('kbd');
  key.className = drawn.ghostKey;
  key.textContent = 'Tab';
  ghost.append(key);
  ghost.title = t('mathTools.live.suggestion', { answer: found.text });
  return ghost;
}
