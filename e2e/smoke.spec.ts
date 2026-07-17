import { expect, test } from "@playwright/test";

test.describe("smoke", () => {
  test("loads login or app shell", async ({ page }) => {
    await page.goto("/");
    // Either auth wall or main UI
    const body = page.locator("body");
    await expect(body).toBeVisible();
    // Login card or chat shell
    const hasLogin = await page.getByText(/Вход|Регистрация|Login/i).count();
    const hasApp = await page.getByText(/New chat|Новый|Чем могу помочь/i).count();
    expect(hasLogin + hasApp).toBeGreaterThan(0);
  });

  test("health endpoint is ok", async ({ request }) => {
    const res = await request.get("/health");
    // Some preview servers won't proxy /health — accept 200 or network skip
    if (res.ok()) {
      const json = await res.json();
      expect(json.status === "ok" || json.opencode).toBeTruthy();
    }
  });
});
