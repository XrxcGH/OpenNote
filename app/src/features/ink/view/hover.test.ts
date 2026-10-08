import { describe, expect, it } from 'vitest';
import { hoverCircle, isHovering } from './hoverShape';
import type { HoverInput } from './hoverShape';

const base: HoverInput = {
  enabled: true,
  tool: 'pen',
  penWidth: 2,
  eraserRadius: 4,
  strokeEraserPx: 6,
  zoom: 1,
};
const hover = { pointerType: 'pen', buttons: 0, pressure: 0 };

describe('the pen hover circle', () => {
  it('shows the tip width for a hovering pen, kept to the cursor limits', () => {
    expect(hoverCircle(hover, base)).toEqual({ kind: 'pen', diameter: 3 });
    expect(hoverCircle(hover, { ...base, penWidth: 100 })).toEqual({ kind: 'pen', diameter: 32 });
    expect(hoverCircle(hover, { ...base, penWidth: 10, zoom: 2 })).toEqual({ kind: 'pen', diameter: 20 });
  });

  it('shows the eraser size for the erasers, and a ring when it is large', () => {
    expect(hoverCircle(hover, { ...base, tool: 'eraser' })).toEqual({ kind: 'eraser', diameter: 12, ring: false });
    expect(hoverCircle(hover, { ...base, tool: 'partialEraser', eraserRadius: 100 })).toEqual({
      kind: 'eraser',
      diameter: 200,
      ring: true,
    });
  });

  it('shows nothing when off, for touch and mouse, for a pen in contact, or for other tools', () => {
    expect(hoverCircle(hover, { ...base, enabled: false })).toBeNull();
    expect(hoverCircle({ ...hover, pointerType: 'touch' }, base)).toBeNull();
    expect(hoverCircle({ ...hover, pointerType: 'mouse' }, base)).toBeNull();
    expect(hoverCircle({ ...hover, pressure: 0.4, buttons: 1 }, base)).toBeNull();
    expect(hoverCircle({ ...hover, buttons: 2 }, base)).toBeNull();
    expect(hoverCircle(hover, { ...base, tool: 'lasso' })).toBeNull();
    expect(isHovering(hover)).toBe(true);
  });
});
