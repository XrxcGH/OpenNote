// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { keepLinksInPlace } from './linkClicks';

function click(target: Element): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('links on the page', () => {
  it('never take the window to their address when clicked, until the page stops listening', () => {
    const container = document.body.appendChild(document.createElement('div'));
    container.innerHTML = '<p><a href="https://example.com"><strong>web</strong></a> <a>no address</a></p>';
    const stop = keepLinksInPlace(container);
    expect(click(container.querySelector('strong')!).defaultPrevented).toBe(true);
    expect(click(container.querySelectorAll('a')[1]).defaultPrevented).toBe(false);
    stop();
    expect(click(container.querySelector('strong')!).defaultPrevented).toBe(false);
  });
});
