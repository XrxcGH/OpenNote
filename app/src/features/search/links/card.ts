// The link preview card: the first lines of the page a [[link]] points at (or the lines under its heading). It
// opens after the pointer rests on a link, or from the keyboard with "Preview the linked page", stays open while
// the pointer is over it, and closes on Escape. Plain DOM, because it hangs off ProseMirror's view and lives for
// a moment.
import { getLocation } from '../../../app/location';
import type { LinkRef } from '../../../services/search/types';
import { t } from '../../../strings/t';
import { maybeSearchClient } from '../client';
import { followLink } from './follow';
import styles from '../search.module.css';

export const HOVER_DELAY_MS = 450;
const HIDE_DELAY_MS = 250;

let card: HTMLElement | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let serial = 0;

function clearTimers() {
  if (showTimer) clearTimeout(showTimer);
  if (hideTimer) clearTimeout(hideTimer);
  showTimer = hideTimer = null;
}

export function hideCard(): void {
  clearTimers();
  serial += 1;
  card?.remove();
  card = null;
  document.removeEventListener('keydown', onKeyDown, true);
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !card) return;
  event.stopPropagation();
  hideCard();
}

function place(element: HTMLElement, anchor: DOMRect) {
  const margin = 8;
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const left = Math.min(Math.max(margin, anchor.left), Math.max(margin, window.innerWidth - width - margin));
  const below = anchor.bottom + 4;
  const top = below + height + margin > window.innerHeight ? Math.max(margin, anchor.top - height - 4) : below;
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

/** Shows the card for a link, next to `anchor`. */
export async function showCard(anchor: DOMRect, link: LinkRef): Promise<void> {
  const client = maybeSearchClient();
  if (!client) return;
  clearTimers();
  const mine = ++serial;
  const here = getLocation();
  const preview = await client
    .linkPreview({
      title: link.title,
      fragment: link.heading,
      from: here.view === 'workspace' ? (here.pageId ?? undefined) : undefined,
    })
    .catch(() => null);
  if (mine !== serial) return;
  card?.remove();
  const element = document.createElement('div');
  element.className = styles.card;
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-label', t('search.links.cardLabel', { title: link.title }));
  const title = document.createElement('h4');
  title.className = styles.cardTitle;
  title.textContent = preview?.title ?? link.title;
  element.append(title);
  const body = document.createElement('p');
  body.className = styles.cardText;
  body.textContent = preview
    ? preview.text || t('search.links.emptyPage')
    : t('search.links.broken', { title: link.title });
  element.append(body);
  if (preview?.headingMissing && link.heading) {
    const note = document.createElement('p');
    note.className = styles.cardText;
    note.textContent = t('search.links.headingMissing', { heading: link.heading });
    element.append(note);
  }
  if (preview) {
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = t('search.links.open');
    open.addEventListener('click', () => {
      hideCard();
      void followLink(link);
    });
    element.append(open);
  }
  element.addEventListener('pointerenter', clearTimers);
  element.addEventListener('pointerleave', () => scheduleHide());
  document.body.append(element);
  card = element;
  place(element, anchor);
  document.addEventListener('keydown', onKeyDown, true);
}

export function scheduleShow(anchor: HTMLElement, link: LinkRef): void {
  clearTimers();
  showTimer = setTimeout(() => void showCard(anchor.getBoundingClientRect(), link), HOVER_DELAY_MS);
}

export function scheduleHide(): void {
  if (showTimer) clearTimeout(showTimer);
  showTimer = null;
  if (!card) return;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(hideCard, HIDE_DELAY_MS);
}
