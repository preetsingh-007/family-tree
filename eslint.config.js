import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'dev-dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Never log from application code: logs could contain family data.
      'no-console': 'error',
    },
  },
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}', 'tests/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
);
