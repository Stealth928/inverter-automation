module.exports = {
  env: {
    es6: true,
    node: true,
    jest: true,
  },
  parserOptions: {
    ecmaVersion: 2020,
  },
  extends: [
    'eslint:recommended'
  ],
  rules: {
    'no-unused-vars': ['warn', { 'argsIgnorePattern': '^_', 'varsIgnorePattern': '^_' }],
    'no-console': 'off',
    'quotes': ['error', 'single', { 'allowTemplateLiterals': true }],
    'semi': ['error', 'always']
  },
  overrides: [
    {
      // Test files: unused vars are expected from mock/spy setups — suppress warnings
      files: ['test/**/*.js', '**/*.test.js', '**/*.spec.js'],
      rules: {
        'no-unused-vars': 'off'
      }
    }
  ],
  globals: {},
};
