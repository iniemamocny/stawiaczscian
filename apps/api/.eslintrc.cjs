module.exports = {
  env: {
    node: true,
    es2021: true,
    mocha: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
};
