// The script formatter's text: field labels, result rows, worked steps, notes, and problems.
export const script = {
  t: {
    script: {
      title: 'Script formatter',
      short: 'Script',
      keywords:
        'screenplay playwriting script fountain format scene heading dialogue character page count breakdown sheet ' +
        'location list stage play film television',
      about:
        'Write a screenplay or stage play in plain Fountain text and see it laid out in script format, with a page ' +
        'estimate, a scene list, character and location lists, and breakdown sheets.',
    },
  },
  f: {
    scMode: 'What to show',
    scFormat: 'Formatted script and page estimate',
    scClassify: 'How each line was read',
    scScenes: 'Scene list',
    scCharacters: 'Character list',
    scLocations: 'Location list',
    scBreakdown: 'Breakdown sheets',
    scLayout: 'Layout',
    scScreenplay: 'Screenplay',
    scStage: 'Stage play',
    scScript: 'Script in Fountain',
    scScriptHint:
      'Scene headings start with INT. or EXT. Character names are in capitals above their lines. Put ! before a line to force action, @ before a name, or . before a heading.',
  },
  r: {
    pagesOut: 'Pages (estimate)',
    minutesOut: 'Running time in minutes (estimate)',
    linesOut: 'Typed lines',
    sceneCount: 'Scenes',
    characterCount: 'Speaking characters',
    typeCount: 'Lines read as {type}',
    sceneRow: 'Scene {n}',
    castRow: '{name}',
    placeRow: '{name}',
    sheetRow: 'Scene {n}',
  },
  s: {
    scLayoutSteps:
      'Each element is placed in character cells for a {layout}: action across the page, dialogue in a narrower column, and character names indented.',
    scPagesSteps: 'The script has {lines} typed lines. At 55 lines to a page that is {pages} pages, rounded up.',
    scTimeSteps: 'At about one minute for each page, the running time is about {pages} minutes.',
    scClassifyRules:
      'A line is a scene heading when it starts with INT. or EXT. after a blank line, a transition when it is in capitals and ends in TO:, and a character name when it is in capitals above a line of dialogue.',
    scClassifyForced: 'A leading ! . @ or > forces action, a scene heading, a character name, or a transition.',
    scScenesEighths: 'A scene is measured in eighths of a page: its typed lines times eight, divided by 55, rounded up.',
    scScenesPage: 'The page is the one where the scene heading falls.',
    scCastCount: 'A speech is one block of dialogue under a character name. Words are counted in the dialogue only.',
    scCastName: 'Extensions such as (V.O.) and (CONT’D) are ignored, so one character is counted once.',
    scPlacesSplit: 'Each heading is split into INT. or EXT., the place, and the time of day after the last dash.',
    scBreakdownCast: 'The cast of a scene is every character who speaks in it.',
    scBreakdownProps: 'Props are the words written in capitals inside action lines, a common script convention.',
    scBreakdownEdit: 'Extras, wardrobe, and other columns are for you to fill in after inserting the table.',
  },
  e: {
    scEmpty: 'Type or paste a script first. Fountain is plain text.',
    scTooLong: 'The script is too long for this tool. Try one act at a time.',
    scNoScenes: 'No scene headings were found. A heading starts with INT. or EXT., or with a period.',
    scNoCharacters: 'No character names were found. Write a name in capitals above each speech.',
  },
  n: {
    scNoteEstimate: 'Pages and running time are estimates from the one-page-a-minute rule of thumb.',
    scNoteLayout: 'Margins are set in character cells for a monospaced script font.',
    scNoteForced: 'Dual dialogue marked with ^ is laid out as ordinary dialogue here.',
    scNoteBreakdown: 'The sheet is a starting point seeded from the text; check it against the script.',
  },
} as const;
