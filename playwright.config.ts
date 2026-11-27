// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5178",
    viewport: { width: 1280, height: 800 },
    trace: "off",
    launchOptions: {
      // Software WebGL, so the test runs on machines without a GPU.
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    },
  },
  webServer: { command: "npm run playground -- --port 5178 --strictPort", url: "http://localhost:5178", reuseExistingServer: !process.env.CI },
});
