import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "server-only": "next/dist/compiled/server-only/empty.js" },
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
  },
});
