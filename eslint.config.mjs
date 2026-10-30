import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["coverage/**", "fixtures/integration/**"] },
  js.configs.recommended,
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: { globals: globals.node },
  },
];
