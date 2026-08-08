/**
 * Flat ESLint config — extends the shared repo base, which supplies the TypeScript parser.
 * Without a parser every .ts file fails to parse, and a file that fails to parse is never linted,
 * so the rules would be declared here and enforced nowhere.
 *
 * The base pulls in eslint-plugin-only-warn (everything becomes a warning), so the `lint` script
 * runs with --max-warnings 0 to keep violations fatal.
 */

import { config as base } from "@repo/eslint-config/base";

/** @type {Array<import("eslint").Linter.Config>} */
export default [
  { ignores: ["node_modules/**", "dist/**"] },
  ...base,
];
