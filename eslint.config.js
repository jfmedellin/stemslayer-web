import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const restricted = (...patterns) => ['error', { patterns }]

export default tseslint.config(
  // `.kilo`/`.kilocode` worktrees are another local coding agent's checkouts
  // of this same repo (already excluded from git in `.git/info/exclude`); a
  // nested `tsconfig.json` inside one confuses typescript-eslint's automatic
  // project-root detection across the whole tree if ESLint walks into it.
  { ignores: ['dist', 'node_modules', '.codegraph', 'spikes', '.kilo', '.kilocode'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['*.{js,ts}', 'tests/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { regex: '^(?!\\.)', message: 'Domain must not import external modules.' },
        { group: [
          '**/application/**', '**/infrastructure/**', '**/ui/**',
        ], message: 'Domain must remain isolated.' },
      ] }],
    },
  },
  {
    files: ['src/application/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restricted(
        '**/infrastructure/**', '**/ui/**',
      ),
    },
  },
  {
    files: ['src/infrastructure/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restricted('**/ui/**'),
    },
  },
)
