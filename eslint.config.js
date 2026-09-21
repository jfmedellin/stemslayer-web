import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const restricted = (...patterns) => ['error', { patterns }]

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.codegraph', 'spikes'] },
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
