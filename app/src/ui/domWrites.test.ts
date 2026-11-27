// @vitest-environment jsdom
// The DOM writes that skip a value the element already has (domWrites.ts). The browser counts an unchanged write as a
// change: a mutation observer gets a record for it, as the browser restyles for it.
import { afterEach, describe, expect, it } from 'vitest';
import { setAttr, setData, setHidden, setStyle, setText, toggleAttr } from './domWrites';

const watched: MutationObserver[] = [];
afterEach(() => watched.splice(0).forEach((observer) => observer.disconnect()));

/** Records every write to `el` and its children from now on. */
function watch(el: Node): () => MutationRecord[] {
  const observer = new MutationObserver(() => {});
  observer.observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
  watched.push(observer);
  return () => observer.takeRecords();
}

describe('DOM writes', () => {
  it('write nothing when the element already has the value', () => {
    const el = document.createElement('div');
    el.hidden = true;
    el.setAttribute('aria-label', 'Table');
    el.toggleAttribute('data-touch', true);
    el.dataset.density = 'mouse';
    el.style.setProperty('--scrollbar-inline', '12px');
    el.textContent = '2 selected';
    const records = watch(el);
    setHidden(el, true);
    setAttr(el, 'aria-label', 'Table');
    toggleAttr(el, 'data-touch', true);
    toggleAttr(el, 'data-more', false);
    setData(el, 'density', 'mouse');
    setData(el, 'fold', undefined);
    setStyle(el, '--scrollbar-inline', '12px');
    setText(el, '2 selected');
    expect(records()).toEqual([]);
  });

  it('write what changed', () => {
    const el = document.createElement('div');
    el.dataset.fold = '-';
    setHidden(el, true);
    setAttr(el, 'aria-label', 'Table');
    toggleAttr(el, 'data-touch', true);
    setData(el, 'density', 'touch');
    setData(el, 'fold', undefined);
    setStyle(el, 'left', '4px');
    setText(el, '3 selected');
    expect(el.hidden).toBe(true);
    expect(el.getAttribute('aria-label')).toBe('Table');
    expect(el.hasAttribute('data-touch')).toBe(true);
    expect(el.dataset.density).toBe('touch');
    expect('fold' in el.dataset).toBe(false);
    expect(el.style.left).toBe('4px');
    expect(el.textContent).toBe('3 selected');
  });
});
