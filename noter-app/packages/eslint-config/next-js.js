const { FlatCompat } = require('@eslint/eslintrc');

const compat = new FlatCompat({
  baseDirectory: process.cwd(),
});

const nextJsConfig = [
  ...compat.extends('turbo', 'prettier'),
  {
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
];

module.exports = {
  nextJsConfig,
  default: nextJsConfig,
};
