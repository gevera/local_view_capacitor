import {defineConfig} from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  timeout: 90000,
  expect: {timeout: 20000},
  workers: 1,
  use: {baseURL: "http://127.0.0.1:4002", trace: "retain-on-failure", screenshot: "only-on-failure"},
  webServer: {
    command: "mix ecto.create --quiet && mix ecto.migrate --quiet && mix phx.server",
    url: "http://127.0.0.1:4002/offline",
    reuseExistingServer: false,
    timeout: 120000,
    env: {PORT: "4002", REPORTS_E2E: "1"}
  }
});
