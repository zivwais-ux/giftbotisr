import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // PGlite gives each test file its own private database, so files can run in parallel.
    // A shared real Postgres (TEST_DATABASE_URL) is wiped per file, so files must run one at a time.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
