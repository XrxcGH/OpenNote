// ESLint for all TypeScript and JavaScript in the repository.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-test/**',
      'target/**',
      'node_modules/**',
      'app/src-tauri/gen/**',
      'app/src/theme/tokens.ts',
      'app/src/platform/bindings/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: { '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }] },
  },
  {
    files: ['app/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: [
      'checks/**/*.ts',
      'docs/**/*.ts',
      'app/scripts/**/*.ts',
      'app/vite.config.ts',
      'app/vitest.config.ts',
      'tests/**/*.ts',
      'eslint.config.js',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['checks/layout/audit.js', 'app/public/**/*.js'],
    languageOptions: { globals: globals.browser, sourceType: 'script' },
  },
);
