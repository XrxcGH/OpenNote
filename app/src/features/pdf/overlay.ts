// The layers over a picture on the shown page (A1-34, A2-23, A3-19). Every image gets a text layer of its words, from
// the PDF page or, for a photo or a scanned page, from the words the device read in it, so text can be selected and
// copied. PDF pages and slides also get their highlights, the boxes that keep their own pictures' colors when the
// page is dimmed or inverted in the Evening theme, and a switch to show the original page. The layers sit inside the
// picture's frame and use the picture's own position, so they follow its crop and size.
import type { MountedPage } from '../page';
import type { BlockJson } from '../../services/pages/types';
import { t } from '../../strings/t';
import { highlightsOf, linesOf } from './highlights';
import type { Highlight } from './highlights';
import { imageBoxesOf, isPagePicture, lookOf, pdfOf, wordsOf } from './model';
import type { Box, StoredWord } from './model';
import styles from './pdf.module.css';

/** Words a picture's image was read to have, for photos and scans. Null while unread. */
export type ReadWords = (src: string) => Promise<StoredWord[] | null>;

export interface OverlayHost {
  /** Opens the menu of a highlight. */
  openHighlight(block: string, highlight: Highlight, anchor: HTMLElement): void;
  /** Shows the original page, or dims it again. */
  toggleOriginal(block: BlockJson): void;
  readWords: ReadWords;
}

const pct = (value: number) => `${Math.round(value * 1_000_000) / 10_000}%`;

function place(element: HTMLElement, [x, y, w, h]: Box): void {
  element.style.left = pct(x);
  element.style.top = pct(y);
  element.style.width = pct(w);
  element.style.height = pct(h);
}

/** The text layer: one transparent span for each word, sized to its box, so a drag selects real text. */
export function textLayer(words: readonly StoredWord[], label: string): HTMLElement {
  const layer = document.createElement('div');
  layer.className = styles.text;
  layer.setAttribute('role', 'group');
  layer.setAttribute('aria-label', label);
  layer.dataset.pdfText = '';
  words.forEach(([x, y, w, h, text], index) => {
    const span = layer.appendChild(document.createElement('span'));
    span.textContent = index < words.length - 1 ? `${text} ` : text;
    span.dataset.index = String(index);
    place(span, [x, y, w, h]);
    // The container is the layer, so a word's size follows the picture at any zoom.
    span.style.fontSize = `${Math.round(h * 0.85 * 10_000) / 100}cqh`;
  });
  // A drag over the words selects them instead of moving or selecting the picture. Pen input goes to the ink above.
  layer.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'pen' && (event.target as HTMLElement).dataset.index !== undefined)
      event.stopPropagation();
  });
  return layer;
}

class Decoration {
  readonly overlay = document.createElement('div');
  private key = '';
  private ocrSource = '';

  constructor(
    private readonly element: HTMLElement,
    private readonly host: OverlayHost,
  ) {
    this.overlay.className = styles.overlay;
    this.overlay.dataset.pdfOverlay = '';
  }

  /** Puts the overlay over the picture, with the picture's own position in the frame. */
  private attach(): HTMLImageElement | null {
    const picture = this.element.querySelector('img');
    const frame = picture?.parentElement;
    if (!picture || !frame) return null;
    if (this.overlay.parentElement !== frame) frame.append(this.overlay);
    for (const name of ['left', 'top', 'inlineSize', 'blockSize'] as const) {
      this.overlay.style[name] = picture.style[name] || (name === 'inlineSize' || name === 'blockSize' ? '100%' : '0');
    }
    return picture;
  }

  update(block: BlockJson): void {
    const picture = this.attach();
    if (!picture) return;
    const pageLike = isPagePicture(block);
    if (pageLike) this.element.dataset.pdfLook = lookOf(block);
    else delete this.element.dataset.pdfLook;
    const words = wordsOf(block);
    const key = JSON.stringify([words.length, block.data.highlights, block.data.images, lookOf(block), pageLike]);
    if (key !== this.key) {
      this.key = key;
      this.render(block, words, pageLike);
    }
    if (words.length === 0 && picture.src && picture.src !== this.ocrSource) {
      this.ocrSource = picture.src;
      void this.host.readWords(picture.src).then((read) => {
        if (read && read.length > 0 && this.ocrSource === picture.src) this.showText(read, t('pdf.text.read'));
      });
    }
  }

  private showText(words: readonly StoredWord[], label: string): void {
    this.overlay.querySelector('[data-pdf-text]')?.remove();
    this.overlay.prepend(textLayer(words, label));
  }

  private render(block: BlockJson, words: readonly StoredWord[], pageLike: boolean): void {
    this.overlay.replaceChildren();
    if (pageLike) {
      for (const box of imageBoxesOf(block)) {
        const keep = this.overlay.appendChild(document.createElement('div'));
        keep.className = styles.keep;
        place(keep, box);
      }
    }
    if (words.length > 0) {
      const pdf = pdfOf(block);
      this.showText(words, pdf ? t('pdf.text.page', { page: pdf.page, file: pdf.file }) : t('pdf.text.read'));
      this.renderHighlights(block, words);
    }
    if (pageLike) this.renderSwitch(block);
  }

  private renderHighlights(block: BlockJson, words: readonly StoredWord[]): void {
    for (const highlight of highlightsOf(block)) {
      const lines = linesOf(words, highlight.from, highlight.to);
      lines.forEach((box, index) => {
        const mark = this.overlay.appendChild(document.createElement('div'));
        mark.className = styles.mark;
        mark.dataset.color = highlight.color;
        place(mark, box);
        if (index > 0) return;
        mark.tabIndex = 0;
        mark.setAttribute('role', 'button');
        mark.setAttribute('aria-label', t('pdf.highlights.mark', { text: highlight.text }));
        const open = () => this.host.openHighlight(block.id, highlight, mark);
        mark.addEventListener('pointerdown', (event) => event.stopPropagation());
        mark.addEventListener('click', (event) => {
          event.stopPropagation();
          open();
        });
        mark.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        });
      });
    }
  }

  private renderSwitch(block: BlockJson): void {
    const button = this.overlay.appendChild(document.createElement('button'));
    button.type = 'button';
    button.className = styles.original;
    const original = lookOf(block) === 'original';
    button.setAttribute('aria-pressed', String(original));
    button.textContent = t('pdf.look.original');
    button.addEventListener('pointerdown', (event) => event.stopPropagation());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.host.toggleOriginal(block);
    });
  }

  destroy(): void {
    this.overlay.remove();
    delete this.element.dataset.pdfLook;
  }
}

/** Keeps a decoration on each image of the page view. Returns the function that removes them. */
export function attachOverlays(mounted: Pick<MountedPage, 'layer'>, root: HTMLElement, host: OverlayHost): () => void {
  const shown = new Map<string, Decoration>();
  let frame = 0;
  const refresh = () => {
    frame = 0;
    const seen = new Set<string>();
    for (const block of mounted.layer.blocks()) {
      if (block.type !== 'image') continue;
      const element = mounted.layer.view(block.id)?.element;
      if (!element) continue;
      seen.add(block.id);
      let decoration = shown.get(block.id);
      if (!decoration) {
        decoration = new Decoration(element, host);
        shown.set(block.id, decoration);
      }
      decoration.update(block);
    }
    for (const [id, decoration] of shown) {
      if (!seen.has(id)) {
        decoration.destroy();
        shown.delete(id);
      }
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(refresh);
  };
  const stop = mounted.layer.onChange(schedule);
  // A picture's image element appears once its asset loads, after the block itself.
  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });
  refresh();
  return () => {
    stop();
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    shown.forEach((decoration) => decoration.destroy());
    shown.clear();
  };
}
