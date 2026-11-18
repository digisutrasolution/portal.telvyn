// Telvyn workspace lint gate (SEC-003). Flat config shared by apps/api and
// apps/web. Recommended TypeScript rules, tuned to the codebase's deliberate
// patterns (fail-closed empty catches, underscore-ignored args). Type-checked
// linting is intentionally NOT enabled here to keep CI fast; `tsc --noEmit`
// (typecheck) already provides full type safety.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.next-build/**",
      "**/coverage/**",
      "**/*.config.{js,mjs,ts}",
      "**/next-env.d.ts",
      "apps/api/prisma/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Unused vars are errors, but an underscore prefix marks an intentional discard.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // Fail-closed handlers legitimately swallow with an empty catch.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // `any` is discouraged but not build-breaking; typecheck is the hard gate.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
