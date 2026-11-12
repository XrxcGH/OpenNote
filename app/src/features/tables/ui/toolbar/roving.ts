// Arrow keys, Home, and End move focus between the buttons of a toolbar (APG toolbar pattern). A button is any
// element marked data-tool; one has tabIndex 0 and the rest -1, so Tab reaches the bar once and leaves it once.
import type { KeyboardEvent } from 'react';

/** The buttons of a bar, in order. */
export const toolsOf = (bar: HTMLElement): HTMLElement[] => [...bar.querySelectorAll<HTMLElement>('[data-tool]')];

/** Makes `active` the bar's one tab stop. With none given, it keeps the stop it has, or takes the first button. */
export function rove(bar: HTMLElement, active?: HTMLElement): void {
  const buttons = toolsOf(bar);
  const stop = active ?? buttons.find((button) => button.tabIndex === 0) ?? buttons[0];
  buttons.forEach((button) => (button.tabIndex = button === stop ? 0 : -1));
}

export function moveFocus(event: KeyboardEvent<HTMLElement>): void {
  const bar = event.currentTarget;
  const buttons = toolsOf(bar);
  const at = buttons.indexOf(document.activeElement as HTMLElement);
  if (at === -1) {
    // The Size box is the last field before the buttons: Right Arrow at the end of its text goes on into them.
    const field = event.target;
    if (event.key !== 'ArrowRight' || !(field instanceof HTMLInputElement) || !buttons.length) return;
    const inputs = [...bar.querySelectorAll('input')].filter(
      (input) => input.compareDocumentPosition(buttons[0]) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    if (
      inputs.at(-1) !== field ||
      field.selectionStart !== field.value.length ||
      field.selectionEnd !== field.value.length
    )
      return;
    event.preventDefault();
    const stop = buttons.find((button) => button.tabIndex === 0) ?? buttons[0];
    rove(bar, stop);
    stop.focus();
    return;
  }
  const next =
    event.key === 'ArrowRight'
      ? (at + 1) % buttons.length
      : event.key === 'ArrowLeft'
        ? (at - 1 + buttons.length) % buttons.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : -1;
  if (next === -1) return;
  event.preventDefault();
  rove(bar, buttons[next]);
  buttons[next].focus();
}
