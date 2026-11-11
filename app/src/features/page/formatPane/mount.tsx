// Shows the Format pane at the dock (text DESIGN.md 5.3). Like the Styles pane, it has no slot in the workspace grid,
// so it renders in a root of its own. Opening it again moves it to the tab or the style asked for.
import type { Editor } from '@tiptap/core';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { FontsClient } from '../../../platform/types';
import { setDockInset } from '../../../shell/layout/dock';
import { targetEditor } from '../formattingBar/target';
import { FormatPane } from './FormatPane';
import type { TabId } from './fields';
import styles from './FormatPane.module.css';

export interface OpenOptions {
  notebook: string;
  tab?: TabId;
  /** A style to edit (Modify style). */
  style?: string;
  fonts?: FontsClient;
  editorOf?: () => Editor | null;
}

let host: HTMLElement | null = null;
let root: Root | null = null;
let opener: HTMLElement | null = null;

export const formatPaneOpen = (): boolean => host !== null;

export function closeFormatPane(): void {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
  setDockInset(0, 'format');
  if (opener?.isConnected) opener.focus();
  opener = null;
}

/** Shows the pane, or moves an open one to the tab or style asked for. */
export function openFormatPane(options: OpenOptions): void {
  if (!host) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    host = document.body.appendChild(document.createElement('div'));
    host.className = styles.sheet ?? '';
    host.dataset['region'] = 'format-pane';
    // The page leaves room for the sheet: its 22 rem, its 16 px gap to the window's edge, and 8 px of air.
    setDockInset(352 + 24, 'format');
    root = createRoot(host);
  }
  root?.render(
    <FormatPane
      key={`${options.tab ?? 'text'}:${options.style ?? ''}`}
      notebook={options.notebook}
      tab={options.tab}
      style={options.style}
      fonts={options.fonts}
      onClose={closeFormatPane}
      editorOf={options.editorOf ?? targetEditor}
    />,
  );
}
