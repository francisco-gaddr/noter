import { nextJsConfig } from "@repo/eslint-config/next-js.js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: ['.next/**', 'dist/**', 'coverage/**', 'out/**'],
  },
  ...nextJsConfig,
];
