// Named styles v2 (text program, Beta 10; ADR 0082): the style commands, the decorations that show each element's
// style to the page's CSS, and the shown page's own style sheet. Everything here is behind text.styles2. The
// heavy parts load when a command runs, so start-up stays light.
import type { Editor } from '@tiptap/core';
import { isEnabled } from '../../../app/flags';
import { defineCommand } from '../../../commands/registry';
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
  ]).then(([store, styleCommands, gallery, sets]) => ({ store, styleCommands, gallery, sets }));

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
  await loaded.store.loadStyles(notebook);
  return { editor, notebook, loaded };
}

/** A menu at the caret, resolving with the chosen item's id. */
async function menuAtCaret(editor: Editor, label: string, items: { id: string; label: string; checked?: boolean }[]) {
  const { openMenu } = await import('../../../ui/Menu');
  const at = editor.view.coordsAtPos(editor.state.selection.from);
  return openMenu({
    label,
    anchor: { x: at.left, y: at.bottom },
    items: items.map((item) => ({ ...item, kind: 'radio' as const })),
    returnFocus: editor.view.dom,
  });
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
  const entries = loaded.gallery.galleryEntries(ctx);
  const items = entries.map((entry) => ({ id: entry.name, label: entry.label, checked: entry.name === current }));
  const chosen = await menuAtCaret(editor, t('textStyles.gallery'), items);
  if (!chosen) return;
  const sheet = { ...ctx.app, ...ctx.notebook, ...ctx.page };
  loaded.styleCommands.applyStyle(editor, chosen, sheet);
});

styleCommand('styles.update', 'textStyles.commands.update', async ({ editor, notebook, loaded }) => {
  const ctx = loaded.store.shownContext(notebook);
  const { style, look } = loaded.styleCommands.selectionLook(editor, ctx);
  await loaded.store.saveStyles(notebook, loaded.styleCommands.updatedToMatch(ctx, style, look));
});

styleCommand('styles.create', 'textStyles.commands.create', async ({ editor, notebook, loaded }) => {
  const ctx = loaded.store.shownContext(notebook);
  const { style, look } = loaded.styleCommands.selectionLook(editor, ctx);
  const label = t('textStyles.newStyleLabel');
  const made = loaded.styleCommands.createdFromSelection(ctx, label, style, look);
  const saved = await loaded.store.saveStyles(notebook, made.styles, {
    message: t('textStyles.created', { name: label }),
  });
  if (saved) loaded.styleCommands.applyStyle(editor, made.name, made.styles);
});

styleCommand('styles.modify', 'textStyles.commands.modify', async ({ editor, notebook, loaded }) => {
  const style = loaded.styleCommands.styleOfNode(editor.state.selection.$from.parent);
  const { openTextStyles } = await import('../styles/TextStylesDialog');
  const { STYLE_NAMES } = await import('../styles/styleVars');
  const known = (STYLE_NAMES as readonly string[]).includes(style);
  await openTextStyles(notebook, known ? (style as (typeof STYLE_NAMES)[number]) : undefined);
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
