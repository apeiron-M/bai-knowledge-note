import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      include: [
        "document-models/**/src/reducers/**",
        "document-models/**/src/tree-utils.ts",
        "subgraphs/http/lib/**",
      ],
      exclude: [
        "**/*.test.ts",
        "subgraphs/http/lib/deps.ts",
        "subgraphs/http/lib/lint/types.ts",
      ],
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
      },
    },
  },
  plugins: [tsconfigPaths()],
});
