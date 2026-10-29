// Importing from Goodnotes, Notability, and Samsung Notes (ADR 0053). Its own namespace, so parallel work never
// edits the same strings file.

export const notesApps = {
  heading: 'Handwriting apps',
  intro:
    'OpenNote reads these apps’ own files. What it cannot read yet, such as Goodnotes’ and Samsung Notes’ ' +
    'handwriting, is listed in the check before anything is added.',
  apps: {
    goodnotes: 'Goodnotes documents (.goodnotes) and backups of them',
    notability: 'Notability notes (.note), with handwriting, text, pictures, and recordings',
    samsungNotes: 'Samsung Notes notes (.sdocx)',
  },
  pdfHint:
    'The dependable way, which keeps every page as it looks: export a PDF from the app, then use Import PDF. ' +
    'In Goodnotes, choose Share, then Export, then PDF. In Notability, choose Share, then PDF. ' +
    'In Samsung Notes, choose Share, then PDF file.',
  importPdf: 'Import a PDF…',
  off:
    'Reading Goodnotes, Notability, and Samsung Notes files is turned off in this build. Export a PDF from the ' +
    'app, then use Import PDF. You can turn the reader on in Settings, under Experimental features.',
} as const;
