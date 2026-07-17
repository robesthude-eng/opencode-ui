# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: full-ui.spec.ts >> 2. Sidebar >> 2.8 Hide sidebar (desktop)
- Location: e2e/full-ui.spec.ts:228:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('button[title="Show chats"]').first()
Expected: visible
Timeout: 2000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 2000ms
  - waiting for locator('button[title="Show chats"]').first()

```

```yaml
- banner:
  - button "Show sidebar":
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
    - button "New chat"
    - button "Удалить чат New chat"
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
  136 | // ============================================================================
  137 | // 2. SIDEBAR
  138 | // ============================================================================
  139 | test.describe("2. Sidebar", () => {
  140 |   test.beforeEach(async ({ page }) => {
  141 |     await login(page, ADMIN);
  142 |   });
  143 | 
  144 |   test("2.1 New chat button works", async ({ page }) => {
  145 |     // Click New chat — will try /api/session POST which will 502, but UI should react
  146 |     await page.getByRole("button", { name: /New chat/i }).click();
  147 |     // Wait a moment for the optimistic UI
  148 |     await page.waitForTimeout(500);
  149 |     // Sidebar should still be visible (no crash)
  150 |     await expect(page.getByRole("button", { name: /New chat/i })).toBeVisible();
  151 |   });
  152 | 
  153 |   test("2.2 Settings button opens panel", async ({ page }) => {
  154 |     await page.getByRole("button", { name: /Settings/i }).click();
  155 |     await expect(
  156 |       page
  157 |         .locator("text=/Self-Improvement|self-improve|Self-improve/i")
  158 |         .first(),
  159 |     ).toBeVisible({ timeout: 3000 });
  160 |   });
  161 | 
  162 |   test("2.3 Theme toggle (dark/light)", async ({ page }) => {
  163 |     // Wait for app shell to settle
  164 |     await page.waitForTimeout(1000);
  165 |     // Find theme toggle button (Sun or Moon icon) — there are 2 (sidebar + topbar)
  166 |     const themeBtns = page.locator('button[title="Toggle theme"]');
  167 |     const count = await themeBtns.count();
  168 |     expect(count).toBeGreaterThan(0);
  169 |     // Theme is stored as data-theme attribute on <html>
  170 |     const before = await page.evaluate(
  171 |       () => document.documentElement.dataset.theme,
  172 |     );
  173 |     await themeBtns.first().click();
  174 |     await page.waitForTimeout(500);
  175 |     const after = await page.evaluate(
  176 |       () => document.documentElement.dataset.theme,
  177 |     );
  178 |     expect(before).not.toBe(after);
  179 |   });
  180 | 
  181 |   test("2.4 Theme persists across reload", async ({ page }) => {
  182 |     const themeBtn = page.locator('button[title="Toggle theme"]').first();
  183 |     await themeBtn.click();
  184 |     await page.waitForTimeout(300);
  185 |     const theme = await page.evaluate(
  186 |       () => document.documentElement.dataset.theme,
  187 |     );
  188 |     await page.reload();
  189 |     await page.waitForLoadState("networkidle");
  190 |     const themeAfter = await page.evaluate(
  191 |       () => document.documentElement.dataset.theme,
  192 |     );
  193 |     expect(theme).toBe(themeAfter);
  194 |   });
  195 | 
  196 |   test("2.5 Email display in sidebar", async ({ page }) => {
  197 |     // Email should be visible in sidebar — it's inside a button with truncate
  198 |     const emailButton = page
  199 |       .locator(`button:has-text("${ADMIN.email}")`)
  200 |       .first();
  201 |     await expect(emailButton).toBeVisible({ timeout: 3000 });
  202 |   });
  203 | 
  204 |   test("2.6 Click email shows full email tooltip", async ({ page }) => {
  205 |     // The email button toggles a tooltip with the full email
  206 |     const emailBtn = page.locator('button[title*="email" i]').first();
  207 |     if (await emailBtn.isVisible().catch(() => false)) {
  208 |       await emailBtn.click();
  209 |       // Tooltip should appear
  210 |       await page.waitForTimeout(200);
  211 |     }
  212 |   });
  213 | 
  214 |   test("2.7 Logout button confirms and logs out", async ({ page }) => {
  215 |     // Set up dialog handler BEFORE clicking
  216 |     page.on("dialog", (dialog) => dialog.accept());
  217 |     // The logout button has title containing "Выйти" (Logout in Russian)
  218 |     const logoutBtn = page.locator('button[title*="Выйти"]').first();
  219 |     await expect(logoutBtn).toBeVisible({ timeout: 3000 });
  220 |     await logoutBtn.click();
  221 |     await page.waitForTimeout(1500);
  222 |     // Should be back on login page
  223 |     await expect(page.getByRole("button", { name: "Войти" })).toBeVisible({
  224 |       timeout: 5000,
  225 |     });
  226 |   });
  227 | 
  228 |   test("2.8 Hide sidebar (desktop)", async ({ page }) => {
  229 |     const hideBtn = page.locator('button[title="Hide sidebar"]').first();
  230 |     if (await hideBtn.isVisible().catch(() => false)) {
  231 |       await hideBtn.click();
  232 |       await page.waitForTimeout(300);
  233 |       // A "show sidebar" button should appear
  234 |       await expect(
  235 |         page.locator('button[title="Show chats"]').first(),
> 236 |       ).toBeVisible({
      |         ^ Error: expect(locator).toBeVisible() failed
  237 |         timeout: 2000,
  238 |       });
  239 |       // Click to show again
  240 |       await page.locator('button[title="Show chats"]').first().click();
  241 |       await page.waitForTimeout(300);
  242 |     }
  243 |   });
  244 | 
  245 |   test("2.9 Chat list shows empty state", async ({ page }) => {
  246 |     // Since OpenCode is not running, we have no chats
  247 |     await expect(
  248 |       page.locator("text=/No conversations yet|Нет чатов|новых чатов/i"),
  249 |     )
  250 |       .toBeVisible({ timeout: 3000 })
  251 |       .catch(() => {
  252 |         // Or it might already have a tmp_ session from previous test
  253 |       });
  254 |   });
  255 | });
  256 | 
  257 | // ============================================================================
  258 | // 3. TOPBAR
  259 | // ============================================================================
  260 | test.describe("3. TopBar", () => {
  261 |   test.beforeEach(async ({ page }) => {
  262 |     await login(page, ADMIN);
  263 |   });
  264 | 
  265 |   test("3.1 Workspace toggle opens workspace panel", async ({ page }) => {
  266 |     const wsBtn = page.locator('button[title="Toggle workspace"]').first();
  267 |     await wsBtn.click();
  268 |     await page.waitForTimeout(300);
  269 |     // Workspace panel should be visible — look for "Workspace" header
  270 |     await expect(page.locator("text=/Workspace/i").first()).toBeVisible({
  271 |       timeout: 2000,
  272 |     });
  273 |     // Close it
  274 |     await wsBtn.click();
  275 |     await page.waitForTimeout(300);
  276 |   });
  277 | 
  278 |   test("3.2 Theme toggle in TopBar works", async ({ page }) => {
  279 |     await page.waitForTimeout(500);
  280 |     const themeBtns = page.locator('button[title="Toggle theme"]');
  281 |     const count = await themeBtns.count();
  282 |     expect(count).toBeGreaterThan(0);
  283 |     const before = await page.evaluate(
  284 |       () => document.documentElement.dataset.theme,
  285 |     );
  286 |     await themeBtns.nth(count - 1).click();
  287 |     await page.waitForTimeout(500);
  288 |     const after = await page.evaluate(
  289 |       () => document.documentElement.dataset.theme,
  290 |     );
  291 |     expect(before).not.toBe(after);
  292 |   });
  293 | 
  294 |   test("3.3 Model selector visible", async ({ page }) => {
  295 |     // ModelSelector is in the center of TopBar — but since /api/config/providers 502s,
  296 |     // it may show empty/placeholder. Just check the area exists.
  297 |     const topBar = page.locator("header").first();
  298 |     await expect(topBar).toBeVisible();
  299 |   });
  300 | });
  301 | 
  302 | // ============================================================================
  303 | // 4. CHAT VIEW (empty state)
  304 | // ============================================================================
  305 | test.describe("4. ChatView empty state", () => {
  306 |   test.beforeEach(async ({ page }) => {
  307 |     await login(page, ADMIN);
  308 |   });
  309 | 
  310 |   test("4.1 Welcome screen with suggestions", async ({ page }) => {
  311 |     await expect(
  312 |       page.locator("text=/Чем могу помочь|How can I help/i"),
  313 |     ).toBeVisible();
  314 |     // 4 suggestion cards
  315 |     const suggestions = page.locator(
  316 |       'button:has-text("Написать код"), button:has-text("Объяснить код"), button:has-text("Создать файл"), button:has-text("Отладить")',
  317 |     );
  318 |     expect(await suggestions.count()).toBeGreaterThanOrEqual(4);
  319 |   });
  320 | 
  321 |   test("4.2 Click suggestion triggers send (will fail because no OpenCode)", async ({
  322 |     page,
  323 |   }) => {
  324 |     const suggestion = page.locator('button:has-text("Написать код")').first();
  325 |     await suggestion.click();
  326 |     await page.waitForTimeout(1000);
  327 |     // UI should not crash. Either it created a tmp_ session and shows error, or shows the prompt
  328 |     // Either way the page should still be responsive
  329 |     await expect(page.locator("body")).toBeVisible();
  330 |   });
  331 | });
  332 | 
  333 | // ============================================================================
  334 | // 5. COMPOSER
  335 | // ============================================================================
  336 | test.describe("5. Composer", () => {
```