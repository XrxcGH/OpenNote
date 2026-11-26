// Running code: the workers, standard input, and run results.
// Owner: code:L03 (B11). shared:x-shared registered it in the string index, and the owner fills it in.

export const codeStudioRun = {
  status: {
    loading: 'Starting {runtime}… {percent}%',
    running: 'Running…',
    waiting: 'Waiting for another run to finish…',
    ok: 'Ran in {seconds} seconds.',
    okExit: 'Ran in {seconds} seconds. Exit code {code}.',
    error: 'The program stopped with an error.',
    errorExit: 'The program stopped with exit code {code}.',
    time: 'Stopped after {seconds} seconds, the time limit.',
    memory: 'Stopped: the program used more than {megabytes} MB, the memory limit.',
    stopped: 'Stopped.',
    failed: 'The program could not run. Try again.',
  },
  notes: {
    inputEnded: 'The program asked for more input. Type it in the input box and run again.',
    interactiveUnavailable:
      'This system web view cannot pause a program for input, so the program read the input box instead.',
    richRefused: 'An image or table was left out because it was too large.',
    outputCut: 'Only the first part of the output is shown.',
  },
  input: {
    label: 'Input',
    prompt: 'The program is waiting for input.',
    send: 'Send',
    end: 'End input',
  },
  version: 'Runtime: {version}',
  written: 'Files the program wrote (not saved)',
} as const;
