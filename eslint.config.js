// ESLint for all TypeScript and JavaScript in the repository.
// app/src also gets the boundary rules from ARCHITECTURE.md section 4.4; eslint/rules.test.ts proves each one.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import opennote from './eslint/rules.js';

const TESTS = ['app/src/**/*.test.{ts,tsx}', 'app/src/test/**', 'app/src/features/page/test/**'];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-test/**',
      'target/**',
      '.claude/**',
      'node_modules/**',
      'app/src-tauri/gen/**',
      'app/src/theme/tokens.ts',
      'app/src/platform/bindings/**',
      'eslint/fixtures/**',
      'tests/ui/report/**',
      'tests/ui/results/**',
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
    plugins: { 'react-hooks': reactHooks, opennote },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'opennote/feature-boundaries': 'error',
      'opennote/ui-boundaries': 'error',
      'opennote/editor-boundaries': 'error',
      'opennote/no-theme-key': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@tauri-apps/*'], message: 'Only app/src/platform/tauri may import @tauri-apps/api.' },
            {
              group: ['**/platform/web', '**/platform/web/*'],
              message: 'Production code reaches the web fakes only through platform/index.ts.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name="tabIndex"] > JSXExpressionContainer > Literal[value>0]',
          message: 'No positive tabIndex: tab order follows reading order.',
        },
      ],
    },
  },
  {
    // Interface text lives in app/src/strings; the development gallery and tests may use literal text.
    files: ['app/src/**/*.tsx'],
    ignores: ['app/src/strings/**', 'app/src/dev/**', ...TESTS],
    rules: { 'opennote/no-literal-text': 'error' },
  },
  {
    // The Tauri platform is the only place for @tauri-apps; the web platform, its chooser, and tests may use fakes.
    files: ['app/src/platform/tauri/**', 'app/src/platform/web/**', 'app/src/platform/index.ts', ...TESTS],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['spikes/web/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Keyboard-only E2E specs must not pass by using the mouse.
    files: ['tests/e2e/keyboard/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name=/^(click|doubleClick|moveTo|dragAndDrop)$/]',
          message: 'Keyboard-only specs use browser.keys, never the pointer.',
        },
      ],
    },
  },
  {
    files: [
      'checks/**/*.ts',
      'docs/**/*.ts',
      'app/scripts/**/*.ts',
      'app/vite.config.ts',
      'app/vitest.config.ts',
      'spikes/web/vite.config.ts',
      'tests/**/*.ts',
      'eslint/**/*.{js,ts}',
      'eslint.config.js',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['checks/layout/audit.js', 'app/public/**/*.js'],
    languageOptions: { globals: globals.browser, sourceType: 'script' },
  },
);
