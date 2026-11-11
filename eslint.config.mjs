// Lint for every mod in this repository: the dashboard server (Node), its web
// page (browser modules) and the hooks (TypeScript). Run with `npm run lint`;
// the Lint workflow runs the same on every pull request.

import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const rules = {
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-var': 'error',
  // Names say what they hold; x and y are coordinates, $ the engine, h the JSX factory.
  'id-length': ['error', { min: 2, properties: 'never', exceptions: ['$', '_', 'h', 'x', 'y'] }],
  'prefer-const': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  // Stripping control characters and ANSI colours from terminal text is the point of those patterns.
  'no-control-regex': 'off',
}
const unused = { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }

export default [
  { ignores: ['**/node_modules/**', '**/.claude-plugin/types/**'] },
  js.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.js'],
    rules: { ...rules, 'no-unused-vars': ['error', unused] },
  },
  {
    files: ['*/server/**/*.mjs', '.github/**/*.mjs', '*.mjs'],
    ignores: ['*/server/web/**'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['*/server/web/**/*.js'],
    // Chart.js comes from the page's script tag.
    languageOptions: { globals: { ...globals.browser, Chart: 'readonly' } },
  },
  ...tseslint.configs.recommended.map(config => ({ ...config, files: ['**/*.ts', '**/*.tsx'] })),
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      ...rules,
      '@typescript-eslint/no-unused-vars': ['error', unused],
      // What the dashboard server answers and what a transcript row holds are JSON of no fixed shape.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
]
