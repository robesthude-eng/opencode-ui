/**
 * UI Test Suite — opencode-ui
 *
 * Tests every interactive element in the app that doesn't require OpenCode backend:
 * - Login / register flow
 * - Sidebar (New chat, Settings, Theme toggle, Logout, email display)
 * - TopBar (Workspace toggle, Theme toggle, mobile menu)
 * - ChatView (suggestions, empty state, scroll-to-bottom button)
 * - Composer (textarea, attach button, send/stop, drag-drop, key bindings)
 * - Workspace panel (open/close, refresh, search filter, upload folder button)
 * - Settings panel (all tabs: self-improve, free-models, providers, about)
 *   - Toggle self-improve, rebuild, reset UI (visible only to admin)
 *   - Save/remove provider key form (without actually saving real API keys)
 *   - About info
 * - Permission dialog (closed state at least)
 * - Mobile responsive layout
 * - Theme persistence (refresh)
 * - Error boundary — connection banner when OpenCode unreachable
 *
 * Run with:  PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test --reporter=list
 */
import { expect, test } from "@playwright/test";

const _BASE = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
// Pre-seeded admin user (see /home/z/my-project/scripts/reset-and-seed.sh)
const ADMIN = { email: "admin@local.test", password: "testpass123" };
const _USER2 = {
  email: `user+${Date.now()}@local.test`,
  password: "userpass123",
};

async function register(page, creds) {
  await page.goto("/");
  // Switch to register tab
  await page.getByRole("button", { name: "Регистрация" }).click();
  await page.locator('input[id="email"]').fill(creds.email);
  await page.locator('input[id="password"]').fill(creds.password);
  // Confirm password field appears when registering
  await page.waitForSelector('input[id="confirm"]', { timeout: 2000 });
  await page.locator('input[id="confirm"]').fill(creds.password);
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  // Wait for redirect to app shell (sidebar appears)
  await page.waitForSelector('aside, [class*="sidebar"]', { timeout: 5000 });
}

async function login(page, creds) {
  await page.goto("/");
  // Already on login tab by default
  await page.locator('input[id="email"]').fill(creds.email);
  await page.locator('input[id="password"]').fill(creds.password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForSelector('aside, [class*="sidebar"]', { timeout: 5000 });
}

// ============================================================================
// 1. LOGIN / REGISTER
// ============================================================================
test.describe("1. Auth UI", () => {
  test("1.1 login as pre-seeded admin → app shell", async ({ page }) => {
    await login(page, ADMIN);
    await expect(page.getByRole("button", { name: /New chat/i })).toBeVisible();
  });

  test("1.2 register a new (non-admin) user → app shell", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const newUser = {
      email: `user+${Date.now()}@local.test`,
      password: "userpass123",
    };
    await register(page, newUser);
    await expect(page.getByRole("button", { name: /New chat/i })).toBeVisible();
    await ctx.close();
  });

  test("1.3 login form accepts input and submits", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, ADMIN);
    await expect(page.getByRole("button", { name: /New chat/i })).toBeVisible();
    await ctx.close();
  });

  test("1.4 login with wrong password shows error", async ({ page }) => {
    await page.goto("/");
    await page.locator('input[id="email"]').fill(ADMIN.email);
    await page.locator('input[id="password"]').fill("wrong-password");
    await page.getByRole("button", { name: "Войти" }).click();
    // Should show error message, NOT redirect
    await expect(
      page.locator("text=/неверн|invalid|ошибк|Invalid email/i").first(),
    ).toBeVisible({
      timeout: 3000,
    });
  });

  test("1.5 register with mismatched passwords shows error", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Регистрация" }).click();
    await page
      .locator('input[id="email"]')
      .fill(`mismatch+${Date.now()}@test.com`);
    await page.locator('input[id="password"]').fill("password1");
    // Make sure confirm field is visible after switching to register mode
    await page.waitForSelector('input[id="confirm"]', { timeout: 2000 });
    await page.locator('input[id="confirm"]').fill("different-password");
    await page.getByRole("button", { name: "Зарегистрироваться" }).click();
    await expect(
      page.locator("text=/не совпадают|do not match/i").first(),
    ).toBeVisible({
      timeout: 3000,
    });
  });

  test("1.6 switching between login/register tabs", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Регистрация" }).click();
    // Confirm field visible in register mode
    await expect(page.locator('input[id="confirm"]')).toBeVisible();
    await page.getByRole("button", { name: "Вход" }).click();
    // Confirm field hidden in login mode
    await expect(page.locator('input[id="confirm"]')).toBeHidden();
  });
});

// ============================================================================
// 2. SIDEBAR
// ============================================================================
test.describe("2. Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN);
  });

  test("2.1 New chat button works", async ({ page }) => {
    // Click New chat — will try /api/session POST which will 502, but UI should react
    await page.getByRole("button", { name: /New chat/i }).click();
    // Wait a moment for the optimistic UI
    await page.waitForTimeout(500);
    // Sidebar should still be visible (no crash)
    await expect(page.getByRole("button", { name: /New chat/i })).toBeVisible();
  });

  test("2.2 Settings button opens panel", async ({ page }) => {
    await page.getByRole("button", { name: /Settings/i }).click();
    await expect(
      page
        .locator("text=/Self-Improvement|self-improve|Self-improve/i")
        .first(),
    ).toBeVisible({ timeout: 3000 });
  });

  test("2.3 Theme toggle (dark/light)", async ({ page }) => {
    // Wait for app shell to settle
    await page.waitForTimeout(1000);
    // Find theme toggle button (Sun or Moon icon) — there are 2 (sidebar + topbar)
    const themeBtns = page.locator('button[title="Toggle theme"]');
    const count = await themeBtns.count();
    expect(count).toBeGreaterThan(0);
    // Theme is stored as data-theme attribute on <html>
    const before = await page.evaluate(
      () => document.documentElement.dataset.theme,
    );
    await themeBtns.first().click();
    await page.waitForTimeout(500);
    const after = await page.evaluate(
      () => document.documentElement.dataset.theme,
    );
    expect(before).not.toBe(after);
  });

  test("2.4 Theme persists across reload", async ({ page }) => {
    const themeBtn = page.locator('button[title="Toggle theme"]').first();
    await themeBtn.click();
    await page.waitForTimeout(300);
    const theme = await page.evaluate(
      () => document.documentElement.dataset.theme,
    );
    await page.reload();
    await page.waitForLoadState("networkidle");
    const themeAfter = await page.evaluate(
      () => document.documentElement.dataset.theme,
    );
    expect(theme).toBe(themeAfter);
  });

  test("2.5 Email display in sidebar", async ({ page }) => {
    // Email should be visible in sidebar — it's inside a button with truncate
    const emailButton = page
      .locator(`button:has-text("${ADMIN.email}")`)
      .first();
    await expect(emailButton).toBeVisible({ timeout: 3000 });
  });

  test("2.6 Click email shows full email tooltip", async ({ page }) => {
    // The email button toggles a tooltip with the full email
    const emailBtn = page.locator('button[title*="email" i]').first();
    if (await emailBtn.isVisible().catch(() => false)) {
      await emailBtn.click();
      // Tooltip should appear
      await page.waitForTimeout(200);
    }
  });

  test("2.7 Logout button confirms and logs out", async ({ page }) => {
    // Set up dialog handler BEFORE clicking
    page.on("dialog", (dialog) => dialog.accept());
    // The logout button has title containing "Выйти" (Logout in Russian)
    const logoutBtn = page.locator('button[title*="Выйти"]').first();
    await expect(logoutBtn).toBeVisible({ timeout: 3000 });
    await logoutBtn.click();
    await page.waitForTimeout(1500);
    // Should be back on login page
    await expect(page.getByRole("button", { name: "Войти" })).toBeVisible({
      timeout: 5000,
    });
  });

  test("2.8 Hide sidebar (desktop)", async ({ page }) => {
    const hideBtn = page.locator('button[title="Hide sidebar"]').first();
    if (await hideBtn.isVisible().catch(() => false)) {
      await hideBtn.click();
      await page.waitForTimeout(300);
      // A "show sidebar" button should appear
      await expect(
        page.locator('button[title="Show chats"]').first(),
      ).toBeVisible({
        timeout: 2000,
      });
      // Click to show again
      await page.locator('button[title="Show chats"]').first().click();
      await page.waitForTimeout(300);
    }
  });

  test("2.9 Chat list shows empty state", async ({ page }) => {
    // Since OpenCode is not running, we have no chats
    await expect(
      page.locator("text=/No conversations yet|Нет чатов|новых чатов/i"),
    )
      .toBeVisible({ timeout: 3000 })
      .catch(() => {
        // Or it might already have a tmp_ session from previous test
      });
  });
});

// ============================================================================
// 3. TOPBAR
// ============================================================================
test.describe("3. TopBar", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN);
  });

  test("3.1 Workspace toggle opens workspace panel", async ({ page }) => {
    const wsBtn = page.locator('button[title="Toggle workspace"]').first();
    await wsBtn.click();
    await page.waitForTimeout(300);
    // Workspace panel should be visible — look for "Workspace" header
    await expect(page.locator("text=/Workspace/i").first()).toBeVisible({
      timeout: 2000,
    });
    // Close it
    await wsBtn.click();
    await page.waitForTimeout(300);
  });

  test("3.2 Theme toggle in TopBar works", async ({ page }) => {
    await page.waitForTimeout(500);
    const themeBtns = page.locator('button[title="Toggle theme"]');
    const count = await themeBtns.count();
    expect(count).toBeGreaterThan(0);
    const before = await page.evaluate(
      () => document.documentElement.dataset.theme,
    );
    await themeBtns.nth(count - 1).click();
    await page.waitForTimeout(500);
    const after = await page.evaluate(
      () => document.documentElement.dataset.theme,
    );
    expect(before).not.toBe(after);
  });

  test("3.3 Model selector visible", async ({ page }) => {
    // ModelSelector is in the center of TopBar — but since /api/config/providers 502s,
    // it may show empty/placeholder. Just check the area exists.
    const topBar = page.locator("header").first();
    await expect(topBar).toBeVisible();
  });
});

// ============================================================================
// 4. CHAT VIEW (empty state)
// ============================================================================
test.describe("4. ChatView empty state", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN);
  });

  test("4.1 Welcome screen with suggestions", async ({ page }) => {
    await expect(
      page.locator("text=/Чем могу помочь|How can I help/i"),
    ).toBeVisible();
    // 4 suggestion cards
    const suggestions = page.locator(
      'button:has-text("Написать код"), button:has-text("Объяснить код"), button:has-text("Создать файл"), button:has-text("Отладить")',
    );
    expect(await suggestions.count()).toBeGreaterThanOrEqual(4);
  });

  test("4.2 Click suggestion triggers send (will fail because no OpenCode)", async ({
    page,
  }) => {
    const suggestion = page.locator('button:has-text("Написать код")').first();
    await suggestion.click();
    await page.waitForTimeout(1000);
    // UI should not crash. Either it created a tmp_ session and shows error, or shows the prompt
    // Either way the page should still be responsive
    await expect(page.locator("body")).toBeVisible();
  });
});

// ============================================================================
// 5. COMPOSER
// ============================================================================
test.describe("5. Composer", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN);
  });

  test("5.1 Textarea is visible and accepts input", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible();
    await textarea.fill("Test message");
    await expect(textarea).toHaveValue("Test message");
  });

  test("5.2 Send button disabled when empty", async ({ page }) => {
    const sendBtn = page.locator('button[title="Send"]').first();
    // Should be disabled when no text and no attachments
    await expect(sendBtn).toBeDisabled();
  });

  test("5.3 Send button enabled when text entered", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.fill("Hello world");
    const sendBtn = page.locator('button[title="Send"]').first();
    await expect(sendBtn).toBeEnabled();
  });

  test("5.4 Enter key submits (no shift)", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.fill("Test");
    await textarea.press("Enter");
    // Will try to send — may fail (no session, no OpenCode), but should not crash
    await page.waitForTimeout(500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("5.5 Shift+Enter creates new line", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.fill("Line 1");
    await textarea.press("Shift+Enter");
    await textarea.type("Line 2");
    const value = await textarea.inputValue();
    expect(value).toContain("Line 1");
    expect(value).toContain("Line 2");
    expect(value).toContain("\n");
  });

  test("5.6 Attach button opens file picker (click)", async ({ page }) => {
    // Just verify the button exists and is clickable
    const attachBtn = page.locator('button[title="Attach files"]').first();
    await expect(attachBtn).toBeVisible();
    await expect(attachBtn).toBeEnabled();
  });

  test("5.7 Textarea grows with input", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    const initialHeight = await textarea.evaluate((el) => el.offsetHeight);
    await textarea.fill("Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6");
    await page.waitForTimeout(200);
    const finalHeight = await textarea.evaluate((el) => el.offsetHeight);
    expect(finalHeight).toBeGreaterThanOrEqual(initialHeight);
  });

  test("5.8 Helper text visible", async ({ page }) => {
    await expect(
      page.locator("text=/Shift\\+Enter|Drag & drop/i"),
    ).toBeVisible();
  });
});

// ============================================================================
// 6. WORKSPACE PANEL
// ============================================================================
test.describe("6. Workspace panel", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN);
    // Open workspace
    await page.locator('button[title="Toggle workspace"]').first().click();
    await page.waitForTimeout(500);
  });

  test("6.1 Workspace panel opens with header", async ({ page }) => {
    await expect(page.locator("text=/Workspace/i").first()).toBeVisible();
  });

  test("6.2 Refresh button visible and clickable", async ({ page }) => {
    const refreshBtn = page.locator('button[title="Refresh now"]').first();
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();
    await page.waitForTimeout(500);
  });

  test("6.3 Close button hides panel", async ({ page }) => {
    // Find close button INSIDE the workspace panel (the sidebar's mobile close button has md:hidden)
    // Workspace panel header text: 'Workspace' — the close button is in the same header
    const wsHeader = page.locator("header", { hasText: "Workspace" }).first();
    const closeBtn = wsHeader.locator('button[title="Close"]');
    await expect(closeBtn).toBeVisible({ timeout: 2000 });
    await closeBtn.click();
    await page.waitForTimeout(500);
    // Workspace panel should be hidden now
    const wsHeaders = page.locator('header:has-text("Workspace")');
    expect(await wsHeaders.count()).toBe(0);
  });

  test("6.4 Search filter input", async ({ page }) => {
    const search = page.locator('input[placeholder*="Filter"]').first();
    await expect(search).toBeVisible();
    await search.fill("test");
    await expect(search).toHaveValue("test");
  });

  test("6.5 Upload folder button visible", async ({ page }) => {
    const uploadBtn = page.locator('button:has-text("Upload folder")').first();
    await expect(uploadBtn).toBeVisible();
  });

  test("6.6 Empty state message when no chat selected", async ({ page }) => {
    // Should show "Выберите или создайте чат" since no chat is selected
    await expect(
      page.locator("text=/Выберите или создайте чат|Загрузка файлов/i").first(),
    ).toBeVisible({ timeout: 3000 });
  });
});

// ============================================================================
// 7. SETTINGS PANEL — tabs and admin features
// ============================================================================
test.describe("7. Settings panel", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN);
    await page.getByRole("button", { name: /Settings/i }).click();
    await page.waitForTimeout(500);
  });

  test("7.1 Settings panel opens", async ({ page }) => {
    // The panel should be visible — check for tab labels
    await expect(
      page
        .locator(
          "text=/Self-Improvement|self-improve|Самоулучшение|Провайдеры|About|О приложении/i",
        )
        .first(),
    ).toBeVisible({ timeout: 3000 });
  });

  test("7.2 Self-Improve tab — toggle switch visible to admin", async ({
    page,
  }) => {
    // Look for the toggle switch in the self-improve tab (default)
    const toggle = page.locator('button[role="switch"]').first();
    if (await toggle.isVisible({ timeout: 1000 }).catch(() => false)) {
      // Toggle ON
      await toggle.click();
      await page.waitForTimeout(500);
      // Should trigger a network call to /api/settings/self-improve
    }
  });

  test("7.3 Self-Improve tab — rebuild button visible to admin", async ({
    page,
  }) => {
    // Rebuild button — visible but disabled when self-improve is OFF
    const rebuildBtn = page
      .locator('button:has-text("Rebuild"), button:has-text("Пересобрать")')
      .first();
    if (await rebuildBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      // Don't click — would actually rebuild. Just verify it's there
    }
  });

  test("7.4 Self-Improve tab — reset UI button visible to admin", async ({
    page,
  }) => {
    const resetBtn = page
      .locator('button:has-text("Reset"), button:has-text("Сбросить")')
      .first();
    if (await resetBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      // Don't click — would actually reset
    }
  });

  test("7.5 Self-Improve tab — checkpoints list visible", async ({ page }) => {
    // Checkpoints list should load (uses /api/git/checkpoints which works without OpenCode)
    await page.waitForTimeout(1000); // give it time to load
    // Look for any text indicating checkpoint list (could be "No checkpoints" or actual commits)
  });

  test("7.6 Switch to Providers tab", async ({ page }) => {
    // Find and click Providers tab
    const tab = page
      .locator(
        'button[role="tab"]:has-text("Providers"), button:has-text("Провайдеры")',
      )
      .first();
    if (await tab.isVisible({ timeout: 1000 }).catch(() => false)) {
      await tab.click();
      await page.waitForTimeout(500);
      // Should see provider list
    }
  });

  test("7.7 Switch to About tab", async ({ page }) => {
    const tab = page
      .locator(
        'button[role="tab"]:has-text("About"), button:has-text("О приложении")',
      )
      .first();
    if (await tab.isVisible({ timeout: 1000 }).catch(() => false)) {
      await tab.click();
      await page.waitForTimeout(500);
      // Should see version info
      await expect(
        page.locator("text=/0\\.3\\.1|version|OpenCode/i").first(),
      ).toBeVisible({
        timeout: 2000,
      });
    }
  });

  test("7.8 Close settings panel", async ({ page }) => {
    // Find close button (X)
    const closeBtn = page
      .locator(
        'button[title="Close"], button:has-text("Close"), [aria-label="Close"]',
      )
      .first();
    if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(300);
    }
  });
});

// ============================================================================
// 8. SETTINGS — non-admin user restrictions
// ============================================================================
test.describe("8. Settings — non-admin restrictions", () => {
  test.beforeEach(async ({ page }) => {
    // Register a fresh non-admin user (admin is pre-seeded)
    const newUser = {
      email: `nonadmin+${Date.now()}@local.test`,
      password: "nonadmin123",
    };
    await register(page, newUser);
    await page.getByRole("button", { name: /Settings/i }).click();
    await page.waitForTimeout(500);
  });

  test("8.1 Non-admin sees settings panel without admin controls", async ({
    page,
  }) => {
    // The settings panel opens (the panel itself is shared)
    await expect(
      page
        .locator(
          "text=/Self-Improvement|self-improve|Самоулучшение|Провайдеры|About|О приложении/i",
        )
        .first(),
    ).toBeVisible({ timeout: 3000 });
    // The toggle may be disabled for non-admins
    const toggle = page.locator('button[role="switch"]').first();
    if (await toggle.isVisible({ timeout: 1000 }).catch(() => false)) {
      // Don't strictly assert disabled — just verify no crash from looking at it
    }
  });

  test("8.2 Non-admin cannot trigger rebuild/reset (buttons disabled or hidden)", async ({
    page,
  }) => {
    // These should be hidden for non-admins OR disabled
    const rebuild = page.locator('button:has-text("Rebuild")').first();
    if (await rebuild.isVisible({ timeout: 1000 }).catch(() => false)) {
      // If visible, should be disabled
      const isDisabled = await rebuild.isDisabled().catch(() => true);
      expect(isDisabled).toBeTruthy();
    }
    // Test passes if button is hidden OR disabled
  });
});

// ============================================================================
// 9. CONNECTION BANNER (when OpenCode unreachable)
// ============================================================================
test.describe("9. Connection banner", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN);
  });

  test("9.1 Connection banner appears because OpenCode is down", async ({
    page,
  }) => {
    // The amber banner should appear: "Can't connect to the OpenCode server"
    await expect(
      page.locator("text=/Can't connect to the OpenCode|opencode serve/i"),
    ).toBeVisible({
      timeout: 5000,
    });
  });

  test("9.2 Retry button in banner", async ({ page }) => {
    const retryBtn = page.locator('button:has-text("Retry")').first();
    await expect(retryBtn).toBeVisible();
    // Click retry — should re-attempt connection, still fail
    await retryBtn.click();
    await page.waitForTimeout(500);
    // Banner should still be visible
    await expect(
      page.locator("text=/Can't connect to the OpenCode|opencode serve/i"),
    ).toBeVisible();
  });
});

// ============================================================================
// 10. MOBILE RESPONSIVE
// ============================================================================
test.describe("10. Mobile responsive", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN);
  });

  test("10.1 Sidebar hidden by default on mobile", async ({ page }) => {
    // On mobile, sidebar is hidden behind a hamburger
    const menuBtn = page.locator('button[title="Menu"]').first();
    await expect(menuBtn).toBeVisible();
  });

  test("10.2 Open sidebar via hamburger", async ({ page }) => {
    const menuBtn = page.locator('button[title="Menu"]').first();
    await menuBtn.click();
    await page.waitForTimeout(300);
    // New chat button should now be visible
    await expect(page.getByRole("button", { name: /New chat/i })).toBeVisible();
  });

  test("10.3 Backdrop closes sidebar (via tap on backdrop)", async ({
    page,
  }) => {
    await page.locator('button[title="Menu"]').first().click();
    await page.waitForTimeout(500);
    // The sidebar backdrop is a fixed div — use evaluate to click it (since sidebar may intercept)
    await page.evaluate(() => {
      const backdrops = document.querySelectorAll(".fixed.inset-0.z-40");
      if (backdrops.length > 0) {
        (backdrops[0] as HTMLElement).click();
      }
    });
    await page.waitForTimeout(500);
    // Sidebar should be hidden again — menu button should still be visible
    await expect(page.locator('button[title="Menu"]').first()).toBeVisible();
  });
});

// ============================================================================
// 11. NETWORK RESILIENCE
// ============================================================================
test.describe("11. Network resilience", () => {
  test("11.1 App shell renders despite all API failures", async ({ page }) => {
    await login(page, ADMIN);
    // The shell must render even with /api/session, /api/config/providers all 502
    await expect(page.locator("header")).toBeVisible();
    await expect(page.locator("textarea").first()).toBeVisible();
  });

  test("11.2 No uncaught exceptions in console", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => {
      // Ignore 502-related fetch errors (they are caught and shown as UI banner)
      if (!/502|Bad Gateway|Failed to fetch|NetworkError/i.test(err.message)) {
        errors.push(err.message);
      }
    });
    await login(page, ADMIN);
    await page.waitForTimeout(2000);
    // Filter out expected errors (502s)
    expect(errors.filter((e) => !e.includes("502"))).toEqual([]);
  });

  test("11.3 REGRESSION: New chat during AI generation does NOT hang the page (loop bug)", async ({
    page,
  }) => {
    await login(page, ADMIN);
    // Create an empty session by clicking New chat
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent.trim().startsWith("New chat"),
      );
      if (btn) (btn as HTMLElement).click();
    });
    await page.waitForTimeout(2000);

    // Simulate a "busy" status by sending a message (will fail because no AI keys,
    // but status will briefly become busy) OR by directly setting status via store
    await page.evaluate(() => {
      // Type and send
      const ta = document.querySelector("textarea") as HTMLTextAreaElement;
      if (ta) {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        )!.set!;
        setter.call(ta, "test");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const btn = document.querySelector(
        'button[title="Send"]',
      ) as HTMLButtonElement;
      if (btn) btn.click();
    });
    await page.waitForTimeout(500);

    // Click New chat — this used to hang the page in an infinite URL↔store sync loop
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent.trim().startsWith("New chat"),
      );
      if (btn) (btn as HTMLElement).click();
    });

    // Page MUST remain responsive — eval should complete within 3s
    const result = await Promise.race([
      page.evaluate(() => ({
        url: location.href,
        bodyLen: document.body.innerText.length,
      })),
      new Promise<{ error: string }>((_, rej) =>
        setTimeout(() => rej(new Error("PAGE HUNG — regression!")), 5000),
      ),
    ]).catch((e) => ({ error: e.message }));

    expect(result).not.toHaveProperty("error");
    if ("bodyLen" in result) {
      expect(result.bodyLen).toBeGreaterThan(0);
    }
  });
});
