// The Layers dialog (flag ink.layers): every layer from the top down, each with a name, Hide, Lock, Make active, Move
// up and down, Export layer, and Delete. Everything is a real button with a name, so a keyboard and a screen reader
// reach it all. The dialog stays open while layers change.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { executeCommand } from '../../../commands/registry';
import { t } from '../../../strings/t';
import { announce, Button, Dialog, TextField } from '../../../ui';
import { exportOnlyLayer } from './exportSource';
import {
  activeLayer,
  addLayerPatch,
  BASE_LAYER,
  deletePatch,
  inkLayers,
  layerName,
  movePatch,
  sendLayers,
  setLayerPatch,
} from './layers';
import type { InkSurface } from './surface';
import styles from './view.module.css';

function useStoreValue<T>(store: { get(): T; subscribe(l: () => void): () => void }): T {
  const [value, setValue] = useState(store.get());
  useEffect(() => store.subscribe(() => setValue(store.get())), [store]);
  return value;
}

function Rename(props: { id: string; surface: InkSurface }) {
  const layers = useStoreValue(inkLayers);
  const [text, setText] = useState(layerName(layers, props.id));
  return (
    <TextField
      label={t('ink.layers.rename', { layer: layerName(layers, props.id) })}
      value={text}
      onChange={setText}
      onCommit={() => {
        const patch = setLayerPatch(inkLayers.get(), props.id, { name: text });
        if (patch && text.trim()) void sendLayers(props.surface, patch);
      }}
    />
  );
}

function LayerRow(props: { id: string; surface: InkSurface; first: boolean; last: boolean }) {
  const { id, surface } = props;
  const layers = useStoreValue(inkLayers);
  const active = useStoreValue(activeLayer);
  const def = layers.defs.get(id);
  if (!def) return null;
  const name = layerName(layers, id);
  const change = (patch: Parameters<typeof setLayerPatch>[2]) => {
    const next = setLayerPatch(layers, id, patch);
    if (next) void sendLayers(surface, next);
  };
  const move = (direction: 'up' | 'down') => {
    const next = movePatch(layers, id, direction);
    if (next) void sendLayers(surface, next);
  };
  return (
    <li data-ink-layer={id} className={styles.layer}>
      <Rename key={name} id={id} surface={surface} />
      <div className={styles.layerActions}>
        <Button
          variant="quiet"
          aria-pressed={active === id}
          onClick={() => {
            activeLayer.set(id);
            announce(t('ink.layers.nowActive', { layer: name }));
          }}
        >
          {active === id ? t('ink.layers.active') : t('ink.layers.makeActive')}
        </Button>
        <Button variant="quiet" aria-pressed={def.hidden} onClick={() => change({ hidden: !def.hidden })}>
          {def.hidden ? t('ink.layers.show') : t('ink.layers.hide')}
        </Button>
        <Button variant="quiet" aria-pressed={def.locked} onClick={() => change({ locked: !def.locked })}>
          {def.locked ? t('ink.layers.unlock') : t('ink.layers.lock')}
        </Button>
        <Button variant="quiet" disabled={props.last} onClick={() => move('up')}>
          {t('ink.layers.moveUp')}
        </Button>
        <Button variant="quiet" disabled={props.first} onClick={() => move('down')}>
          {t('ink.layers.moveDown')}
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            exportOnlyLayer(id);
            void Promise.resolve(executeCommand('pages.exportPdf', undefined, 'menu')).finally(() =>
              exportOnlyLayer(undefined),
            );
          }}
        >
          {t('ink.layers.export')}
        </Button>
        {id !== BASE_LAYER && (
          <Button
            variant="quiet"
            onClick={() => {
              const patch = deletePatch(layers, id);
              if (patch) void sendLayers(surface, patch);
              if (active === id) activeLayer.set(BASE_LAYER);
            }}
          >
            {t('ink.layers.delete')}
          </Button>
        )}
      </div>
    </li>
  );
}

function LayersPanel(props: { surface: InkSurface; done: () => void }) {
  const { surface, done } = props;
  const layers = useStoreValue(inkLayers);
  const top = [...layers.order].reverse();
  return (
    <Dialog
      title={t('ink.layers.title')}
      description={t('ink.layers.help')}
      onDismiss={done}
      actions={[
        {
          id: 'add',
          label: t('ink.layers.add'),
          variant: 'secondary',
          onPress: () => {
            const patch = addLayerPatch(
              inkLayers.get(),
              t('ink.layers.newName', { number: inkLayers.get().order.length + 1 }),
            );
            if (patch) void sendLayers(surface, patch);
            else announce(t('ink.layers.tooMany'));
          },
        },
        { id: 'close', label: t('ink.layers.close'), variant: 'primary', onPress: done },
      ]}
    >
      <ul aria-label={t('ink.layers.title')} className={styles.layers}>
        {top.map((id, i) => (
          <LayerRow key={id} id={id} surface={surface} first={i === top.length - 1} last={i === 0} />
        ))}
      </ul>
    </Dialog>
  );
}

/** Opens the Layers dialog. Resolves when it closes. */
export function showLayers(surface: InkSurface): Promise<void> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    const done = () => {
      resolve();
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
    };
    root.render(<LayersPanel surface={surface} done={done} />);
  });
}
