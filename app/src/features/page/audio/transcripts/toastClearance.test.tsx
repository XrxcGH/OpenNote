// A toast such as "The transcript is ready" must not cover the transcript's last line or its footer (VB-183).
import { afterEach, describe, expect, it } from 'vitest';
import '../../../../styles/base.css';
import styles from './transcripts.module.css';

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.style.removeProperty('--toast-height');
});

describe('the transcript panel under a toast', () => {
  it('keeps the toast clearance at the bottom of its lines and of the panel', () => {
    document.documentElement.style.setProperty('--toast-height', '64px');
    const card = document.createElement('section');
    card.className = styles.card!;
    const lines = document.createElement('ol');
    lines.className = styles.lines!;
    card.append(lines);
    document.body.append(card);
    // 64 px of toast and 16 px of gap (--space-4).
    const clearance = parseFloat(getComputedStyle(document.documentElement).scrollPaddingBlockEnd);
    expect(clearance).toBeGreaterThanOrEqual(64);
    expect(parseFloat(getComputedStyle(lines).scrollPaddingBlockEnd)).toBe(clearance);
    expect(parseFloat(getComputedStyle(card).scrollMarginBlockEnd)).toBe(clearance);
  });
});
