// Courses and assignments from Canvas, Moodle, and Google Classroom, and Submit page as PDF.

export const accountsLms = {
  commands: {
    bring: 'Bring in course assignments',
    submit: 'Submit page as PDF',
    keywords: 'canvas moodle classroom google school course class assignment homework due submit hand in turn in',
  },
  notConnected: 'Connect Canvas, Moodle, or Google in Settings, then Connectors, to use your courses.',
  service: {
    title: 'Which school account?',
    description: 'Only the accounts you have connected are listed.',
    confirm: 'Next',
  },
  course: {
    title: 'Which course?',
    description: 'The course becomes a section in the notebook you have open.',
    confirm: 'Bring in',
    submitConfirm: 'Next',
    all: 'All my courses',
    none: 'No active courses were found.',
  },
  assignment: {
    title: 'Which assignment?',
    description: 'The page is handed in as a PDF, as it is now.',
    confirm: 'Hand in',
    none: 'This course has no assignments.',
    detailDue: 'Due {when}',
    detailNoDue: 'No due date',
    detailSubmitted: 'Already handed in. {when}',
  },
  page: {
    due: 'Due {when}',
    noDue: 'No due date.',
    submitted: 'Handed in.',
    open: 'Open in {service}: {link}',
  },
  untitled: 'Untitled assignment',
  working: 'Reading your courses…',
  done: '{courses, plural, one {# course} other {# courses}} brought in: {pages, plural, one {# assignment} other {# assignments}}, {dated} with a due date in Upcoming.',
  submitting: 'Handing in “{title}”…',
  submitted: 'Handed in “{title}” to {course}.',
  saved:
    'Saved “{title}” to your Drive. In Classroom, choose Add or create, then Google Drive, attach it, and turn it in. The link is copied.',
  savedNoLink:
    'Saved “{title}” to your Drive. In Classroom, choose Add or create, then Google Drive, attach it, and turn it in.',
  nothing: 'There is no page to hand in. Open a page, then try again.',
  failedRender: 'The page could not be made into a PDF, so nothing was handed in.',
} as const;
