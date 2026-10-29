// Practice exams from your own notes (Study tools, ADR 0052; owner: the practice exams lane). Every interface string
// is a full sentence, never joined from pieces (ARCHITECTURE.md section 19). The question templates are here too,
// because a paper is text the person reads.

export const exams = {
  tool: 'Practice exams',
  section: 'Practice exams',
  title: 'Practice exam: {source}',
  empty:
    'Make a practice exam from your notes. Open a page, then choose whether the questions come from the page, its ' +
    'section, or its notebook.',
  none:
    'These notes have nothing to ask about yet. Headings with a paragraph under them, "Term: meaning" lines, bold ' +
    'words, and worked problems with a Solution heading make questions. Add some, or choose more pages.',
  making: 'Making the exam on this device…',
  makeFailed: "The exam couldn't be made from these notes. Try again, or choose other pages.",
  back: 'Back to settings',
  command: {
    page: 'Make a practice exam from this page',
    section: 'Make a practice exam from this section',
    notebook: 'Make a practice exam from this notebook',
    open: 'Open practice exams',
    keywords: 'practice exam test paper mock exam questions marks answer key revision study quiz timer',
    noPage: 'Open a page first, then make the exam from it.',
    noSection: 'Open a section first, then make the exam from it.',
    noNotebook: 'Open a notebook first, then make the exam from it.',
    emptyPage: 'This page has no text to make questions from yet.',
    emptyNotes: 'These pages have no text to make questions from yet.',
    protected:
      'This page is in a protected section, so it stays out of practice exams. Unlock it and copy what to study to ' +
      'another page.',
    off: 'Practice exams are off. Turn them on in Settings, then Editing.',
  },
  settings: {
    title: 'Practice exams',
    label: 'Practice exams',
    help:
      'Make exam-style papers from your pages, take them here, and mark them with the answer key. Everything stays ' +
      'on this device.',
    modelLabel: 'Write questions with the language model on this device',
    modelHelp:
      'Used only when you have downloaded a language model. Without one, the questions come from your headings, ' +
      'terms, bold words, and worked problems.',
  },
  setup: {
    label: 'Exam settings',
    from: '{count, plural, one {From # page of {source}.} other {From # pages of {source}.}}',
    skipped:
      // checks-disable-next-line length: one message with its placeholders, kept whole so the key types read it
      '{count, plural, one {# page was left out because it is protected or could not be read.} other {# pages were left out because they are protected or could not be read.}}',
    name: 'Exam name',
    length: 'Number of questions',
    difficulty: 'Difficulty',
    easier: 'Easier',
    standard: 'Standard',
    harder: 'Harder',
    kinds: 'Question types',
    timer: 'Timer',
    timed: 'Time the exam',
    minutes: 'Minutes allowed',
    reminders: 'Remind me with this many minutes left',
    engineModel:
      'Questions are written on this device: by the language model if you have downloaded one, otherwise from your ' +
      'notes by rules.',
    engineRules: 'Questions are written on this device from your headings, terms, bold words, and worked problems.',
    make: 'Make exam',
    noKinds: 'Choose at least one question type.',
    noTitle: 'Give the exam a name.',
  },
  kind: {
    short: 'Short answer',
    choice: 'Multiple choice',
    fill: 'Fill in the blanks',
    worked: 'Worked problem',
    truefalse: 'True or false',
  },
  q: {
    define: 'Define "{term}".',
    explainTerm: 'Explain what "{term}" means. Give the key points.',
    explainTopic: 'Write a short account of {topic}.',
    choiceTerm: 'Which of these describes "{term}"?',
    choiceMeaning: 'Which term matches this description? {meaning}',
    trueFalse: 'True or false: "{term}" means {meaning}',
    fillTerm: '{blank} means {meaning}',
  },
  guide: {
    rightStatement: 'False. "{term}" means {meaning}',
    method: 'Marks for a correct method, even if the final answer is off.',
    working: 'Working: {working}',
    step: 'Step {number}: {step}',
  },
  paper: {
    intro:
      '{count, plural, one {# question} other {# questions}}, {marks, plural, one {# mark} other {# marks}} in all.',
    time: 'Time allowed: {minutes, plural, one {# minute} other {# minutes}}.',
    instructions: 'Answer every question. The marks for each question are shown in brackets.',
    marks: '{count, plural, one {(# mark)} other {(# marks)}}',
    trueOrFalse: 'Circle one: True or False',
    showWorking: 'Show your working, then write your final answer.',
    answerLine: 'Answer: ________________________________',
  },
  key: {
    title: '{title}: answer key',
    intro: 'Answer key and marking guide.',
    guide: 'Marking guide:',
    tolerance: 'Accept answers within {percent} percent of this value, with the unit.',
    source: 'From the notes: {title}',
    unit: 'The unit is part of the answer: a right number without it gets one mark less.',
  },
  answer: {
    true: 'True',
    false: 'False',
    none: 'No answer',
    ink: 'A handwritten answer, kept in the exam window.',
    typedAndInk: '{text} (and a handwritten answer)',
  },
  ready: {
    made: '{count, plural, one {The exam is ready with # question.} other {The exam is ready with # questions.}}',
    byModel: 'The language model on this device wrote these questions from your notes.',
    byRules: 'These questions come from your notes, written by rules on this device.',
    fewer:
      '{count, plural, one {Your notes had enough for # question.} other {Your notes had enough for # questions.}}',
    start: 'Start exam',
    save: 'Save the blank paper as a page',
    saveNote: 'The answer key is saved with your results, after you submit.',
  },
  resume: {
    heading: 'Unfinished exams',
    progress: '{answered} of {total} answered.',
    running: 'Timer running, {time} left.',
    paused: 'Timer paused with {time} left.',
    carryOn: 'Carry on with {title}',
    drop: 'Discard {title}',
    dropped: 'Discarded {title}.',
    resumed: 'Carrying on with {title}. Your answers are back.',
  },
  take: {
    counter: 'Question {number} of {total}',
    questionNumber: 'Question {number}',
    hintShort: 'Write your answer in a few sentences.',
    hintChoice: 'Choose one answer.',
    hintFill: 'Fill in each blank.',
    hintWorked: 'Show your working, then give the final answer.',
    hintTrueFalse: 'Choose true or false.',
    optionsFor: 'Answers for question {number}',
    blank: 'Blank {number}',
    blankMark: '(blank {number})',
    working: 'Your working',
    finalAnswer: 'Final answer',
    yourAnswer: 'Your answer',
    mathHint: 'Type a number or an expression, such as 9.8 m/s^2 or 2(x + 1). Units are checked.',
    unitHint: 'Include the unit. A right number without its unit loses a mark.',
    flag: 'Flag for review',
    unflag: 'Remove flag',
    showAll: 'Show all questions',
    oneAtATime: 'Show one question at a time',
    navigation: 'Questions',
    jump: 'Question {number}, {state}',
    stateAnswered: 'answered',
    stateOpen: 'not answered',
    stateFlagged: 'flagged for review',
    previous: 'Previous question',
    next: 'Next question',
    submit: 'Submit exam',
    keepGoing: 'Keep working',
    submitTitle: 'Submit the exam?',
    submitBody:
      // checks-disable-next-line length: one message with its placeholders, kept whole so the key types read it
      '{open, plural, =0 {Every question has an answer.} one {# question has no answer.} other {# questions have no answer.}} {flagged, plural, =0 {No questions are flagged.} one {# question is flagged for review.} other {# questions are flagged for review.}}',
  },
  timer: {
    left: 'Time left: {time}',
    pause: 'Pause timer',
    resume: 'Resume timer',
    paused: 'Timer paused.',
    resumed: 'Timer running again.',
    reminder: '{minutes, plural, one {# minute left.} other {# minutes left.}}',
    up: 'Time is up. Finish your answer, then submit when you are ready.',
  },
  ink: {
    area:
      // checks-disable-next-line length: one message with its placeholders, kept whole so the key types read it
      '{count, plural, =0 {Writing area for {label}, empty} one {Writing area for {label}, # stroke} other {Writing area for {label}, # strokes}}',
    show: 'Write the answer by hand',
    hide: 'Hide the writing area',
    undo: 'Undo last stroke',
    clear: 'Clear writing',
    read: 'Read my writing as math',
    reading: 'Reading your writing on this device…',
    readDone: 'Read as {text}. Check it before you submit.',
    readNothing: "Your writing couldn't be read as math. Type the answer instead.",
    readFailed: "Handwriting reading isn't available right now. Type the answer instead.",
  },
  results: {
    title: '{title}: results',
    marking: 'Marking your answers…',
    markedSummary:
      // checks-disable-next-line length: one message with its placeholders, kept whole so the key types read it
      '{count, plural, =0 {Marked: {got} of {of} marks.} one {Marked so far: {got} of {of} marks. # question is yours to mark.} other {Marked so far: {got} of {of} marks. # questions are yours to mark.}}',
    score: 'Score: {got} of {of} marks ({percent} percent)',
    unmarked:
      // checks-disable-next-line length: one message with its placeholders, kept whole so the key types read it
      '{count, plural, one {# question is yours to mark. Compare your answer with the key, then choose a mark.} other {# questions are yours to mark. Compare each answer with the key, then choose a mark.}}',
    question: 'Question',
    marks: 'Marks',
    yourAnswer: 'Your answer',
    key: 'Answer key',
    yourMark: 'Your mark',
    got: '{got} of {of}',
    notMarked: 'Not marked',
    toMark: 'To mark',
    byApp: 'Marked by OpenNote.',
    noteUnit: 'The number is right but the unit is missing.',
    noteClose: 'Within the allowed rounding.',
    noteBlank: 'No answer was given.',
    noteUnreadable: "The answer couldn't be read as math.",
    weakTitle: 'Topics to review',
    weakHeading: 'Topics to review:',
    weakLine: '{topic}: {got} of {of} marks',
    weakNone: 'No weak topics. Every topic got at least 60 percent of its marks.',
    weakWait: 'Mark the rest of your answers to see the topics to review.',
    open: 'Open {title}',
    pageGone: "That page couldn't be found. It may have been moved to Trash.",
    toCards: 'Add missed questions to flashcards',
    noneMissed: 'No missed questions to add. Mark the rest first, if any are left.',
    sent:
      // checks-disable-next-line length: one message with its placeholders, kept whole so the key types read it
      '{count, plural, =0 {These questions are in "{deck}" already.} one {Added # card to "{deck}".} other {Added # cards to "{deck}".}}',
    save: 'Save results as a page',
    again: 'Make another exam',
  },
  save: {
    paperSaved: 'Saved the blank paper in the Practice exams section. Print or export it from there.',
    resultsSaved: 'Saved the results in the Practice exams section.',
    noNotebook: "There's no notebook to save in. Open a page in a notebook, then try again.",
    failed: "The exam couldn't be saved. Your answers are still here; try again in a moment.",
  },
  deck: {
    name: '{title}: missed questions',
  },
} as const;
