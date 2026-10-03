// Insert space: drag a line across the page and everything below it moves with the pen, ink, floating text, and images
// together. Drag down to open a gap, up to close one. Locked items stay, and a stroke that crosses the line stays.
// One undo reverses the whole move. The "Insert space" command does the same from the keyboard with a height.
import { isEnabled } from '../../../app/flags';
import type { Edit } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { compose } from '../geometry/matrix';
import type { Matrix } from '../geometry/types';
import { planInsertSpace, sheetPush, spaceAmount } from '../space';
import type { BlockFrame, InsertSpacePlan } from '../space';
import type { InkStroke } from '../model/types';
import { ask } from './ask';
import type { InkHost } from './host';
import { brandColor } from './paint';
import type { InkSurface } from './surface';

/** Previews move the strokes themselves up to this many; a bigger page shows the line and the blocks only. */
const PREVIEW_LIMIT = 400;
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

interface Floating {
  readonly frame: BlockFrame;
  readonly height: number;
}

/** The blocks that sit at their own place on the page: the ones that can move. Flowing text stays in its column. */
function floating(host: InkHost): Floating[] {
  const layer = host.layer.get();
  if (!layer) return [];
  return layer.blocks().flatMap((block): Floating[] => {
    const y = block.frame?.y;
    if (block.type === 'ink' || y === undefined || block.frame?.x === undefined) return [];
    const height = layer.view(block.id)?.measure().h ?? 0;
    return [{ frame: { id: block.id, top: y, locked: block.lock !== undefined }, height }];
  });
}

function plan(host: InkHost, surface: InkSurface, y: number, dy: number): InsertSpacePlan {
  const layer = host.layer.get();
  return planInsertSpace(surface.index, y, dy, {
    blocks: floating(host).map((item) => item.frame),
    locked: (stroke) => layer?.block((stroke as InkStroke).block)?.lock !== undefined,
  });
}

/** The edits that move the blocks of a plan, pushing each past a sheet break when the page is paginated. */
function blockEdits(host: InkHost, planned: InsertSpacePlan): { edits: Edit[]; before: ReturnType<typeof snapshot> } {
  const layer = host.layer.get();
  const sheets = host.sheets?.() ?? null;
  const items = floating(host);
  const edits: Edit[] = [];
  for (const id of planned.blocks) {
    const block = layer?.block(id);
    const item = items.find((one) => one.frame.id === id);
    if (!block?.frame || !item) continue;
    const top = item.frame.top + planned.dy;
    const push = sheets && planned.dy > 0 ? sheetPush(top, item.height, sheets) : 0;
    edits.push({ edit: 'moveBlock', block: id, frame: { ...block.frame, y: top + push } });
  }
  return { edits, before: snapshot(host, planned.blocks) };
}

function snapshot(host: InkHost, ids: readonly string[]) {
  const layer = host.layer.get();
  return ids.flatMap((id) => {
    const block = layer?.block(id);
    return block ? [block] : [];
  });
}

/** Applies the plan as one step: the strokes move, and so do the blocks, and a refusal puts everything back. */
export async function commitSpace(host: InkHost, surface: InkSurface, y: number, dy: number): Promise<void> {
  const planned = plan(host, surface, y, dy);
  const moved = planned.strokes.length + planned.blocks.length;
  if (Math.abs(planned.dy) < 0.5 || moved === 0) {
    announce(t(moved === 0 ? 'ink.space.nothing' : 'ink.space.none'));
    return;
  }
  const { edits, before } = blockEdits(host, planned);
  const layer = host.layer.get();
  for (const edit of edits) {
    const block = edit.edit === 'moveBlock' ? layer?.block(edit.block) : null;
    if (block && edit.edit === 'moveBlock') layer?.upsert({ ...block, frame: edit.frame ?? undefined });
  }
  const saved = await surface.transform(planned.strokes, planned.matrix, edits);
  if (!saved) for (const block of before) layer?.upsert(block);
  else announce(t('ink.space.inserted', { moved, locked: planned.lockedStay }));
}

/** The drag of an Insert space gesture. */
export class SpaceGesture {
  private dy = 0;

  constructor(
    private readonly host: InkHost,
    private readonly surface: InkSurface,
    readonly y: number,
  ) {}

  /** The pen is at page height `y`. */
  update(y: number): void {
    this.dy = y - this.y;
    this.draw();
  }

  private draw(): void {
    const { surface } = this;
    const planned = plan(this.host, surface, this.y, this.dy);
    const ctx = surface.liveContext();
    if (ctx) {
      const { zoom, viewport, scrollX } = surface.cameraNow();
      const left = scrollX / zoom;
      const right = left + viewport.w / zoom;
      ctx.lineWidth = 1.5 / zoom;
      ctx.strokeStyle = brandColor('indigo', surface.scheme());
      ctx.fillStyle = `color-mix(in srgb, ${brandColor('indigo', surface.scheme())} 12%, transparent)`;
      ctx.fillRect(left, Math.min(this.y, this.y + planned.dy), right - left, Math.abs(planned.dy));
      ctx.setLineDash([8 / zoom, 5 / zoom]);
      for (const at of [this.y, this.y + planned.dy]) {
        ctx.beginPath();
        ctx.moveTo(left, at);
        ctx.lineTo(right, at);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // The moved ink shows where it will land, when there is not too much of it to move on every pointer move.
    surface.endPreview();
    if (planned.strokes.length > 0 && planned.strokes.length <= PREVIEW_LIMIT) {
      const strokes = surface.strokes(planned.strokes);
      surface.preview(
        planned.strokes,
        strokes.map((s) => ({ ...s, transform: compose(planned.matrix, s.transform ?? IDENTITY) })),
      );
    }
    this.moveBlocks(planned);
  }

  private moveBlocks(planned: InsertSpacePlan): void {
    const layer = this.host.layer.get();
    for (const id of planned.blocks) {
      const element = layer?.view(id)?.element;
      if (!element) continue;
      element.style.transform = planned.dy === 0 ? '' : `translate(0, ${planned.dy}px)`;
    }
  }

  private clear(): void {
    this.surface.endPreview();
    this.surface.clearLive();
    const layer = this.host.layer.get();
    for (const block of layer?.blocks() ?? []) {
      const element = layer?.view(block.id)?.element;
      if (element?.style.transform.startsWith('translate(0,')) element.style.transform = '';
    }
  }

  async commit(): Promise<void> {
    const dy = this.dy;
    this.clear();
    await commitSpace(this.host, this.surface, this.y, dy);
  }

  cancel(): void {
    this.clear();
  }
}

/** The Insert space command: asks how tall, and opens that much space below the middle of what is in view. */
export async function insertSpaceByHeight(host: InkHost, surface: InkSurface): Promise<void> {
  if (!isEnabled('ink.insertSpace') || surface.readOnly) return;
  const answer = await ask({
    title: t('ink.space.title'),
    description: t('ink.space.description'),
    field: { label: t('ink.space.height'), value: '10', help: t('ink.space.heightHelp') },
    confirm: t('ink.space.insert'),
    validate: (text) => (Number.isFinite(Number(text)) && Number(text) !== 0 ? null : t('ink.space.invalid')),
  });
  if (!answer) return;
  const camera = surface.cameraNow();
  const y = (camera.scrollY + camera.viewport.h / 2) / camera.zoom;
  await commitSpace(host, surface, y, spaceAmount(Number(answer.text), 'mm', 0));
}
