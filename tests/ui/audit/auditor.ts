// The auditor: measures the surface the page shows now, saves a screenshot, and keeps the findings (see README.md).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { cellName, slug } from './cells';
import type { Cell } from './cells';
import { measureLayout } from './measure';
import type { FindingKind } from './measure';

/** Where per-cell results go. The ratchet spec merges them. Set OPENNOTE_AUDIT_OUT to keep them elsewhere. */
export const OUT_DIR = process.env.OPENNOTE_AUDIT_OUT ?? join(import.meta.dirname, 'out');
/** Screenshots are saved only when a folder is named, so CI skips the cost. */
export const SHOTS_DIR = process.env.OPENNOTE_AUDIT_SHOTS ?? '';

export interface Finding {
  surface: string;
  kind: FindingKind;
  selector: string;
  detail: string;
  text?: string;
  /** The cells (size, theme, density) where it occurs. */
  cells: string[];
  screenshot?: string;
}

export class Auditor {
  readonly findings = new Map<string, Finding>();
  readonly surfaces: string[] = [];

  constructor(
    private readonly page: Page,
    private readonly cell: Cell,
  ) {}

  /** Waits for fades and mounting to finish. */
  async settle(): Promise<void> {
    await this.page.evaluate(async () => {
      const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));
      await document.fonts.ready;
      await frame();
      await new Promise<void>((done) => setTimeout(done, 120));
      for (const animation of document.getAnimations()) {
        if (animation.effect?.getComputedTiming().iterations !== Infinity)
          await animation.finished.catch(() => undefined);
      }
      await frame();
    });
  }

  /** Measures one surface. `scope` limits the element checks to the inside of a selector. */
  async visit(surface: string, scope: string | null = null): Promise<number> {
    await this.settle();
    this.surfaces.push(surface);
    if (process.env.OPENNOTE_AUDIT_TRACE) console.log(`[audit] ${new Date().toISOString().slice(14, 23)} ${surface}`);
    const raw = await this.page.evaluate(measureLayout, { scope });
    if (process.env.OPENNOTE_AUDIT_TRACE) console.log(`[audit]   measured ${raw.length}`);
    let shot: string | undefined;
    if (SHOTS_DIR && (this.cell.density === 'mouse' || raw.length > 0)) {
      const name = `${slug(surface)}-${this.cell.theme}-${this.cell.size.id}${this.cell.density === 'touch' ? '-touch' : ''}.png`;
      mkdirSync(SHOTS_DIR, { recursive: true });
      shot = join(SHOTS_DIR, name);
      await this.page.screenshot({ path: shot, scale: 'css', timeout: 10_000 }).catch(() => undefined);
    }
    for (const one of raw) {
      const key = `${surface}|${one.kind}|${one.selector}`;
      const have = this.findings.get(key);
      if (have) {
        if (!have.cells.includes(cellName(this.cell))) have.cells.push(cellName(this.cell));
        continue;
      }
      this.findings.set(key, { surface, ...one, cells: [cellName(this.cell)], screenshot: shot });
    }
    return raw.length;
  }

  save(): void {
    mkdirSync(OUT_DIR, { recursive: true });
    const body = { cell: cellName(this.cell), surfaces: this.surfaces, findings: [...this.findings.values()] };
    writeFileSync(join(OUT_DIR, `cell-${slug(cellName(this.cell))}.json`), JSON.stringify(body, null, 1));
  }
}
