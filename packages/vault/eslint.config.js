import { config as base } from "@repo/eslint-config/base";

/** @type {Array<import("eslint").Linter.Config>} */
export default [{ ignores: ["node_modules/**", "dist/**"] }, ...base];
