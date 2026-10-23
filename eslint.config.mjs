// @ts-check Let TS check this config file

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["build/**", "dist/**", "node_modules/**"],
  },
  {
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/ban-ts-comment": [
        "warn",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": "allow-with-description",
          "ts-nocheck": "allow-with-description",
          "ts-check": "allow-with-description",
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "warn",
    },
  },
  {
    // Zotero's add-on sandbox does not define these globals, while Node and
    // the test runner do, so only a static check catches a bare use.
    // Type-only references stay allowed; only value uses are reported.
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='AbortController']",
          message:
            "AbortController is not defined in the Zotero add-on sandbox. Create it from a window (new win.AbortController()).",
        },
        {
          selector: "NewExpression[callee.name='DOMException']",
          message:
            "DOMException is not defined in the Zotero add-on sandbox. Throw Object.assign(new Error(message), { name: 'AbortError' }).",
        },
        {
          selector: "CallExpression[callee.name='structuredClone']",
          message:
            "structuredClone is not defined in the Zotero add-on sandbox. Copy the data explicitly or through JSON.",
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
      },
    },
  },
);
