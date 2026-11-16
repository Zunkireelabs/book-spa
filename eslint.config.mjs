import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default [
  // Nested git worktrees under .claude/worktrees/ carry their own full src/
  // trees, so `eslint .` from the repo root sweeps every other branch's source
  // into this checkout's lint run — locally that was 3,619 of 3,624 errors,
  // none of them from this branch. CI never sees them (the directory does not
  // exist there), which makes a local lint run useless for predicting CI.
  // Same reasoning, and same fix, as the vitest `exclude` in vite.config.mjs.
  { ignores: ['build/**', 'node_modules/**', '.claude/worktrees/**'] },
  js.configs.recommended,
  {
    // .mjs/.cjs included so config and scripts/ files (vite.config.mjs,
    // scripts/*.mjs) get the shared globals too — without it they fall through
    // to js.configs.recommended alone and every `console`/`process` reference
    // is a no-undef error.
    files: ['**/*.{js,jsx,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
      'react-refresh/only-export-components': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.test.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser, vitest: 'readonly' } },
  },
];
