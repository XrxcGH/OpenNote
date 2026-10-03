// The command palette and the quick switcher, a lazy chunk (ARCHITECTURE.md section 14.6; FEATURES.md, Phase 2).
// - A dialog near the top of the window with an ARIA 1.2 combobox: focus stays in the input, and the popup is a
//   listbox. Up and Down move, Enter runs or opens, Escape closes, and Tab reaches the filter chips.
// - The palette searches commands and "Go to" results; the quick switcher searches pages only.
// - Choosing closes it first, so focus is back where it was before the command runs or the page opens.

import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { PaletteFilterId, PaletteResult } from '../../registries/types';
import type { OverlayProps } from '../../shell/commandbar/overlays';
import { t } from '../../strings/t';
import type { MessageKey } from '../../strings/t';
import { Dialog } from '../../ui';
import styles from './CommandPalette.module.css';
import { FilterChips } from './FilterChips';
import { ResultList, optionId } from './ResultList';
import { useActive, useCountAnnouncement, usePaletteResults } from './usePalette';
import type { PaletteMode } from './usePalette';

export interface PaletteProps extends OverlayProps {
  mode: PaletteMode;
}

const TEXT: Record<PaletteMode, { title: MessageKey; input: MessageKey; placeholder: MessageKey }> = {
  palette: { title: 'palette.title', input: 'palette.input', placeholder: 'palette.placeholder' },
  switcher: {
    title: 'palette.switcherTitle',
    input: 'palette.switcherInput',
    placeholder: 'palette.switcherPlaceholder',
  },
};

const PAGE_STEP = 8;

export default function CommandPalette({ mode, onClose }: PaletteProps) {
  const text = TEXT[mode];
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PaletteFilterId>(mode === 'switcher' ? 'pages' : 'all');
  const { ranked, search } = usePaletteResults(mode, query, filter);
  const { index, active, move, moveTo } = useActive(ranked.flat);
  useCountAnnouncement(query, search);
  const input = useRef<HTMLInputElement>(null);
  const listId = `${useId().replace(/:/g, '')}-results`;
  const choose = (result: PaletteResult | undefined) => {
    if (!result || result.disabled) return;
    onClose();
    void result.run();
  };
  const keys: Record<string, () => void> = {
    ArrowDown: () => move(1),
    ArrowUp: () => move(-1),
    PageDown: () => moveTo(Math.min(index + PAGE_STEP, ranked.flat.length - 1)),
    PageUp: () => moveTo(Math.max(index - PAGE_STEP, 0)),
    // Ctrl+Enter opens a page or section in a new tab; a result that is not a place opens as Enter does.
    Enter: () => choose(active),
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && event.ctrlKey && active?.openInTab && !active.disabled) {
      event.preventDefault();
      onClose();
      void active.openInTab();
      return;
    }
    const action = keys[event.key];
    if (!action || event.nativeEvent.isComposing || event.altKey) return;
    event.preventDefault();
    action();
  };
  return (
    <Dialog title={t(text.title)} size="palette" placement="top" initialFocus={input} onDismiss={onClose}>
      <div data-scope="palette" className={styles.palette}>
        <input
          ref={input}
          role="combobox"
          className={styles.input}
          aria-label={t(text.input)}
          placeholder={t(text.placeholder)}
          aria-expanded={ranked.flat.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={index >= 0 ? optionId(listId, index) : undefined}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {mode === 'palette' && <FilterChips value={filter} onChange={setFilter} />}
        <ResultList id={listId} ranked={ranked} activeIndex={index} onHover={moveTo} onChoose={choose} />
      </div>
    </Dialog>
  );
}
