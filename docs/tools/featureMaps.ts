// The words the registries lack, for the feature list (featureList.ts). They are its categories and a place for each
// section and row of FEATURES.md, each command prefix, and each picture. Each title bar item also gets a sentence.
// app/src/app/featureRegistry.test.ts fails when a registered command or title bar item has no place here.

/** The categories of the Screens page (docs/screens/README.md), in order. Every one needs a picture. */
export const SCREEN_CATEGORIES = [
  'First-time setup',
  'The workspace',
  'Writing and page blocks',
  'Drawing and ink',
  'Find, link, and organize',
  'Audio and transcripts',
  'Import and export',
  'Study and homework',
  'Math, graphs, and calculators',
  'Engineering kits',
  'Science kits',
  'Data and society kits',
  'Humanities and arts kits',
  'Connectors and sync',
  'Settings',
  'Trash, the palette, and tool windows',
] as const;

/** The categories of the feature list, in order. */
export const CATEGORIES = [
  'Writing and typing',
  'Tables and charts',
  'Drawing and ink',
  'Page views and printing',
  'Notebooks and navigation',
  'Search and links',
  'Audio and transcription',
  'Math and homework',
  'Engineering kits',
  'Subject and catalog kits',
  'Study tools',
  'On-device intelligence',
  'Import and export',
  'Sync and connectors',
  'Protection and privacy',
  'Settings and accessibility',
  'Platforms',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** Where each section of FEATURES.md goes. A `###` part is named by its own title, such as "Phase 4: Typed notes". */
export const SECTION_CATEGORY: Readonly<Record<string, Category>> = {
  'Office and Google Workspace': 'Sync and connectors',
  'Video and audio platforms': 'Sync and connectors',
  'More integrations': 'Sync and connectors',
  'Handwriting to text': 'Drawing and ink',
  'My handwriting': 'Drawing and ink',
  'Shapes and lines': 'Drawing and ink',
  'Transcripts and summaries': 'Audio and transcription',
  'Study tools': 'Study tools',
  'Civil, environmental, and chemical engineering tools': 'Engineering kits',
  'Page layouts': 'Page views and printing',
  'Export a selection': 'Import and export',
  'On-device intelligence setup': 'On-device intelligence',
  'Pages and search additions': 'Search and links',
  'Quality-of-life fixes': 'Notebooks and navigation',
  'Phase 2: App shell and navigation': 'Notebooks and navigation',
  'Phase 3: Document model and storage': 'Notebooks and navigation',
  'Phase 4: Typed notes': 'Writing and typing',
  'Phase 5: Ink': 'Drawing and ink',
  'Phase 6: Page views and export': 'Page views and printing',
  'Phase 7: Smart tables and charts': 'Tables and charts',
  'Phase 8: Search and linking': 'Search and links',
  'Phase 9: Audio recording': 'Audio and transcription',
  'Phase 10: Math and study tools': 'Math and homework',
  'Phase 11: Import and export': 'Import and export',
  'Phase 12: On-device intelligence': 'On-device intelligence',
  'Phase 13: Hardening and beta': 'Protection and privacy',
  'Math solvers': 'Math and homework',
  '3D graphs, vectors, and motion': 'Math and homework',
  'Engineering tools': 'Engineering kits',
  'Statistical models kit': 'Subject and catalog kits',
  'Music, script, camera, and studio tools': 'Subject and catalog kits',
  'Subject tool kits': 'Engineering kits',
  'Document structure': 'Writing and typing',
  'macOS and Linux': 'Platforms',
  'Subject kit foundations': 'Subject and catalog kits',
  'History, places, languages, and texts kit': 'Subject and catalog kits',
  'Signals, images, sound, and communications': 'Engineering kits',
  'Modern physics and astronomy tools': 'Subject and catalog kits',
  'Molecular biology, genetics, and evolution': 'Subject and catalog kits',
  'Economics and finance': 'Subject and catalog kits',
  'Statistics kit': 'Subject and catalog kits',
  'Psychology and behavior kit': 'Subject and catalog kits',
  'Life science tools': 'Subject and catalog kits',
  'Appearance and layout': 'Settings and accessibility',
};

const named = (names: string) => new RegExp(`^- \\*\\*(${names})\\.\\*\\*`);

/** Rows that sit in a section about something else, by their name or the start of their text. */
export const ROW_CATEGORY: readonly (readonly [RegExp, Category])[] = [
  [/^- (\*\*)?(Palm lab|Pen library|Links on handwriting|Ink layers|Pen writing in text fields)/, 'Drawing and ink'],
  [/^- (\*\*)?(Delegated ink|Smart select)/, 'Drawing and ink'],
  [named('Snap tools|Measuring ruler, measure, and compass|Snap to paper lines'), 'Drawing and ink'],
  [
    named('Upcoming list|Repeating to-dos|Class schedule|Exam countdown|Timers|Dictionary and thesaurus'),
    'Study tools',
  ],
  [
    named('Reference tables|Calendar files and course imports|Citation helper|Zotero citations in the page'),
    'Study tools',
  ],
  [named('Study tape|Exam dates for decks|Inline flashcards|Practice exams|Deck import'), 'Study tools'],
  [named('Reading order|Read aloud'), 'Audio and transcription'],
  [
    named('Language and spelling|Spell check|Interface size|Shortcut cheat sheet|OneNote shortcuts'),
    'Settings and accessibility',
  ],
  [named('Accessibility checker|Accessible charts|Math that screen readers speak'), 'Settings and accessibility'],
  [named('Password-protected sections|Protected sections lock again|Lock entry'), 'Protection and privacy'],
  [named('App permissions and access log'), 'Protection and privacy'],
  [named('Installed apps entry|Updates that resume and wait for an unmetered network'), 'Platforms'],
  [named('Update downloads that resume|Portable mode|Command-line tool|Low-power mode'), 'Platforms'],
  [
    named('Export|Print preview|Print to a printer|Page title on printouts|Presentation mode|Reading mode'),
    'Page views and printing',
  ],
  [named('Find and replace|Typed #hashtags|Links|Copy text from images'), 'Search and links'],
  [named('Pen settings sync'), 'Sync and connectors'],
  [
    named('Kit foundation|Live calculation block|Chemistry and materials|Physics tools|Earth sciences|Reasoning kit'),
    'Subject and catalog kits',
  ],
];

/** One sentence for each title bar item (featureRegistry.test.ts checks that every item has one). */
export const TITLE_BAR: Readonly<Record<string, { name: string; text: string }>> = {
  'nav.back': { name: 'Back', text: 'Goes back to the page or screen you had open before.' },
  'nav.forward': { name: 'Forward', text: 'Goes forward again after Back.' },
  'layout.breadcrumb': { name: 'Breadcrumb', text: 'Shows the notebook, section, and page you are on.' },
  'page.undoButton': { name: 'Undo', text: 'Undoes the last change.' },
  'page.redoButton': { name: 'Redo', text: 'Redoes the change you undid last.' },
  'search.open': { name: 'Search', text: 'Opens search across your notebooks.' },
  'daily.open': { name: 'Today', text: "Opens today's daily note." },
  'notes.saveStatus': {
    name: 'Save status',
    text:
      "Says Saving until an edit is written and Saved once it is, or Couldn't save, Offline, or Not responding. " +
      "Choose Couldn't save to see why, then Retry or Copy text.",
  },
  'sync.status': {
    name: 'Sync',
    text: 'Says Synced, Syncing, Sync paused, Sync waiting, or Sync stopped, and opens sync.',
  },
  'theme.toggle': { name: 'Theme', text: 'Switches between the light and dark themes.' },
  'tools.timerChip': { name: 'Timers', text: 'Shows a running timer and its time left, and opens the Timers window.' },
  'updates.chip': { name: 'Update', text: 'Says Update available or Update ready, and opens the details.' },
  'diagnostics.offline': { name: 'Working offline', text: 'Shows that OpenNote makes no network requests right now.' },
  'diagnostics.safeMode': {
    name: 'Safe mode',
    text: 'Shows that OpenNote started in safe mode, with some extras off.',
  },
  'audio.indicator': { name: 'Recording', text: 'Shows a recording and its time, and opens the recording controls.' },
};

const writing: Category = 'Writing and typing';
const views: Category = 'Page views and printing';
const navigation: Category = 'Notebooks and navigation';
const math: Category = 'Math and homework';
const study: Category = 'Study tools';
const connectors: Category = 'Sync and connectors';
const settings: Category = 'Settings and accessibility';

/** Each of the space-separated command id prefixes in one category. */
const all = (prefixes: string, category: Category) =>
  Object.fromEntries(prefixes.split(' ').map((p) => [p, category] as const));

/** Where commands go, by the start of their id. The longest match wins; tool windows claim their own first. */
export const COMMAND_PREFIX: Readonly<Record<string, Category>> = {
  ...all(
    'block code format para outline text link styles checklist templates series edit spelling insert object image doc',
    writing,
  ),
  ...all(
    'page.undo page.redo page.newTextBox page.markdownSource page.openInEditor page.announceWordCount page.selectTitle',
    writing,
  ),
  'insert.table': 'Tables and charts',
  'insert.chart': 'Tables and charts',
  table: 'Tables and charts',
  page: views,
  pages: views,
  canvas: views,
  'pages.export': 'Import and export',
  ink: 'Drawing and ink',
  intel: 'On-device intelligence',
  ...all(
    'pages.indent pages.outdent page.extractSelection page.mergePages page.splitAtHeadings layout nav view window tabs',
    navigation,
  ),
  ...all('tree notes app trash history daily collections insert.collection tools.resetWindows', navigation),
  search: 'Search and links',
  graph: 'Search and links',
  'page.find': 'Search and links',
  'page.replace': 'Search and links',
  ...all('audio transcripts readAloud media meetings', 'Audio and transcription'),
  ...all('math tutor sigfigs insert.graph insert.equation insert.inlineMath insert.curveGraph insert.plot3d', math),
  ...all('insert.freeBodyDiagram insert.beam insert.truss insert.circuit', 'Engineering kits'),
  ...all('study tape citations insert.flashcards insert.quiz insert.tape insert.bibliography', study),
  interop: 'Import and export',
  pdf: 'Import and export',
  'insert.fromPhone': 'Import and export',
  ...all('sync sendto share lms googleOffice onenote tasks penSync readwise', connectors),
  protect: 'Protection and privacy',
  diagnostics: 'Protection and privacy',
  ...all('settings theme view.zoom app.settings app.shortcuts page.checkAccessibility', settings),
  updates: 'Platforms',
  api: 'Platforms',
  'app.systemSupport': 'Platforms',
};

/** Where a screens.json picture goes: by its name first, else by its Screens page category. */
export const SCREEN_CATEGORY: Readonly<Record<string, Category>> = {
  'First-time setup': settings,
  'The workspace': navigation,
  'Writing and page blocks': writing,
  'Drawing and ink': 'Drawing and ink',
  'Find, link, and organize': 'Search and links',
  'Audio and transcripts': 'Audio and transcription',
  'Import and export': 'Import and export',
  'Study and homework': study,
  'Math, graphs, and calculators': math,
  'Engineering kits': 'Engineering kits',
  'Science kits': 'Subject and catalog kits',
  'Data and society kits': 'Subject and catalog kits',
  'Humanities and arts kits': 'Subject and catalog kits',
  'Connectors and sync': connectors,
  Settings: settings,
  'Trash, the palette, and tool windows': navigation,
  'table-chart': 'Tables and charts',
  'canvas-view': views,
  'print-preview': views,
  translate: 'On-device intelligence',
  'speech-model': 'On-device intelligence',
  'writing-tools': 'On-device intelligence',
  'settings-intelligence': 'On-device intelligence',
  'setup-intelligence': 'On-device intelligence',
  'study-tutor': math,
  'step-checker': math,
  'subject-statistics': math,
  collections: navigation,
  'daily-calendar': navigation,
  'protected-section': 'Protection and privacy',
  'settings-privacy': 'Protection and privacy',
  'settings-app-permissions': 'Protection and privacy',
  'settings-connectors': connectors,
  'accessibility-checker': settings,
  'settings-my-handwriting': 'Drawing and ink',
  'settings-pen': 'Drawing and ink',
  'settings-recording': 'Audio and transcription',
};
