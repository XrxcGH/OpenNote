// Arrow keys, Home, and End move focus between the buttons of a toolbar (APG toolbar pattern). A button is any
// element marked data-tool; one has tabIndex 0 and the rest -1.
import type { KeyboardEvent } from 'react';

export function moveFocus(event: KeyboardEvent<HTMLElement>): void {
  const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-tool]')];
  const at = buttons.indexOf(document.activeElement as HTMLElement);
  if (at === -1) return;
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
  buttons.forEach((button, i) => (button.tabIndex = i === next ? 0 : -1));
  buttons[next].focus();
}
