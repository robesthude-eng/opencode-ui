import { expect, test } from "@playwright/test";

/**
 * Critical-path E2E (requires PLAYWRIGHT_BASE_URL + optional test credentials).
 * Set E2E_EMAIL / E2E_PASSWORD to exercise login → chat.
 */
const email = process.env.E2E_EMAIL || "";
const password = process.env.E2E_PASSWORD || "";

test.describe("auth + shell", () => {
  test("home shows login or app", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
    const login = page.getByRole("button", { name: /Войти|Зарегистрироваться/i });
    const newChat = page.getByRole("button", { name: /New chat|Новый/i });
    await expect(login.or(newChat).first()).toBeVisible({ timeout: 15000 });
  });

  test("login flow when credentials provided", async ({ page }) => {
    test.skip(!email || !password, "E2E_EMAIL/E2E_PASSWORD not set");
    await page.goto("/");
    // Prefer login tab
    const loginTab = page.getByRole("button", { name: /^Вход$/ });
    if (await loginTab.count()) await loginTab.click();
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.getByRole("button", { name: /Войти/i }).click();
    // After login: New chat or settings visible
    await expect(
      page.getByRole("button", { name: /New chat|Settings|Настройки/i }).first(),
    ).toBeVisible({ timeout: 20000 });
  });
});

test.describe("api", () => {
  test("health", async ({ request }) => {
    const res = await request.get("/health");
    if (res.status() === 404) test.skip(true, "health not proxied on this host");
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.status === "ok" || json.opencode).toBeTruthy();
  });
});
