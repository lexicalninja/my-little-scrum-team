import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: false,
    // Several suites shell out to `tsc` / `npm run build` to assert the real
    // build works. tsconfig.json points all of them at the same `./out`
    // directory, so running files in parallel makes them clobber each other
    // and fail nondeterministically. Serial execution costs ~10s and makes
    // the suite reproducible.
    fileParallelism: false,
  },
});
