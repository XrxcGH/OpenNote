// Scrolling math joins the Tab order as a named group only while it overflows, and notices when its content grows
// after it was laid out (the span's own box does not change then, so only the content is watched).
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderUi } from '../../../test';
import { ScrollMath } from './ScrollMath';

describe('ScrollMath', () => {
  it('stays out of the Tab order while its math fits', () => {
    renderUi(
      <div style={{ inlineSize: 300 }}>
        <ScrollMath className="m" html='<span class="k" style="display:inline-block;inline-size:50px">x</span>' />
      </div>,
    );
    const el = document.querySelector('.m')!;
    expect(el.hasAttribute('tabindex')).toBe(false);
    expect(el.getAttribute('role')).toBeNull();
  });

  it('becomes a named, focusable group when its content grows later', async () => {
    renderUi(
      <div style={{ inlineSize: 100 }}>
        <ScrollMath
          as="div"
          className="m"
          html='<span class="k" style="display:inline-block;inline-size:50px;block-size:10px">x</span>'
        />
      </div>,
    );
    const el = document.querySelector<HTMLElement>('.m')!;
    el.style.overflowX = 'auto';
    expect(el.hasAttribute('tabindex')).toBe(false);
    // The span keeps its 100px box; only its child gets wider.
    document.querySelector<HTMLElement>('.k')!.style.inlineSize = '400px';
    await waitFor(() => expect(el.getAttribute('tabindex')).toBe('0'));
    expect(screen.getByRole('group', { name: 'Worked math, scrolls sideways' })).toBe(el);
  });
});
