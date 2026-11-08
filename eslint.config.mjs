import js from '@eslint/js';
import globals from 'globals';
import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';

// Runtime code is CommonJS JavaScript, supported by Obsidian. Apply every
// Obsidian base rule and its type-aware API rules without imposing a TS rewrite.
export default [
  { ignores: ['node_modules/**', 'main.js', 'release/**', '.host-build/**', 'coverage/**'] },
  {
    files: ['src/**/*.js'],
    plugins: { obsidianmd, '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
      sourceType: 'commonjs',
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
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['scripts/**/*.{js,cjs}', 'tests/**/*.js', 'build.js', 'eslint.config.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser }, sourceType: 'commonjs' },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },
  { files: ['eslint.config.mjs'], languageOptions: { sourceType: 'module' } },
];
