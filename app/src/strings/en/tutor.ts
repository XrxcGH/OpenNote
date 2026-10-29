// The tutor (owner: the dn-tutor lane, ADR 0050): hints that lead to the next step without giving the answer away,
// and an explanation of a step that Check my work flagged. Written for students: short, kind, and plain.

export const tutor = {
  commands: {
    open: 'Open the tutor',
    openKeywords: 'tutor, help, study, homework, explain, hint, ai',
    hint: 'Give me a hint',
    hintKeywords: 'tutor, hint, stuck, help, homework, next step, problem',
    explain: 'Explain this step',
    explainKeywords: 'tutor, explain, mistake, why, wrong, check my work',
  },
  turnOn: {
    title: 'Turn on the tutor?',
    body:
      'The tutor gives hints and explains mistakes without giving the answer away. ' +
      'It runs on this device and reads only the text you show it.',
    confirm: 'Turn on',
    cancel: 'Not now',
  },
  setting: {
    label: 'Tutor',
    help:
      'Hints, one small step at a time, and explanations of steps that Check my work flags. ' +
      'It runs on this device and reads only the text you show it.',
    engineName: 'the tutor',
    engineHelp:
      'With a language model downloaded, the tutor writes its own hints on this device. ' +
      'Without one, it uses its built-in hints.',
  },
  panel: {
    title: 'Tutor',
    close: 'Close the tutor',
    contextLabel: 'What the tutor sees',
    contextHelp:
      'The tutor reads only this text. Edit it, or take the selected lines from the page (with nothing selected, its math).',
    useSelection: 'Use selected lines',
    clear: 'Clear',
    empty: 'Pick a problem on the page, or type one in the box, then ask for a hint.',
    log: 'Conversation with the tutor',
    hint: 'Give me a hint',
    nextHint: 'Next hint',
    explain: 'Explain the mistake',
    solution: 'Show the full solution',
    solutionLocked: 'Try a hint or a step first. Then the full solution is here if you want it.',
    askLabel: 'Ask the tutor',
    askHelp: 'Ask about the text above. The tutor guides you and leaves the answer to you.',
    send: 'Send',
    you: 'You',
    tutorName: 'Tutor',
    thinking: 'Thinking…',
    rung: 'Hint {rung} of 4: {name}',
    lastRung: 'That was the last hint. Try the step yourself, or ask for the full solution.',
    where: {
      rules: 'Built-in hints, on this device.',
      device: 'Written by the language model on this device.',
      cloud: 'Written with your key by {host}.',
      cloudKey: 'Written with your key by your cloud service.',
      offline: 'Work offline is on, so the tutor stays on this device.',
    },
    fellBack: 'The other engine could not help this time, so this hint is built in.',
  },
  rungs: {
    where: 'Where to look',
    idea: 'The idea',
    question: 'A question to try',
    step: 'The next step',
  },
  consent: {
    title: 'Send this to {host}?',
    body: 'This text goes to {host} with your key.',
    covers:
      'Each request shows its exact text here before it goes, so your next hint asks again. ' +
      'If you say no, this text stays on this device until you close the panel.',
    sent: 'Text to send',
    send: 'Send this',
    keep: 'Keep it on this device',
  },
  solutionConfirm: {
    title: 'Show the full solution?',
    body: 'Working it out yourself helps it stick. Show the whole solution anyway?',
    confirm: 'Show it',
    cancel: 'Keep trying',
  },
  errors: {
    nothing: 'There is no problem to work with yet. Select it on the page, or type it in the box.',
    tooLong: 'That is more text than the tutor reads at once. Pick the problem and your working only.',
    handwritingOff:
      'Reading handwriting is off, so the tutor can use typed lines only. Turn it on in Settings, then Ink.',
    readFailed: 'The handwriting could not be read just now. Try again, or type the lines instead.',
    noMistake: 'Check my work found no step to explain here. Ask for a hint instead.',
  },
  mistake: {
    where: 'Look at line {number}. Compare it with line {previous}, the line just before it.',
    explain: 'Line {number} does not follow from line {previous}. {idea}',
    step: 'That step could be: {line}',
    stepUnknown: 'Redo line {number} from line {previous}, one change at a time.',
    stepIsAnswer: 'Fixing this step gets you to the answer. Try it, or ask for the full solution.',
  },
  ideas: {
    sign: 'When a term moves to the other side of the equals sign, its sign changes: plus becomes minus.',
    signFlip: 'A whole line changing sign usually means a minus sign was lost along the way.',
    inequality: 'Multiplying or dividing both sides of an inequality by a negative number turns the sign around.',
    factor: 'Whatever you multiply or divide by, do it to every term on both sides.',
    constant: 'Adding or taking away a number has to happen on both sides, to keep things balanced.',
    value: 'Each new line should say the same thing as the line before it, in a simpler form.',
    derivative: 'Take the derivative one piece at a time, with the rule that fits each piece.',
    antiderivative: 'You can check an integral by taking the derivative of your answer.',
    units: 'You can add or compare amounts only when they measure the same kind of thing, in the same unit.',
    matrixEntry: 'Each entry comes from one row of the first matrix and one column of the second.',
    matrixShape: 'Two matrices multiply only when the first has as many columns as the second has rows.',
    general: 'Each new line should follow from the one before it by one clear move.',
  },
  questions: {
    sign: '{term} moved across the equals sign. What sign should it have on the other side?',
    signFlip: 'Where could a minus sign have been dropped between these two lines?',
    inequality: 'Did you multiply or divide by a negative number here? What happens to the sign then?',
    factor: 'This line is {factor} times the one before. Which term was multiplied, and which was not?',
    constant: 'A number was added or taken away here that the line before does not account for. Which one, and where?',
    valueAt: 'Try {at} in both lines. Do they give the same result? Which move changed it?',
    value: 'Work out both lines for one easy value. Do they match? Which move changed it?',
    derivative: 'Which rule fits the outside of the expression, and what does it give for the first piece?',
    antiderivative: 'If you take the derivative of your answer, do you get back what you started with?',
    units: 'What unit is each part in? Can you change them to one unit first?',
    matrixEntry: 'Look again at row {row}, column {column}. Which numbers go into that entry?',
    matrixShape: 'How many rows and columns does each one have?',
    general: 'What did you do to get from line {previous} to line {number}? Try that move again.',
  },
  equation: {
    where: 'Look at what is being done to {letter}, and which numbers are on the same side.',
    idea: 'To get {letter} on its own, undo what is done to it, one step at a time, on both sides.',
    collect: 'What could you add or take away on both sides, so {letter} is on one side and numbers on the other?',
    divide: '{letter} is multiplied by {coefficient}. What could you do to both sides to undo that?',
    step: 'The next line could be: {line}',
    check: 'Check it: put your answer back into the first line. Do both sides match?',
  },
  calculus: {
    where: {
      derivative:
        'Look at how the expression is built: is it a sum, a product, a quotient, or one function inside another?',
      integral: 'Look at what is being integrated. Can it be split into simpler pieces?',
      limit: 'Try putting the value straight in first. What happens?',
      sum: 'Write out the first few terms. Do you see a pattern?',
    },
    idea: 'This step uses one rule. {rule}',
    ideaPlain: 'This step uses one rule from your notes on this topic.',
    question: {
      derivative: 'Which rule fits the outside of the expression? What does it give for the first piece?',
      integral: 'Which rule fits what is being integrated? What does it give for the first piece?',
      limit: 'What does the expression get close to, from each side?',
      sum: 'What do the terms have in common? Is there a ratio or a formula that fits?',
    },
    step: 'The next step: {line}',
  },
  general: {
    where: 'Find the key words in the question. What exactly is it asking for?',
    idea: 'Think about which idea from your notes this question is about.',
    question: 'Can you say in one sentence what a good answer needs to show?',
    step: 'Try a first sentence that uses the question’s own words, then add one reason or example.',
    noSolution:
      'The built-in tutor can work out full solutions to math only. Your notes are a good place to look next.',
  },
  done: {
    hint: 'Every step I could check follows. Nice work. Check your answer by putting it back into the first line.',
  },
  solution: {
    lead: 'Here is the full solution:',
    noSolution: 'I could not work out a full solution to this. Ask for a hint, or look at your notes.',
  },
  ask: {
    rules: 'Here is a hint to get you going.',
  },
} as const;
