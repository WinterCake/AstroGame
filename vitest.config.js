import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "backend",
          include: ["tests/**/*.test.js", "src/**/*.test.js"],
          exclude: ["tests/parity/**"],
          environment: "node",
        },
      },
      {
        plugins: [react()],
        test: {
          name: "web",
          include: ["web/src/**/*.test.ts"],
          environment: "jsdom",
        },
        resolve: {
          alias: {
            "@": resolve(__dirname, "web/src"),
            "@shared": resolve(__dirname, "shared"),
          },
        },
      },
      {
        test: {
          name: "parity",
          include: ["tests/parity/**/*.test.js"],
          environment: "node",
        },
      },
    ],
  },
});
