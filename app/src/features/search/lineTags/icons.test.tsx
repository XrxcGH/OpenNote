// The line tag icons are one family: each fills about the same share of its 24 unit box and sits in its middle.

import { afterEach, describe, expect, it } from 'vitest';
import { KNOWN_TAGS, tagIcon } from './defs';

afterEach(() => {
  document.body.replaceChildren();
});

describe('the line tag icons', () => {
  it.each([...KNOWN_TAGS, 'my own tag'])('draws the %s icon as large as the others and in the middle', (tag) => {
    const icon = tagIcon(tag);
    document.body.append(icon);
    const box = (icon.querySelector('path') as SVGPathElement).getBBox();
    // The family spans 15 to 18 units: a square reads larger than a circle of the same span, and a diagonal
    // pencil runs longer than its box.
    expect(Math.max(box.width, box.height)).toBeGreaterThanOrEqual(15);
    expect(Math.max(box.width, box.height)).toBeLessThanOrEqual(18.01);
    // 0.6 units is a third of a pixel at 14 px; a star's points sit a little high of its box's middle.
    expect(Math.abs(box.x + box.width / 2 - 12)).toBeLessThanOrEqual(0.6);
    expect(Math.abs(box.y + box.height / 2 - 12)).toBeLessThanOrEqual(0.6);
  });
});
