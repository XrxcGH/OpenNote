// The page's extension points (PLAN.md section 3.9, owned by WP0). Each package registers into these from its file
// in registrations/, so no two packages edit one list.
import type { ComponentType } from 'react';
import type { FlagId } from '../../app/flags';
import type { CommandId } from '../../commands/types';
import type { PastedPiece } from '../../editor/markdown';
import type { ClipboardFacts } from '../../platform/types';
import { createRegistry } from '../../registries';
import type { PageJson, PageRect } from '../../services/pages/types';
import type { MessageKey } from '../../strings/t';
import type { IconName } from '../../ui/icons';
import type { BlockRendererDef } from './blocks/types';
import type { PageSelection } from './seams/selectionStore';

export interface SlashItemDef {
  id: string;
  title: MessageKey;
  keywords: MessageKey;
  icon: IconName;
  group: 'basic' | 'lists' | 'media' | 'advanced';
  order: number;
  flag?: FlagId;
  command: CommandId;
}

export interface PasteInput {
  html: string | null;
  text: string | null;
  files: readonly File[];
  /** Null when the clipboard's hash didn't match what was pasted. */
  facts: ClipboardFacts | null;
  target: 'text' | 'cell' | 'code' | 'page';
}

export interface PasteSourceDef {
  id: string;
  order: number;
  /** Confidence from 0 to 1. */
  detect(input: PasteInput, doc: Document | null): number;
  /** Rewrites the inert document. */
  normalize(doc: Document, input: PasteInput): void;
}

export interface ClipboardFormatDef {
  id: string;
  mime: string;
  write?(selection: PageSelection, data: DataTransfer): void;
  read?(data: DataTransfer): PastedPiece[] | null;
}

export interface ReadingItem {
  key: string;
  kind: 'block' | 'ink';
  label: string;
  rect: PageRect;
  element: HTMLElement | null;
}

export interface ReadingItemProvider {
  id: string;
  items(page: PageJson): readonly ReadingItem[];
}

export interface EditingSettingsPart {
  id: string;
  title: MessageKey;
  order: number;
  flag?: FlagId;
  load(): Promise<{ default: ComponentType }>;
}

export const slashItems = createRegistry<SlashItemDef>('slash menu items');
export const pasteSources = createRegistry<PasteSourceDef>('paste sources');
export const clipboardFormats = createRegistry<ClipboardFormatDef>('clipboard formats');
export const readingItemProviders = createRegistry<ReadingItemProvider>('reading item providers');
export const editingSettingsParts = createRegistry<EditingSettingsPart>('editing settings parts');
export const blockRenderers = createRegistry<BlockRendererDef>('block renderers');
