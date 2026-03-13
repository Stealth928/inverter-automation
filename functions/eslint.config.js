const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['coverage/**', 'node_modules/**']
  },
  {
    files: ['**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-useless-assignment': 'off',
      'no-console': 'off',
      quotes: ['error', 'single', { allowTemplateLiterals: true }],
      semi: ['error', 'always']
    }
  },
  {
    files: ['test/**/*.js', '**/*.test.js', '**/*.spec.js'],
    rules: {
      'no-unused-vars': 'off'
    }
  }
];
