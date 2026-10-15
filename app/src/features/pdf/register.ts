// Registers the PDF commands (A4-10, A2-20): Import PDF as pages, Insert PDF into the page, Add note space, and Make
// handouts, in the palette and on the Insert tab. The work and pdf.js load when a command runs, so start-up carries
// only this file.
import { lazy } from 'react';
import { getLocation } from '../../app/location';
import { defineCommand } from '../../commands/registry';
import type { CommandContext } from '../../commands/types';
import { commandBar, commands, contextMenus } from '../../registries';
import { chord } from '../../commands/chords';
import { isEnabled } from '../../app/flags';
import { showOverlay } from '../../shell/commandbar/overlays';
import type { ToolDeps } from './actions';
import type { MountedPageHook } from '../page';
import { t } from '../../strings/t';

const LazyTools = lazy(() => import('./PdfToolsDialog'));
const LazyHighlights = lazy(() => import('./HighlightsDialog'));
const LazyScan = lazy(() => import('./ScanDialog'));
const tools = () => import('./pageTools');

const PDF_TYPES = 'application/pdf,.pdf';

const inSection = () => {
  const here = getLocation();
  return here.view === 'workspace' && here.sectionId !== null;
};
const onPage = () => {
  const here = getLocation();
  return here.view === 'workspace' && here.pageId !== null;
};

/** What the page tools need, with the shown page read when they run. */
async function toolDeps(ctx: CommandContext): Promise<ToolDeps> {
  const { shownMounted } = await import('../page');
  return {
    platform: ctx.platform,
    notes: ctx.notes,
    shown: async () => {
      const mounted = shownMounted.get();
      return mounted ? (await import('./target')).shownTarget(mounted) : null;
    },
  };
}

commands.register(
  defineCommand({
    id: 'pdf.import',
    title: 'pdf.commands.import',
    keywords: 'pdf.commands.keywords',
    category: 'notebooks',
    icon: 'FilePdf',
    flag: 'interop.pdfImport',
    when: inSection,
    async run(ctx) {
      const [{ pickFiles }, { importPdfAsPages }, { openPage }] = await Promise.all([
        import('./pick'),
        import('./importPdf'),
        import('../search'),
      ]);
      const [file] = await pickFiles(PDF_TYPES);
      if (!file) return;
      const first = await importPdfAsPages(ctx.platform, ctx.notes, file);
      if (first) await openPage(ctx.notes, first);
    },
  }),
);

commands.register(
  defineCommand({
    id: 'pdf.insert',
    title: 'pdf.commands.insert',
    keywords: 'pdf.commands.keywords',
    category: 'insert',
    icon: 'FilePdf',
    flag: 'interop.pdfImport',
    when: onPage,
    async run() {
      const [{ pickFiles }, { insertPdfIntoPage, bottomOf }, { shownMounted }, { shownTarget }] = await Promise.all([
        import('./pick'),
        import('./importPdf'),
        import('../page'),
        import('./target'),
      ]);
      const mounted = shownMounted.get();
      if (!mounted) return;
      const [file] = await pickFiles(PDF_TYPES);
      if (!file) return;
      await insertPdfIntoPage(await shownTarget(mounted), file, bottomOf(mounted.layer.blocks()));
    },
  }),
);

for (const tool of ['noteSpace', 'handouts'] as const) {
  commands.register(
    defineCommand({
      id: `pdf.${tool}`,
      title: `pdf.commands.${tool}`,
      keywords: 'pdf.commands.keywords',
      category: 'insert',
      icon: tool === 'noteSpace' ? 'Notepad' : 'Rows',
      flag: 'interop.pdfImport',
      when: tool === 'noteSpace' ? onPage : inSection,
      async run(ctx) {
        showOverlay('pdf-tools', LazyTools, { tool, deps: await toolDeps(ctx) });
      },
    }),
  );
}

commandBar.register({
  id: 'insert.pdf',
  tab: 'insert',
  group: 'pdf',
  command: 'pdf.insert',
  priority: 30,
  flag: 'interop.pdfImport',
});
commandBar.register({
  id: 'insert.pdfNoteSpace',
  tab: 'insert',
  group: 'pdf',
  command: 'pdf.noteSpace',
  priority: 12,
  flag: 'interop.pdfImport',
});
// The Home tab's share group follows the tree's New, Edit and Move groups, which register in their own module
// body, so this one waits a microtask as the interop feature's buttons do. Last in the group, after Share.
queueMicrotask(() => {
  commandBar.register({
    id: 'home.pdfImport',
    tab: 'home',
    group: 'share',
    command: 'pdf.import',
    priority: 37,
    flag: 'interop.pdfImport',
  });
});

// The layers over the shown page's pictures: words to select, highlights, and the Evening theme's dimming. The page
// feature loads on its own schedule, so the hook registers once it has, and attaches to a page already shown.
const pageToolsHook: MountedPageHook = {
  id: 'pdf.pageTools',
  attach(mounted) {
    if (!isEnabled('pdf.textLayer') && !isEnabled('pdf.dim') && !isEnabled('pdf.highlights')) return () => undefined;
    let stop: () => void = () => undefined;
    let live = true;
    void tools().then((module) => {
      if (live) stop = module.attachPageTools(mounted);
    });
    return () => {
      live = false;
      stop();
    };
  },
};
void import('../page').then(({ mountedPageHooks, shownMounted }) => {
  mountedPageHooks.register(pageToolsHook);
  const shown = shownMounted.get();
  if (shown) pageToolsHook.attach(shown);
});

const shownPage = async () => (await import('../page')).shownMounted.get();

/** Whether the selection is in the words of a picture on the shown page. */
const wordsSelected = () => {
  const selection = document.getSelection();
  const node = selection && !selection.isCollapsed ? selection.anchorNode : null;
  const element = node instanceof Element ? node : node?.parentElement;
  return Boolean(element?.closest('[data-pdf-text]'));
};

commands.register(
  defineCommand({
    id: 'pdf.highlight',
    title: 'pdf.commands.highlight',
    keywords: 'pdf.commands.highlightKeywords',
    category: 'editing',
    icon: 'Highlighter',
    keys: [chord('Ctrl+Alt+H')],
    presetKeys: { onenote: [chord('Ctrl+Shift+H')] },
    refines: 'format.highlight',
    flag: 'pdf.highlights',
    when: wordsSelected,
    async run() {
      const mounted = await shownPage();
      if (mounted) await (await tools()).highlightSelection(mounted);
    },
  }),
);

commands.register(
  defineCommand({
    id: 'pdf.highlights',
    title: 'pdf.commands.highlights',
    keywords: 'pdf.commands.highlightKeywords',
    category: 'view',
    icon: 'Highlighter',
    flag: 'pdf.highlights',
    when: inSection,
    async run(ctx) {
      const here = getLocation();
      if (here.view !== 'workspace' || !here.sectionId) return;
      const mounted = await shownPage();
      const { pdfOf } = await import('./model');
      const file = mounted?.layer.blocks().map(pdfOf).find(Boolean)?.file ?? null;
      showOverlay('pdf-highlights', LazyHighlights, {
        platform: ctx.platform,
        notes: ctx.notes,
        section: here.sectionId,
        file,
      });
    },
  }),
);

for (const look of ['original', 'dim', 'invert'] as const) {
  commands.register(
    defineCommand({
      id: `pdf.look.${look}`,
      title: `pdf.commands.look.${look}`,
      keywords: 'pdf.commands.lookKeywords',
      category: 'view',
      flag: 'pdf.dim',
      when: onPage,
      async run() {
        const mounted = await shownPage();
        if (!mounted) return;
        const changed = await (await tools()).setLook(mounted, look);
        if (changed === 0) (await import('../../ui')).showToast({ message: t('pdf.look.none') });
      },
    }),
  );
}

commands.register(
  defineCommand({
    id: 'pdf.copyText',
    title: 'pdf.commands.copyText',
    keywords: 'pdf.commands.keywords',
    category: 'editing',
    flag: 'pdf.textLayer',
    when: onPage,
    async run() {
      const mounted = await shownPage();
      if (!mounted) return;
      const { copyPageText } = await tools();
      await copyPageText(mounted);
    },
  }),
);

contextMenus.register({
  id: 'pages.background.noteSpace',
  menu: 'pages.background',
  command: 'pdf.noteSpace',
  group: 'pdf',
  order: 50,
  flag: 'interop.pdfImport',
});

/** The one selected image block on the shown page, if exactly one is selected. */
async function selectedImage() {
  const { pageSelection, shownMounted } = await import('../page');
  const mounted = shownMounted.get();
  const { blocks } = pageSelection.get();
  const block = mounted && blocks.length === 1 ? mounted.layer.block(blocks[0]) : null;
  return mounted && block?.type === 'image' ? { mounted, block } : null;
}

commands.register(
  defineCommand({
    id: 'pdf.scanCleanup',
    title: 'pdf.commands.scanCleanup',
    keywords: 'pdf.commands.scanKeywords',
    category: 'object',
    icon: 'Scan',
    flag: 'pdf.scan',
    when: onPage,
    async run() {
      const chosen = await selectedImage();
      if (!chosen) {
        (await import('../../ui')).showToast({ message: t('pdf.scan.selectFirst') });
        return;
      }
      const { shownTarget } = await import('./target');
      showOverlay('pdf-scan', LazyScan, {
        target: await shownTarget(chosen.mounted),
        block: chosen.block,
        photos: [],
        top: 0,
      });
    },
  }),
);

commands.register(
  defineCommand({
    id: 'pdf.scanPages',
    title: 'pdf.commands.scanPages',
    keywords: 'pdf.commands.scanKeywords',
    category: 'insert',
    icon: 'Scan',
    flag: 'pdf.scan',
    when: onPage,
    async run() {
      const mounted = await shownPage();
      if (!mounted) return;
      const [{ pickFiles }, { shownTarget }, { bottomOf }] = await Promise.all([
        import('./pick'),
        import('./target'),
        import('./importPdf'),
      ]);
      const photos = await pickFiles('image/png,image/jpeg,image/webp', true);
      if (photos.length === 0) return;
      showOverlay('pdf-scan', LazyScan, {
        target: await shownTarget(mounted),
        block: null,
        photos,
        top: bottomOf(mounted.layer.blocks()),
      });
    },
  }),
);

commands.register(
  defineCommand({
    id: 'pdf.scanOriginal',
    title: 'pdf.commands.scanOriginal',
    keywords: 'pdf.commands.scanKeywords',
    category: 'object',
    flag: 'pdf.scan',
    when: onPage,
    async run() {
      const chosen = await selectedImage();
      if (!chosen || typeof chosen.block.data.original !== 'string') return;
      const [{ shownTarget }, { restoreOriginal }] = await Promise.all([import('./target'), import('./scan/apply')]);
      await restoreOriginal(await shownTarget(chosen.mounted), chosen.block);
    },
  }),
);

commandBar.register({
  id: 'insert.scanPages',
  tab: 'insert',
  group: 'pdf',
  command: 'pdf.scanPages',
  priority: 11,
  flag: 'pdf.scan',
});
