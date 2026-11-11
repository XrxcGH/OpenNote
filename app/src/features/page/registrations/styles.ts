// Named styles v2 (text program, Beta 10; ADR 0082): the style commands, the decorations that show each element's
// style to the page's CSS, and the shown page's own style sheet. Everything here is behind text.styles2. The
// heavy parts load when a command runs, so start-up stays light.
import type { Editor } from '@tiptap/core';
import { isEnabled } from '../../../app/flags';
import { commandContext, defineCommand } from '../../../commands/registry';
import type { CommandId } from '../../../commands/types';
import { commands } from '../../../registries';
import type { MessageKey } from '../../../strings/t';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui/toast';
import { targetEditor } from '../formattingBar/target';
import { shownPage } from '../history/shown';

const FLAG = 'text.styles2';
const parts = () =>
  Promise.all([
    import('../styles/store'),
    import('../styles/commands'),
    import('../styles/gallery'),
    import('../styles/sets'),
    import('../styles/model'),
  ]).then(([store, styleCommands, gallery, sets, model]) => ({ store, styleCommands, gallery, sets, model }));

/** The editor and notebook a style command works on, or null with a toast that says why. */
async function scope(): Promise<{
  editor: Editor;
  notebook: string;
  loaded: Awaited<ReturnType<typeof parts>>;
} | null> {
  const loaded = await parts();
  const notebook = loaded.store.shownNotebook();
  const editor = targetEditor();
  if (!notebook) {
    showToast({ message: t('textStyles.noNotebook') });
    return null;
  }
  if (!editor) {
    showToast({ message: t('textStyles.noParagraph') });
    return null;
  }
  try {
    await loaded.store.loadStyles(notebook);
  } catch {
    showToast({ message: t('textStyles.loadFailed'), tone: 'danger' });
    return null;
  }
  return { editor, notebook, loaded };
}

/** A menu at the caret, resolving with the chosen item's id. */
async function menuAtCaret(
  editor: Editor,
  label: string,
  items: readonly { id: string; label: string; checked?: boolean; separatorBefore?: boolean }[],
) {
  const { openMenu } = await import('../../../ui/Menu');
  const at = editor.view.coordsAtPos(editor.state.selection.from);
  return openMenu({
    label,
    anchor: { x: at.left, y: at.bottom },
    items: items.map((item) => ({ ...item, kind: 'radio' as const })),
    returnFocus: editor.view.dom,
  });
}

/** R-STY-3: whether a style name may be written. A name that may not gets a toast and no change. */
function writable(loaded: Awaited<ReturnType<typeof parts>>, style: string): boolean {
  if (loaded.model.isWritableStyleName(style)) return true;
  showToast({ message: t('textStyles.badName') });
  return false;
}

type Run = (s: NonNullable<Awaited<ReturnType<typeof scope>>>) => Promise<void> | void;

function styleCommand(id: CommandId, title: MessageKey, run: Run): void {
  commands.register(
    defineCommand({
      id,
      title,
      category: 'format',
      keywords: 'editor.keywords.block',
      flag: FLAG,
      run: async () => {
        const s = await scope();
        if (s) await run(s);
      },
    }),
  );
}

styleCommand('styles.apply', 'textStyles.commands.apply', async ({ editor, notebook, loaded }) => {
  const ctx = loaded.store.shownContext(notebook);
  const current = loaded.styleCommands.styleOfNode(editor.state.selection.$from.parent);
  const chosen = await menuAtCaret(editor, t('textStyles.gallery'), loaded.gallery.applyMenuItems(ctx, current));
  if (!chosen) return;
  const sheet = { ...ctx.app, ...ctx.notebook, ...ctx.page };
  loaded.styleCommands.applyStyle(editor, chosen, sheet);
});

styleCommand('styles.update', 'textStyles.commands.update', async ({ editor, notebook, loaded }) => {
  const ctx = loaded.store.shownContext(notebook);
  const { style, look } = loaded.styleCommands.selectionLook(editor, ctx);
  if (!writable(loaded, style)) return;
  await loaded.store.saveStyles(notebook, loaded.styleCommands.updatedToMatch(ctx, style, look));
});

styleCommand('styles.create', 'textStyles.commands.create', async ({ editor, notebook, loaded }) => {
  const ctx = loaded.store.shownContext(notebook);
  const { style, look } = loaded.styleCommands.selectionLook(editor, ctx);
  if (!writable(loaded, style)) return;
  const made = loaded.styleCommands.createdFromSelection(ctx, t('textStyles.newStyleLabel'), style, look);
  const saved = await loaded.store.saveStyles(notebook, made.styles, {
    message: t('textStyles.created', { name: made.label }),
  });
  if (saved) loaded.styleCommands.applyStyle(editor, made.name, made.styles);
});

styleCommand('styles.modify', 'textStyles.commands.modify', async ({ editor, notebook, loaded }) => {
  const style = loaded.styleCommands.styleOfNode(editor.state.selection.$from.parent);
  // With the Format pane on, Modify style edits any style there (ADR 0082); the dialog knows ten.
  if (isEnabled('text.formatPane')) {
    const { openFormatPane } = await import('../formatPane/mount');
    openFormatPane({ notebook, style, tab: 'text', fonts: commandContext('commandBar').platform.fonts });
    return;
  }
  const known = loaded.styleCommands.dialogStyle(style);
  if (!known) {
    showToast({ message: t('textStyles.modifyUnsupported') });
    return;
  }
  const { openTextStyles } = await import('../styles/TextStylesDialog');
  await openTextStyles(notebook, known);
});

styleCommand('styles.remove', 'textStyles.commands.remove', async ({ editor, notebook, loaded }) => {
  const style = loaded.styleCommands.styleOfNode(editor.state.selection.$from.parent);
  const ctx = loaded.store.shownContext(notebook);
  const next = loaded.styleCommands.withoutStyle(ctx.notebook, style);
  if (!next) {
    showToast({ message: t('textStyles.builtInDelete') });
    return;
  }
  const label = loaded.gallery.galleryEntries(ctx, { includeHidden: true }).find((e) => e.name === style)?.label;
  await loaded.store.saveStyles(notebook, next, { message: t('textStyles.deleted', { name: label ?? style }) });
});

for (const [id, title, hidden] of [
  ['styles.hide', 'textStyles.commands.hide', true],
  ['styles.show', 'textStyles.commands.show', false],
] as const) {
  styleCommand(id, title, async ({ editor, notebook, loaded }) => {
    const style = loaded.styleCommands.styleOfNode(editor.state.selection.$from.parent);
    if (!writable(loaded, style)) return;
    const ctx = loaded.store.shownContext(notebook);
    await loaded.store.saveStyles(notebook, loaded.styleCommands.withHidden(ctx.notebook, style, hidden));
  });
}

for (const [id, title, by] of [
  ['styles.moveUp', 'textStyles.commands.moveUp', -1],
  ['styles.moveDown', 'textStyles.commands.moveDown', 1],
] as const) {
  styleCommand(id, title, async ({ editor, notebook, loaded }) => {
    const style = loaded.styleCommands.styleOfNode(editor.state.selection.$from.parent);
    if (!writable(loaded, style)) return;
    const ctx = loaded.store.shownContext(notebook);
    const order = loaded.gallery.galleryEntries(ctx, { includeHidden: true }).map((entry) => entry.name);
    await loaded.store.saveStyles(notebook, loaded.styleCommands.withMoved(ctx.notebook, order, style, by));
  });
}

styleCommand('styles.chooseSet', 'textStyles.commands.chooseSet', async ({ editor, notebook, loaded }) => {
  const items = loaded.sets.STYLE_SETS.map((set) => ({ id: set.id, label: t(`textStyles.sets.${set.id}`) }));
  const chosen = loaded.sets.styleSet((await menuAtCaret(editor, t('textStyles.commands.chooseSet'), items)) ?? '');
  if (!chosen) return;
  const next = loaded.sets.withStyleSet(loaded.store.stylesFor(notebook), chosen);
  await loaded.store.saveStyles(notebook, next, {
    message: t('textStyles.setChanged', { name: t(`textStyles.sets.${chosen.id}`) }),
  });
});

// The Styles pane needs a notebook but no caret: it applies to whatever is selected when a style is chosen.
commands.register(
  defineCommand({
    id: 'styles.pane',
    title: 'textStyles.commands.pane',
    category: 'format',
    keywords: 'editor.keywords.block',
    flag: FLAG,
    run: async () => {
      const loaded = await parts();
      const notebook = loaded.store.shownNotebook();
      if (!notebook) {
        showToast({ message: t('textStyles.noNotebook') });
        return;
      }
      try {
        await loaded.store.loadStyles(notebook);
      } catch {
        showToast({ message: t('textStyles.loadFailed'), tone: 'danger' });
        return;
      }
      const { toggleStylesPane } = await import('../styles/StylesPane');
      toggleStylesPane(notebook);
    },
  }),
);

// The decorations register themselves in every text editor whose host has text.styles2 on.
void import('../styles/decorations').catch(() => undefined);

// The shown page's own style sheet (SPEC R-STY-7), from the page as it opened. Imported documents carry one.
shownPage.subscribe(() => {
  if (!isEnabled(FLAG)) return;
  const sheet = shownPage.get()?.initial.styles;
  void import('../styles/store').then(({ pageSheet }) => {
    pageSheet.set(
      sheet && typeof sheet === 'object' && !Array.isArray(sheet) ? (sheet as Record<string, never>) : null,
    );
  });
});
