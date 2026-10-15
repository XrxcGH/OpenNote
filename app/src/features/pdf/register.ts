// Registers the PDF commands (A4-10, A2-20): Import PDF as pages, Insert PDF into the page, Add note space, and Make
// handouts, in the palette and on the Insert tab. The work and pdf.js load when a command runs, so start-up carries
// only this file.
import { lazy } from 'react';
import { getLocation } from '../../app/location';
import { defineCommand } from '../../commands/registry';
import type { CommandContext } from '../../commands/types';
import { commandBar, commands } from '../../registries';
import { showOverlay } from '../../shell/commandbar/overlays';
import type { ToolDeps } from './actions';

const LazyTools = lazy(() => import('./PdfToolsDialog'));

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
commandBar.register({
  id: 'home.pdfImport',
  tab: 'home',
  group: 'share',
  command: 'pdf.import',
  priority: 38,
  flag: 'interop.pdfImport',
});
