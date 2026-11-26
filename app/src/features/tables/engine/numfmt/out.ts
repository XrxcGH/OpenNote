// The text a section writes, and where a `*` fill goes.

import type { Token } from './types';

export class Out {
  text = '';
  fill: { char: string; at: number } | null = null;

  push(s: string): void {
    this.text += s;
  }

  /** Writes a literal, a `_x` space, or a `*x` fill. Returns false for any other token. */
  token(t: Token): boolean {
    if (t.t === 'lit') this.text += t.s;
    else if (t.t === 'skip') this.text += ' ';
    else if (t.t === 'fill') {
      if (!this.fill) this.fill = { char: t.c, at: this.text.length };
    } else return false;
    return true;
  }
}
