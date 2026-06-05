import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import unusedImports from "eslint-plugin-unused-imports";

/**
 * Flat ESLint config for Vite + React (JSX).
 * Rules skew toward warnings so CI/dev stays practical; hooks violations stay errors.
 */
export default [
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  react.configs.flat.recommended,
  {
    files: ["**/*.{js,jsx}"],
    plugins: {
      react,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "unused-imports": unusedImports,
    },
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/jsx-key": "warn",
      "react/jsx-no-duplicate-props": "error",
      "react/jsx-no-undef": "error",
      "react/jsx-no-target-blank": "warn",

      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      "no-unused-vars": "off",
      "unused-imports/no-unused-imports": "warn",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-duplicate-imports": "warn",
    },
  },
  {
    // Node-side build/tooling scripts use Node globals (console, process, …).
    files: ["scripts/**/*.{js,mjs,cjs}", "*.config.{js,mjs,cjs}"],
    languageOptions: {
      globals: globals.node,
    },
  },
];
