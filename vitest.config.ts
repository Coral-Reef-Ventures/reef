import { defineConfig } from "vitest/config";

/**
 * One runner for every package: `pnpm test`. CSS modules keep their class names as written (`section`, not a hash),
 * so a test can read `class="section"` off the markup a component renders.
 */
export default defineConfig({
  test: {
    css: { modules: { classNameStrategy: "non-scoped" } },
    include: ["packages/*/test/**/*.test.ts", "packages/*/test/**/*.test.tsx", "test/*.test.ts"],
  },
});
