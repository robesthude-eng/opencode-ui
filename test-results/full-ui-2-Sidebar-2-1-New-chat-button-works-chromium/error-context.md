# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: full-ui.spec.ts >> 2. Sidebar >> 2.1 New chat button works
- Location: e2e/full-ui.spec.ts:144:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: /New chat/i })
Expected: visible
Error: strict mode violation: getByRole('button', { name: /New chat/i }) resolved to 3 elements:
    1) <button class="inline-flex items-center whitespace-nowrap transition-all disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary hover:opacity-90 px-4 py-2 h-9 flex-1 justify-start gap-2 rounded-lg border border-[#454545] bg-[#2b2b2b] text-[12px] font-medium text-white shadow-none hover:bg-[#363636]">…</button> aka getByRole('button', { name: 'New chat' }).first()
    2) <button type="button">…</button> aka getByRole('navigation').getByRole('button', { name: 'New chat', exact: true })
    3) <button type="button" title="Удалить чат" aria-label="Удалить чат New chat">…</button> aka getByRole('button', { name: 'Удалить чат New chat' })

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('button', { name: /New chat/i })

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
    - button "Open terminal" [ref=e19]:
      - img [ref=e20]
    - button "Open preview" [ref=e23]:
      - img [ref=e24]
    - button "Toggle workspace" [ref=e27]:
      - img [ref=e28]
  - generic [ref=e30]:
    - complementary [ref=e33]:
      - button "New chat" [active] [ref=e36]:
        - img [ref=e37]
        - generic [ref=e39]: New chat
      - navigation [ref=e43]:
        - generic [ref=e44]:
          - button "New chat" [ref=e45] [cursor=pointer]:
            - generic [ref=e46]: New chat
          - button "Удалить чат New chat" [ref=e47] [cursor=pointer]:
            - img [ref=e48]
      - generic [ref=e51]:
        - generic [ref=e52]:
          - button "Settings" [ref=e53]:
            - img [ref=e54]
            - generic [ref=e57]: Settings
          - button "Toggle theme" [ref=e58]:
            - img [ref=e59]
        - generic [ref=e61]:
          - button "👤 admin@local.test" [ref=e63]:
            - generic [ref=e64]: 👤
            - generic [ref=e65]: admin@local.test
          - button "Выйти (admin@local.test)" [ref=e66]:
            - img [ref=e67]
    - generic [ref=e72]:
      - main [ref=e73]:
        - paragraph [ref=e77]: Начни диалог — напиши сообщение ниже
      - generic [ref=e80]:
        - button "Attach file" [ref=e81]:
          - img [ref=e82]
        - textbox "Что хотите сделать?" [ref=e84]
        - generic [ref=e85]:
          - button "Send" [disabled]:
            - img
```

# Test source

```ts
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
  61  | // ============================================================================
  62  | // 1. LOGIN / REGISTER
  63  | // ============================================================================
  64  | test.describe("1. Auth UI", () => {
  65  |   test("1.1 login as pre-seeded admin → app shell", async ({ page }) => {
  66  |     await login(page, ADMIN);
  67  |     await expect(page.getByRole("button", { name: /New chat/i })).toBeVisible();
  68  |   });
  69  | 
  70  |   test("1.2 register a new (non-admin) user → app shell", async ({
  71  |     browser,
  72  |   }) => {
  73  |     const ctx = await browser.newContext();
  74  |     const page = await ctx.newPage();
  75  |     const newUser = {
  76  |       email: `user+${Date.now()}@local.test`,
  77  |       password: "userpass123",
  78  |     };
  79  |     await register(page, newUser);
  80  |     await expect(page.getByRole("button", { name: /New chat/i })).toBeVisible();
  81  |     await ctx.close();
  82  |   });
  83  | 
  84  |   test("1.3 login form accepts input and submits", async ({ browser }) => {
  85  |     const ctx = await browser.newContext();
  86  |     const page = await ctx.newPage();
  87  |     await login(page, ADMIN);
  88  |     await expect(page.getByRole("button", { name: /New chat/i })).toBeVisible();
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
> 150 |     await expect(page.getByRole("button", { name: /New chat/i })).toBeVisible();
      |                                                                   ^ Error: expect(locator).toBeVisible() failed
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
```