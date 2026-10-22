// The graph of an equation, opened beside it from its Graph button (a selected equation, or handwriting read as
// math). It is a popover with the grapher in it, 2D or 3D as the equation needs, and buttons that put it on the page
// as a live graph block or as a picture. Escape, a press outside, or Close shuts it.
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { t } from '../../../strings/t';
import { Button, Popover, announce } from '../../../ui';
import { INSERT_EVENT } from '../../tools';
import { GraphView } from './GraphView';
import { graphPicture } from './picture';
import styles from './graph.module.css';

export interface GraphPopupOptions {
  /** The graph block text to start from. */
  source: string;
  /** What the popover opens beside. */
  anchor: HTMLElement;
  /** Puts the graph on the page as a live graph block. Without it, the page that is open takes it at the caret. */
  insert?(source: string): void;
  /** The equation, for the popover's name. */
  equation: string;
}

let open: { root: Root; host: HTMLElement } | null = null;

function send(detail: Record<string, unknown>): boolean {
  const request = { ...detail, handled: false };
  window.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail: request }));
  return request.handled;
}

function GraphPopup({ options, onClose }: { options: GraphPopupOptions; onClose(): void }) {
  const [source, setSource] = useState(options.source);
  const anchor = useRef<HTMLElement | null>(options.anchor);
  const insert = () => {
    if (options.insert) options.insert(source);
    else send({ graph: source });
    announce(t('smart.grapher.announceInserted'));
    onClose();
  };
  const picture = async () => {
    const made = await graphPicture(source);
    if (!made) return announce(t('mathTools.graph3d.pictureFailed'));
    if (send({ picture: made })) announce(t('mathTools.graph3d.pictureAdded'));
    onClose();
  };
  return (
    <Popover
      anchor={anchor}
      label={t('mathTools.graphPopup.label', { equation: options.equation })}
      open
      onClose={onClose}
      placement="inline-end"
    >
      <div className={styles.popup} data-graph-popup="">
        <GraphView source={source} editable onSource={setSource} />
        <div className={styles.buttons}>
          <Button variant="primary" onClick={insert}>
            {t('smart.grapher.insert')}
          </Button>
          <Button variant="secondary" onClick={() => void picture()}>
            {t('mathTools.graph3d.picture')}
          </Button>
          <Button variant="quiet" onClick={onClose}>
            {t('mathTools.graphPopup.close')}
          </Button>
        </div>
      </div>
    </Popover>
  );
}

export function closeGraphPopup(): void {
  if (!open) return;
  const { root, host } = open;
  open = null;
  // React warns when a root unmounts during another root's render, so it waits a task.
  setTimeout(() => {
    root.unmount();
    host.remove();
  }, 0);
}

/** Opens the graph beside its anchor, closing one already open. */
export function openGraphPopup(options: GraphPopupOptions): void {
  closeGraphPopup();
  const host = document.createElement('div');
  host.dataset.graphPopupHost = '';
  document.body.append(host);
  const root = createRoot(host);
  open = { root, host };
  root.render(<GraphPopup options={options} onClose={closeGraphPopup} />);
}
