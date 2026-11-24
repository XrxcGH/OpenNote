import { describe, expect, it } from 'vitest';
import { renderUi } from '../test';
import { PathText, displayPath } from './PathText';

describe('a folder path for display (W9-VA-16)', () => {
  it('uses one kind of separator for a Windows path', () => {
    expect(displayPath('C:/Users/Ada\\Documents/OpenNote')).toBe('C:\\Users\\Ada\\Documents\\OpenNote');
    expect(displayPath('/home/ada/notes')).toBe('/home/ada/notes');
  });

  it('keeps the text whole and offers a break after each separator', () => {
    const view = renderUi(
      <p>
        <PathText path="C:/Users/Ada/Documents/OpenNote" />
      </p>,
    );
    const p = view.container.querySelector('p')!;
    expect(p.textContent).toBe('C:\\Users\\Ada\\Documents\\OpenNote');
    expect(p.querySelectorAll('wbr')).toHaveLength(4);
  });
});
