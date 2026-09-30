// ESLint for all TypeScript and JavaScript in the repository.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', 'target/**', 'node_modules/**', 'app/src-tauri/gen/**', 'app/src/theme/tokens.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['app/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['spikes/web/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      'checks/**/*.ts',
      'docs/**/*.ts',
      'app/scripts/**/*.ts',
      'app/vite.config.ts',
      'spikes/web/vite.config.ts',
      'eslint.config.js',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['checks/layout/audit.js', 'app/public/**/*.js'],
    languageOptions: { globals: globals.browser, sourceType: 'script' },
  },
);
