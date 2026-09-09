import {test, expect} from "@playwright/test";

test("LocalLiveView supports offline CRUD, offline reload, and durable sync", async ({page, context}) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const title = `Offline report ${Date.now()}`;
  await page.goto("/");
  await expect(page.locator("#report-title")).toBeEnabled();
  await expect(page.locator("#offline-status")).toHaveText("Ready for offline use");
  await expect(page.locator("#connection-status")).toHaveText("Online");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.locator("#report-title").fill(title);
  await page.locator("#report-description").fill("Created with no network connection.");
  await page.locator("#save-report").click();
  const report = page.locator("#reports-list article").filter({has: page.getByRole("heading", {name: title, exact: true})});
  await expect(report).toBeVisible();
  await expect(page.locator("#pending-status")).toHaveText("1 pending");

  await report.getByRole("button", {name: "Edit", exact: true}).click();
  await expect(page.locator("#report-title")).toHaveValue(title);
  await page.locator("#report-description").fill("Edited offline and retained after reload.");
  await page.locator("#report-status").selectOption("submitted");
  await page.locator("#save-report").click();
  await expect(report).toContainText("Edited offline and retained after reload.");
  await expect(page.locator("#pending-status")).toHaveText("2 pending");

  await page.reload();
  await expect(page.locator("#report-title")).toBeEnabled();
  await expect(report).toContainText("Edited offline and retained after reload.");
  await expect(page.locator("#pending-status")).toHaveText("2 pending");
  await expect.poll(() => page.evaluate(() => window.crossOriginIsolated)).toBe(true);

  // Exercise the form after booting the entire WASM app while offline.
  await report.getByRole("button", {name: "Edit", exact: true}).click();
  await expect(page.locator("#report-title")).toHaveValue(title);
  await page.locator("#report-status").selectOption("resolved");
  await page.locator("#save-report").click();
  await expect(report.locator(".badge")).toHaveText("resolved");

  await context.setOffline(false);
  await expect(page.locator("#pending-status")).toHaveText("0 pending");
  const saved = await page.evaluate(async title => (await (await fetch("/sync/reports")).json()).reports.find(r => r.title === title), title);
  expect(saved.status).toBe("resolved");
  expect(saved.version).toBe(3);

  await context.setOffline(true);
  await report.getByRole("button", {name: "Delete", exact: true}).click();
  await report.getByRole("button", {name: "Confirm delete"}).click();
  await expect(report).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#report-title")).toBeEnabled();
  await expect(report).toHaveCount(0);
  await expect(page.locator("#pending-status")).toHaveText("1 pending");
  await context.setOffline(false);
  await expect(page.locator("#pending-status")).toHaveText("0 pending");
  const deleted = await page.evaluate(async id => (await (await fetch("/sync/reports")).json()).reports.find(r => r.id === id), saved.id);
  expect(deleted.deleted).toBe(true);
  expect(deleted.version).toBe(4);
  expect(errors).toEqual([]);
});

test("a cached hostless shell starts LocalLiveView at mobile size", async ({page, context}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto("/");
  await expect(page.locator("#offline-status")).toHaveText("Ready for offline use");
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.goto("/offline");
  await expect(page.locator("#report-title")).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("conflicting offline edits require an explicit choice and retain the local version", async ({page, context, request}) => {
  const title = `Conflict report ${Date.now()}`;
  await page.goto("/");
  await expect(page.locator("#report-title")).toBeEnabled();
  await page.locator("#report-title").fill(title);
  await page.locator("#report-description").fill("Original description");
  await page.locator("#save-report").click();
  const card = page.locator("#reports-list article").filter({has: page.getByRole("heading", {name: title, exact: true})});
  await expect(card).toBeVisible();
  await expect(page.locator("#pending-status")).toHaveText("0 pending");
  const original = (await (await request.get("/sync/reports")).json()).reports.find(r => r.title === title);

  await context.setOffline(true);
  await card.getByRole("button", {name: "Edit", exact: true}).click();
  await expect(page.locator("#report-title")).toHaveValue(title);
  await page.locator("#report-description").fill("My offline version");
  await page.locator("#save-report").click();
  await expect(card).toContainText("My offline version");

  const {csrf_token: token} = await (await request.get("/sync/session")).json();
  const remote = await request.post("/sync/reports", {
    headers: {"x-csrf-token": token},
    data: {mutation_id: crypto.randomUUID(), base_version: original.version, report: {...original, description: "Another browser's version"}}
  });
  expect(remote.ok()).toBe(true);
  await context.setOffline(false);
  await expect(page.locator("#sync-conflict")).toBeVisible();
  await expect(card).toContainText("My offline version");
  await page.getByRole("button", {name: "Keep my version"}).click();
  await expect(page.locator("#sync-conflict")).toHaveCount(0);
  await expect(page.locator("#pending-status")).toHaveText("0 pending");
  const resolved = (await (await request.get("/sync/reports")).json()).reports.find(r => r.id === original.id);
  expect(resolved.description).toBe("My offline version");
  expect(resolved.version).toBe(3);
});
