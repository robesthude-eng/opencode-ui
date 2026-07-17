# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: full-ui.spec.ts >> 2. Sidebar >> 2.4 Theme persists across reload
- Location: e2e/full-ui.spec.ts:181:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.waitForLoadState: Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - button "Hide sidebar" [ref=e5]:
      - img [ref=e6]
    - button "DeepSeek V4 Flash Free FREE" [ref=e12]:
      - generic [ref=e13]:
        - generic [ref=e14]: DeepSeek V4 Flash Free
        - generic [ref=e15]: FREE
      - img [ref=e17]
    - button "Open terminal" [disabled]:
      - img
    - button "Open preview" [disabled]:
      - img
    - button "Toggle workspace" [ref=e19]:
      - img [ref=e20]
  - generic [ref=e22]:
    - complementary [ref=e25]:
      - button "New chat" [ref=e28]:
        - img [ref=e29]
        - generic [ref=e31]: New chat
      - navigation [ref=e35]:
        - generic [ref=e36]:
          - button "New chat" [ref=e37] [cursor=pointer]:
            - generic [ref=e38]: New chat
          - button "Удалить чат New chat" [ref=e39] [cursor=pointer]:
            - img [ref=e40]
      - generic [ref=e43]:
        - generic [ref=e44]:
          - button "Settings" [ref=e45]:
            - img [ref=e46]
            - generic [ref=e49]: Settings
          - button "Toggle theme" [ref=e50]:
            - img [ref=e51]
        - generic [ref=e54]:
          - button "👤 admin@local.test" [ref=e56]:
            - generic [ref=e57]: 👤
            - generic [ref=e58]: admin@local.test
          - button "Выйти (admin@local.test)" [ref=e59]:
            - img [ref=e60]
    - generic [ref=e65]:
      - main [ref=e66]:
        - generic [ref=e68]:
          - heading "Чем могу помочь?" [level=1] [ref=e69]
          - paragraph [ref=e70]: Твой персональный AI-ассистент для кода. Напиши свой запрос.
      - generic [ref=e73]:
        - button "Attach file" [ref=e74]:
          - img [ref=e75]
        - textbox "Что хотите сделать?" [ref=e77]
        - generic [ref=e78]:
          - button "Send" [disabled]:
            - img
```

# Test source

```ts
  89  |     await ctx.close();
  90  |   });
  91  | 
  92  |   test("1.4 login with wrong password shows error", async ({ page }) => {
  93  |     await page.goto("/");
  94  |     await page.locator('input[id="email"]').fill(ADMIN.email);
  95  |     await page.locator('input[id="password"]').fill("wrong-password");
  96  |     await page.getByRole("button", { name: "Войти" }).click();
  97  |     // Should show error message, NOT redirect
  98  |     await expect(
  99  |       page.locator("text=/неверн|invalid|ошибк|Invalid email/i").first(),
  100 |     ).toBeVisible({
  101 |       timeout: 3000,
  102 |     });
  103 |   });
  104 | 
  105 |   test("1.5 register with mismatched passwords shows error", async ({
  106 |     page,
  107 |   }) => {
  108 |     await page.goto("/");
  109 |     await page.getByRole("button", { name: "Регистрация" }).click();
  110 |     await page
  111 |       .locator('input[id="email"]')
  112 |       .fill(`mismatch+${Date.now()}@test.com`);
  113 |     await page.locator('input[id="password"]').fill("password1");
  114 |     // Make sure confirm field is visible after switching to register mode
  115 |     await page.waitForSelector('input[id="confirm"]', { timeout: 2000 });
  116 |     await page.locator('input[id="confirm"]').fill("different-password");
  117 |     await page.getByRole("button", { name: "Зарегистрироваться" }).click();
  118 |     await expect(
  119 |       page.locator("text=/не совпадают|do not match/i").first(),
  120 |     ).toBeVisible({
  121 |       timeout: 3000,
  122 |     });
  123 |   });
  124 | 
  125 |   test("1.6 switching between login/register tabs", async ({ page }) => {
  126 |     await page.goto("/");
  127 |     await page.getByRole("button", { name: "Регистрация" }).click();
  128 |     // Confirm field visible in register mode
  129 |     await expect(page.locator('input[id="confirm"]')).toBeVisible();
  130 |     await page.getByRole("button", { name: "Вход" }).click();
  131 |     // Confirm field hidden in login mode
  132 |     await expect(page.locator('input[id="confirm"]')).toBeHidden();
  133 |   });
  134 | });
  135 | 
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
> 189 |     await page.waitForLoadState("networkidle");
      |                ^ Error: page.waitForLoadState: Test timeout of 30000ms exceeded.
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
  236 |       ).toBeVisible({
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
```