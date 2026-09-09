import {test, expect} from "@playwright/test";

async function openReports(page, path = "/") {
  const joined = new Promise(resolve => {
    page.on("websocket", ws => {
      if (!ws.url().includes("/reports_socket/")) return;
      ws.on("framereceived", ({payload}) => {
        const frame = JSON.parse(payload);
        if (frame[3] === "phx_reply" && frame[4]?.status === "ok") resolve();
      });
    });
  });
  await page.goto(path);
  await expect(page.locator("#report-title")).toBeEnabled();
  await joined;
  await expect(page.locator("#connection-status")).toHaveText("Online");
}

test("separate users receive create, edit and delete over PubSub without refreshing or polling", async ({page: writer, browser}) => {
  const observerContext = await browser.newContext();
  const observer = await observerContext.newPage();
  try {
    await openReports(writer);
    // The observer uses the hostless shell, proving that delivery does not
    // depend on a server LiveView having been mounted before going offline.
    await openReports(observer, "http://127.0.0.1:4002/offline");
    await observer.route("**/sync/**", route => route.abort());
    const title = `PubSub ${crypto.randomUUID()}`;
    await writer.locator("#report-title").fill(title);
    await writer.locator("#report-description").fill("Created by another user");
    await writer.locator("#save-report").click();
    const writerCard = writer.locator("#reports-list article").filter({has: writer.getByRole("heading", {name: title, exact: true})});
    const observerCard = observer.locator("#reports-list article").filter({has: observer.getByRole("heading", {name: title, exact: true})});
    await expect(observerCard).toBeVisible({timeout: 5000});
    await expect(writer.locator("#pending-status")).toHaveText("0 pending");

    await observerCard.getByRole("button", {name: "Edit", exact: true}).click();
    await expect(observer.locator("#report-title")).toHaveValue(title);
    await observer.locator("#report-description").fill("My unfinished draft");

    await writerCard.getByRole("button", {name: "Edit", exact: true}).click();
    await expect(writer.locator("#report-title")).toHaveValue(title);
    await writer.locator("#report-description").fill("Changed in real time");
    await writer.locator("#report-status").selectOption("resolved");
    await writer.locator("#save-report").click();
    await expect(observerCard).toContainText("Changed in real time", {timeout: 5000});
    await expect(observerCard.locator(".badge")).toHaveText("resolved");
    await expect(observer.locator("#report-description")).toHaveValue("My unfinished draft");
    await expect(writer.locator("#pending-status")).toHaveText("0 pending");

    await observerContext.setOffline(true);
    await writerCard.getByRole("button", {name: "Edit", exact: true}).click();
    await expect(writer.locator("#report-title")).toHaveValue(title);
    await writer.locator("#report-description").fill("Changed while the other user was offline");
    await writer.locator("#save-report").click();
    await expect(writerCard).toContainText("Changed while the other user was offline");
    await expect(writer.locator("#pending-status")).toHaveText("0 pending");
    await expect(observerCard).toContainText("Changed in real time");
    await observer.unroute("**/sync/**");
    await observerContext.setOffline(false);
    await expect(observerCard).toContainText("Changed while the other user was offline", {timeout: 5000});
    await observer.route("**/sync/**", route => route.abort());

    await writerCard.getByRole("button", {name: "Delete", exact: true}).click();
    await writerCard.getByRole("button", {name: "Confirm delete"}).click();
    await expect(observerCard).toHaveCount(0, {timeout: 5000});
    expect(observer.url()).toBe("http://127.0.0.1:4002/offline");
  } finally {
    await observerContext.close();
  }
});
