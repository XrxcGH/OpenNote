// The sheet strip beside a paginated page: a thumbnail of the paper for each sheet, the sheet the window is on marked, a
// button that adds a sheet, and previous and next buttons when sheets flip one at a time. It is plain DOM over the
// page view, and it draws nothing the note holds. Past `THUMBNAILS` sheets it lists numbers only, so a long page stays
// light.
import { t } from '../../../strings/t';
import styles from './live.module.css';

/** The most sheets that get a drawn thumbnail. */
export const THUMBNAILS = 60;

export interface StripHost {
  sheets(): number;
  /** The sheet the window is on, from 0. */
  current(): number;
  /** The paper of one sheet as SVG, for thumbnails. */
  paper(): string;
  /** A sheet's width over its height. */
  aspect(): number;
  goTo(sheet: number): void;
  add(): void;
}

export interface Strip {
  /** Redraws the buttons and the current mark. */
  refresh(): void;
  /** Moves the current mark, which the camera does as the window scrolls. */
  mark(): void;
  show(open: boolean, flip: boolean): void;
  destroy(): void;
}

function button(doc: Document, className: string, label: string, text?: string): HTMLButtonElement {
  const element = doc.createElement('button');
  element.type = 'button';
  element.className = className;
  element.setAttribute('aria-label', label);
  if (text !== undefined) element.textContent = text;
  return element;
}

export function createStrip(parent: HTMLElement, host: StripHost): Strip {
  const doc = parent.ownerDocument;
  const root = doc.createElement('nav');
  root.className = styles.strip;
  root.setAttribute('aria-label', t('pagesPlus.sheets.strip'));
  root.hidden = true;
  const list = doc.createElement('div');
  list.className = styles.stripList;
  list.setAttribute('role', 'list');
  root.append(list);
  parent.append(root);
  let open = false;
  let flip = false;
  let built = '';

  const rebuild = () => {
    const count = host.sheets();
    const paper = count <= THUMBNAILS ? host.paper() : '';
    const key = `${count}|${flip}|${host.aspect().toFixed(3)}|${paper.length}`;
    if (key === built) return;
    built = key;
    list.replaceChildren();
    if (flip) {
      const previous = button(doc, styles.stripFlip, t('pagesPlus.sheets.previous'), '↑');
      previous.addEventListener('click', () => host.goTo(host.current() - 1));
      list.append(previous);
    }
    for (let k = 0; k < count; k += 1) {
      const item = button(doc, styles.thumb, t('pagesPlus.sheets.goTo', { n: k + 1 }));
      item.setAttribute('role', 'listitem');
      item.dataset.sheet = String(k);
      if (paper) {
        const page = doc.createElement('span');
        page.className = styles.thumbPaper;
        page.style.aspectRatio = String(host.aspect());
        page.innerHTML = paper;
        item.append(page);
      }
      const number = doc.createElement('span');
      number.className = styles.thumbNumber;
      number.textContent = String(k + 1);
      item.append(number);
      item.addEventListener('click', () => host.goTo(k));
      list.append(item);
    }
    if (flip) {
      const next = button(doc, styles.stripFlip, t('pagesPlus.sheets.next'), '↓');
      next.addEventListener('click', () => host.goTo(host.current() + 1));
      list.append(next);
    }
    const add = button(doc, styles.stripAdd, t('pagesPlus.sheets.add'), '+');
    add.addEventListener('click', () => host.add());
    list.append(add);
  };

  const mark = () => {
    if (!open) return;
    const current = host.current();
    for (const item of list.querySelectorAll<HTMLElement>('[data-sheet]')) {
      const here = Number(item.dataset.sheet) === current;
      if (here) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
      if (here && list.matches(':hover') === false) item.scrollIntoView?.({ block: 'nearest' });
    }
  };

  return {
    refresh() {
      if (!open) return;
      rebuild();
      mark();
    },
    mark,
    show(next, flipping) {
      if (open === next && flip === flipping) return;
      open = next;
      flip = flipping;
      root.hidden = !open;
      built = '';
      if (open) {
        rebuild();
        mark();
      }
    },
    destroy: () => root.remove(),
  };
}
