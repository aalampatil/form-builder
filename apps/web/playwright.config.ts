import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/auth",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://localhost:3001",
    screenshot: "only-on-failure",
    trace: "off",
  },
  projects: [
    { name: "setup", testMatch: /global\.setup\.ts/ },
    {
      name: "chrome",
      testIgnore: /global\.setup\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
});
