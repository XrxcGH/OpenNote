// The run worker of python.test.tsx for full Python. It uses the real run protocol (serve.ts) and Pyodide adapter.
// Pyodide's files come from the test server, since only the app serves the pack scheme.
import lockUrl from 'pyodide/pyodide-lock.json?url';
import { serve } from '../../../run/serve';
import { pyodideAdapter } from '../pyodide';

const indexURL = new URL('./', new URL(lockUrl, location.href)).href;

serve({ 'python-full': () => Promise.resolve(pyodideAdapter(indexURL)) });
