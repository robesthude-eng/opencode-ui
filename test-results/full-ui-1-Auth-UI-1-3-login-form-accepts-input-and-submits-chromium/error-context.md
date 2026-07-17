# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: full-ui.spec.ts >> 1. Auth UI >> 1.3 login form accepts input and submits
- Location: e2e/full-ui.spec.ts:95:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('button:has(img):has-text("New chat")').first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('button:has(img):has-text("New chat")').first()

```

```yaml
- banner:
  - button "Hide sidebar":
    - img
  - button "DeepSeek V4 Flash Free FREE":
    - text: DeepSeek V4 Flash Free FREE
    - img
  - button "Open terminal" [disabled]:
    - img
  - button "Open preview" [disabled]:
    - img
  - button "Toggle workspace":
    - img
- complementary:
  - button "New chat":
    - img
    - text: New chat
  - navigation:
    - paragraph: No conversations yet
  - button "Settings":
    - img
    - text: Settings
  - button "Toggle theme":
    - img
  - button "👤 admin@local.test"
  - button "Выйти (admin@local.test)":
    - img
- main:
  - heading "Чем могу помочь?" [level=1]
  - paragraph: Твой персональный AI-ассистент для кода. Напиши свой запрос.
- button "Attach file":
  - img
- textbox "Что хотите сделать?"
- button "Send" [disabled]:
  - img
```

# Test source

```ts
  1   | /**
  2   |  * UI Test Suite — opencode-ui
  3   |  *
  4   |  * Tests every interactive element in the app that doesn't require OpenCode backend:
  5   |  * - Login / register flow
  6   |  * - Sidebar (New chat, Settings, Theme toggle, Logout, email display)
  7   |  * - TopBar (Workspace toggle, Theme toggle, mobile menu)
  8   |  * - ChatView (suggestions, empty state, scroll-to-bottom button)
  9   |  * - Composer (textarea, attach button, send/stop, drag-drop, key bindings)
  10  |  * - Workspace panel (open/close, refresh, search filter, upload folder button)
  11  |  * - Settings panel (all tabs: self-improve, free-models, providers, about)
  12  |  *   - Toggle self-improve, rebuild, reset UI (visible only to admin)
  13  |  *   - Save/remove provider key form (without actually saving real API keys)
  14  |  *   - About info
  15  |  * - Permission dialog (closed state at least)
  16  |  * - Mobile responsive layout
  17  |  * - Theme persistence (refresh)
  18  |  * - Error boundary — connection banner when OpenCode unreachable
  19  |  *
  20  |  * Run with:  PLAYWRIGHT_BASE_URL=http://127.0.0.1:3000 npx playwright test --reporter=list
  21  |  */
  22  | import { expect, test } from "@playwright/test";
  23  | 
  24  | const _BASE = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
  25  | // Pre-seeded admin user (see /home/z/my-project/scripts/reset-and-seed.sh)
  26  | const ADMIN = { email: "admin@local.test", password: "testpass123" };
  27  | const _USER2 = {
  28  |   email: `user+${Date.now()}@local.test`,
  29  |   password: "userpass123",
  30  | };
  31  | 
  32  | async function register(page, creds) {
  33  |   await page.goto("/");
  34  |   // Switch to register tab
  35  |   await page.getByRole("button", { name: "Регистрация" }).click();
  36  |   await page.locator('input[id="email"]').fill(creds.email);
  37  |   await page.locator('input[id="password"]').fill(creds.password);
  38  |   // Confirm password field appears when registering
  39  |   await page.waitForSelector('input[id="confirm"]', { timeout: 2000 });
  40  |   await page.locator('input[id="confirm"]').fill(creds.password);
  41  |   await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  42  |   // Wait for redirect to app shell. The left sidebar is hidden (translated off-screen)
  43  |   // on mobile viewports, so waiting for 'aside' to be visible times out. Wait for the
  44  |   // topbar/header instead — it's always visible in the authenticated shell regardless
  45  |   // of viewport size — and for the login form to disappear.
  46  |   await page.waitForSelector("header", { timeout: 10000 });
  47  |   await expect(page.getByRole("button", { name: "Войти" })).toHaveCount(0);
  48  | }
  49  | 
  50  | async function login(page, creds) {
  51  |   await page.goto("/");
  52  |   // Already on login tab by default
  53  |   await page.locator('input[id="email"]').fill(creds.email);
  54  |   await page.locator('input[id="password"]').fill(creds.password);
  55  |   await page.getByRole("button", { name: "Войти" }).click();
  56  |   // See note in register(): sidebar may be off-screen on mobile; wait for topbar.
  57  |   await page.waitForSelector("header", { timeout: 10000 });
  58  |   await expect(page.getByRole("button", { name: "Войти" })).toHaveCount(0);
  59  | }
  60  | 
  61  | // The primary "New chat" button — the top-most button in the sidebar with the
  62  | // pencil icon and "New chat" text (NOT the temporary list-item button inside the
  63  | // chat list, and NOT the delete button whose aria-label contains "New chat").
  64  | function newChatButton(page) {
  65  |   // Match a "New chat" button that is a direct child of the sidebar layout and
  66  |   // has the pencil icon (an <img> as first child) — that's the primary action.
  67  |   return page
  68  |     .locator('button:has(img):has-text("New chat")')
  69  |     .first();
  70  | }
  71  | 
  72  | // ============================================================================
  73  | // 1. LOGIN / REGISTER
  74  | // ============================================================================
  75  | test.describe("1. Auth UI", () => {
  76  |   test("1.1 login as pre-seeded admin → app shell", async ({ page }) => {
  77  |     await login(page, ADMIN);
  78  |     await expect(newChatButton(page)).toBeVisible();
  79  |   });
  80  | 
  81  |   test("1.2 register a new (non-admin) user → app shell", async ({
  82  |     browser,
  83  |   }) => {
  84  |     const ctx = await browser.newContext();
  85  |     const page = await ctx.newPage();
  86  |     const newUser = {
  87  |       email: `user+${Date.now()}@local.test`,
  88  |       password: "userpass123",
  89  |     };
  90  |     await register(page, newUser);
  91  |     await expect(newChatButton(page)).toBeVisible();
  92  |     await ctx.close();
  93  |   });
  94  | 
  95  |   test("1.3 login form accepts input and submits", async ({ browser }) => {
  96  |     const ctx = await browser.newContext();
  97  |     const page = await ctx.newPage();
  98  |     await login(page, ADMIN);
> 99  |     await expect(newChatButton(page)).toBeVisible();
      |                                       ^ Error: expect(locator).toBeVisible() failed
  100 |     await ctx.close();
  101 |   });
  102 | 
  103 |   test("1.4 login with wrong password shows error", async ({ page }) => {
  104 |     await page.goto("/");
  105 |     await page.locator('input[id="email"]').fill(ADMIN.email);
  106 |     await page.locator('input[id="password"]').fill("wrong-password");
  107 |     await page.getByRole("button", { name: "Войти" }).click();
  108 |     // Should show error message, NOT redirect
  109 |     await expect(
  110 |       page.locator("text=/неверн|invalid|ошибк|Invalid email/i").first(),
  111 |     ).toBeVisible({
  112 |       timeout: 3000,
  113 |     });
  114 |   });
  115 | 
  116 |   test("1.5 register with mismatched passwords shows error", async ({
  117 |     page,
  118 |   }) => {
  119 |     await page.goto("/");
  120 |     await page.getByRole("button", { name: "Регистрация" }).click();
  121 |     await page
  122 |       .locator('input[id="email"]')
  123 |       .fill(`mismatch+${Date.now()}@test.com`);
  124 |     await page.locator('input[id="password"]').fill("password1");
  125 |     // Make sure confirm field is visible after switching to register mode
  126 |     await page.waitForSelector('input[id="confirm"]', { timeout: 2000 });
  127 |     await page.locator('input[id="confirm"]').fill("different-password");
  128 |     await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  129 |     await expect(
  130 |       page.locator("text=/не совпадают|do not match/i").first(),
  131 |     ).toBeVisible({
  132 |       timeout: 3000,
  133 |     });
  134 |   });
  135 | 
  136 |   test("1.6 switching between login/register tabs", async ({ page }) => {
  137 |     await page.goto("/");
  138 |     await page.getByRole("button", { name: "Регистрация" }).click();
  139 |     // Confirm field visible in register mode
  140 |     await expect(page.locator('input[id="confirm"]')).toBeVisible();
  141 |     await page.getByRole("button", { name: "Вход" }).click();
  142 |     // Confirm field hidden in login mode
  143 |     await expect(page.locator('input[id="confirm"]')).toBeHidden();
  144 |   });
  145 | });
  146 | 
  147 | // ============================================================================
  148 | // 2. SIDEBAR
  149 | // ============================================================================
  150 | test.describe("2. Sidebar", () => {
  151 |   test.beforeEach(async ({ page }) => {
  152 |     await login(page, ADMIN);
  153 |   });
  154 | 
  155 |   test("2.1 New chat button works", async ({ page }) => {
  156 |     // Click New chat — will try /api/session POST which will 502, but UI should react
  157 |     await newChatButton(page).click();
  158 |     // Wait a moment for the optimistic UI
  159 |     await page.waitForTimeout(500);
  160 |     // Sidebar should still be visible (no crash)
  161 |     await expect(newChatButton(page)).toBeVisible();
  162 |   });
  163 | 
  164 |   test("2.2 Settings button opens panel", async ({ page }) => {
  165 |     await page.getByRole("button", { name: /Settings/i }).click();
  166 |     await expect(
  167 |       page
  168 |         .locator("text=/Self-Improvement|self-improve|Self-improve/i")
  169 |         .first(),
  170 |     ).toBeVisible({ timeout: 3000 });
  171 |   });
  172 | 
  173 |   test("2.3 Theme toggle (dark/light)", async ({ page }) => {
  174 |     // Wait for app shell to settle
  175 |     await page.waitForTimeout(1000);
  176 |     // Find theme toggle button (Sun or Moon icon) — there are 2 (sidebar + topbar)
  177 |     const themeBtns = page.locator('button[title="Toggle theme"]');
  178 |     const count = await themeBtns.count();
  179 |     expect(count).toBeGreaterThan(0);
  180 |     // Theme is stored as data-theme attribute on <html>
  181 |     const before = await page.evaluate(
  182 |       () => document.documentElement.dataset.theme,
  183 |     );
  184 |     await themeBtns.first().click();
  185 |     await page.waitForTimeout(500);
  186 |     const after = await page.evaluate(
  187 |       () => document.documentElement.dataset.theme,
  188 |     );
  189 |     expect(before).not.toBe(after);
  190 |   });
  191 | 
  192 |   test("2.4 Theme persists across reload", async ({ page }) => {
  193 |     const themeBtn = page.locator('button[title="Toggle theme"]').first();
  194 |     await themeBtn.click();
  195 |     await page.waitForTimeout(300);
  196 |     const theme = await page.evaluate(
  197 |       () => document.documentElement.dataset.theme,
  198 |     );
  199 |     await page.reload();
```