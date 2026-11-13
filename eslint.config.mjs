import js from '@eslint/js';
import globals from 'globals';
import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';

// Typed ESM sources compile to a CommonJS bundle with Obsidian/CodeMirror externals.
export default [
  { ignores: ['node_modules/**', 'main.js', 'release/**', '.host-build/**', 'coverage/**'] },
  {
    files: ['src/**/*.ts'],
    plugins: { obsidianmd, '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
      sourceType: 'module',
      globals: {
        ...globals.browser,
        require: 'readonly',
        module: 'readonly',
        activeDocument: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...obsidianmd.ruleConfigs.recommended,
      ...obsidianmd.ruleConfigs.recommendedTypeChecked,
      'obsidianmd/no-nodejs-modules': 'error',
      'obsidianmd/prefer-active-doc': 'error',
      'obsidianmd/ui/sentence-case': ['warn', { brands: ['Flow Edit'] }],
      // TypeScript checks names; the TS-aware rule also understands type declarations.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': true },
      ],
    },
  },
  {
    files: ['scripts/**/*.{js,cjs}', 'tests/**/*.{js,cjs}', 'build.js', 'eslint.config.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser }, sourceType: 'commonjs' },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },
  { files: ['eslint.config.mjs'], languageOptions: { sourceType: 'module' } },
];
