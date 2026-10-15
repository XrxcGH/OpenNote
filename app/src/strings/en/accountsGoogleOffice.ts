// Google Docs, Sheets, and Slides: import from Drive, and export to Google's own file types.

export const accountsGoogleOffice = {
  commands: {
    import: 'Import from Google Docs, Sheets, or Slides',
    docs: 'Export to Google Docs',
    sheets: 'Export tables to Google Sheets',
    slides: 'Export to Google Slides',
    keywords: 'google docs sheets slides drive import export convert word excel powerpoint',
  },
  kind: {
    title: 'Import from Google',
    description:
      'Drive turns the file into a Word, Excel, or PowerPoint file, and OpenNote imports that. You see what will come over before anything is added.',
    confirm: 'Next',
    docs: 'A Google Doc',
    sheets: 'A Google Sheet',
    sheetsDetail: 'Each sheet becomes a page with a table.',
    slides: 'Google Slides',
    slidesDetail: 'Each slide becomes a page you can write on.',
  },
  file: {
    title: 'Choose a file',
    description: 'Your most recent files of this kind.',
    confirm: 'Import',
    none: 'No files of this kind were found in your Drive.',
  },
  untitled: 'Untitled',
  fetching: 'Getting “{name}” from Google…',
} as const;
