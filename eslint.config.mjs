// One ESLint config for the API and the web app. Formatting is Prettier's job.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'client/next-env.d.ts', 'server/.data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `_`-prefixed names are deliberately unused (e.g. omitted destructured keys).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['server/**/*.ts', '*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // Next and PostCSS config files are CommonJS.
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    // The service worker runs in its own global scope.
    files: ['client/public/sw.js'],
    languageOptions: { sourceType: 'script', globals: globals.serviceworker },
  },
  {
    // Mongoose's generics use `{}` for "no extra query helpers / methods".
    files: ['server/src/models/**/*.ts'],
    rules: { '@typescript-eslint/no-empty-object-type': 'off' },
  },
  {
    // Tests poke at loosely typed responses and fakes.
    files: ['server/test/**/*.ts', 'client/**/*.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['client/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  }
);
