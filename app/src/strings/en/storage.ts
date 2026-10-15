// Storage and protection (beta 5): text edited in other apps, files only in the cloud, opening page.md in another
// editor, renaming notebook folders, changing the notes folder, checking a notebook, locked entries, and protected
// sections. Every interface string is a full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const storage = {
  edits: {
    notice: 'The text of this page was edited in another app.',
    bringIn: 'Bring in the text changes',
    dismiss: 'Not now',
    title: 'Bring in the text changes?',
    intro: 'These changes from page.md come into the page as one step, which Undo takes back.',
    loading: 'Reading the changes…',
    newTitle: 'New title: {title}',
    newTags: 'New tags: {tags}',
    replace: 'Changed: {text}',
    insert: 'Added: {text}',
    remove: 'Removed a paragraph.',
    more: '{count, plural, one {And # more change.} other {And # more changes.}}',
    nothing: 'The edited file has no text changes to bring in.',
    conflicts:
      '{count, plural, one {# paragraph changed here and in the other app. It keeps the text it has here.} other {# paragraphs changed here and in the other app. They keep the text they have here.}}',
    skipped:
      '{count, plural, one {# change to a picture, table, or drawing stays as it is here.} other {# changes to pictures, tables, or drawings stay as they are here.}}',
    tooDifferent: 'The file is too different from the page to compare paragraph by paragraph.',
    baseUnknown: 'OpenNote compared the file with the page as it is now, so recent edits here may be undone.',
    apply: 'Bring in',
    discard: 'Discard the edited file',
    cancel: 'Not now',
    done: 'Brought in the text changes.',
    discarded: 'The edited file is discarded.',
    failed: "Couldn't bring in the changes. The page hasn't changed.",
    notShown: 'Open the page first, then bring in the changes.',
  },
  cloud: {
    downloading:
      '{total, plural, one {Downloading # file of this page from the cloud…} other {Downloading # files of this page from the cloud…}}',
    progress: '{done} of {total} downloaded',
    done: 'The files of this page are on this device.',
    failed:
      "{count, plural, one {# file of this page is only in the cloud and didn't download.} other {# files of this page are only in the cloud and didn't download.}} Connect to the internet, then open the page again.",
    dismiss: 'Close',
  },
  source: {
    openExternal: 'Open in another editor',
    keywords: 'page.md Markdown source external editor VS Code Notepad Obsidian',
    opened: 'page.md is open in your editor. Save it there, and OpenNote offers to bring the changes in.',
    failed: "Couldn't open page.md. Windows may have no app for Markdown files.",
    noPage: 'Open a page first.',
  },
  folders: {
    rename: 'Rename folders with notebooks',
    renameHelp:
      'When you rename a notebook, its folder takes the new name too. Other apps that point at the old folder need the new one.',
    renameFailed:
      'The notebook has its new name, but its folder kept the old one because another app is using a file in it.',
  },
  notesFolder: {
    title: 'Notes folder',
    current: 'Your notebooks are in {path}.',
    none: 'No notes folder is chosen yet.',
    change: 'Change notes folder',
    notWritable: "OpenNote can't save in that folder. Choose another one.",
    insideApp: 'That folder belongs to the OpenNote program. Choose another one.',
    notAbsolute: 'Choose a whole folder path, such as one on this PC.',
    same: 'That is already your notes folder.',
    inside: 'Choose a folder outside your notes folder, and not one that holds it.',
    askTitle: 'Use {path} for your notes?',
    askEmpty: 'Move your notebooks there, or keep them where they are and put new notebooks there.',
    askHas:
      '{count, plural, one {It already has # notebook.} other {It already has # notebooks.}} Move your notebooks there too, or use the notebooks that are there.',
    move: 'Move my notebooks',
    use: 'Use the notebooks there',
    useEmpty: 'Only new notebooks',
    cancel: 'Cancel',
    moving: 'Moving notebook {notebook} of {notebooks}…',
    progress: '{done} of {total} files copied and checked',
    stop: 'Stop moving',
    moved:
      '{count, plural, one {Moved # notebook to {path}. Its old folder is in the Recycle Bin.} other {Moved # notebooks to {path}. Their old folders are in the Recycle Bin.}}',
    stopped:
      'Stopped. Notebooks already moved are in the new folder, and the rest stay where they were. The notes folder is unchanged.',
    failed:
      "{count, plural, one {# notebook couldn't move and stays where it was.} other {# notebooks couldn't move and stay where they were.}} The notes folder is unchanged.",
    switched: 'New notebooks now go to {path}.',
    busy: 'The notebooks are already moving.',
  },
} as const;
