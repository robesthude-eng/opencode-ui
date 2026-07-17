# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: full-ui.spec.ts >> 4. ChatView empty state >> 4.2 Click suggestion triggers send (will fail because no OpenCode)
- Location: e2e/full-ui.spec.ts:321:3

# Error details

```
TimeoutError: locator.click: Timeout 8000ms exceeded.
Call log:
  - waiting for locator('button:has-text("Написать код")').first()

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
        - generic [ref=e53]:
          - button "👤 admin@local.test" [ref=e55]:
            - generic [ref=e56]: 👤
            - generic [ref=e57]: admin@local.test
          - button "Выйти (admin@local.test)" [ref=e58]:
            - img [ref=e59]
    - generic [ref=e64]:
      - main [ref=e65]:
        - generic [ref=e67]:
          - heading "Чем могу помочь?" [level=1] [ref=e68]
          - paragraph [ref=e69]: Твой персональный AI-ассистент для кода. Напиши свой запрос.
      - generic [ref=e72]:
        - button "Attach file" [ref=e73]:
          - img [ref=e74]
        - textbox "Что хотите сделать?" [ref=e76]
        - generic [ref=e77]:
          - button "Send" [disabled]:
            - img
```

# Test source

```ts
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
> 325 |     await suggestion.click();
      |                      ^ TimeoutError: locator.click: Timeout 8000ms exceeded.
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
  337 |   test.beforeEach(async ({ page }) => {
  338 |     await login(page, ADMIN);
  339 |   });
  340 | 
  341 |   test("5.1 Textarea is visible and accepts input", async ({ page }) => {
  342 |     const textarea = page.locator("textarea").first();
  343 |     await expect(textarea).toBeVisible();
  344 |     await textarea.fill("Test message");
  345 |     await expect(textarea).toHaveValue("Test message");
  346 |   });
  347 | 
  348 |   test("5.2 Send button disabled when empty", async ({ page }) => {
  349 |     const sendBtn = page.locator('button[title="Send"]').first();
  350 |     // Should be disabled when no text and no attachments
  351 |     await expect(sendBtn).toBeDisabled();
  352 |   });
  353 | 
  354 |   test("5.3 Send button enabled when text entered", async ({ page }) => {
  355 |     const textarea = page.locator("textarea").first();
  356 |     await textarea.fill("Hello world");
  357 |     const sendBtn = page.locator('button[title="Send"]').first();
  358 |     await expect(sendBtn).toBeEnabled();
  359 |   });
  360 | 
  361 |   test("5.4 Enter key submits (no shift)", async ({ page }) => {
  362 |     const textarea = page.locator("textarea").first();
  363 |     await textarea.fill("Test");
  364 |     await textarea.press("Enter");
  365 |     // Will try to send — may fail (no session, no OpenCode), but should not crash
  366 |     await page.waitForTimeout(500);
  367 |     await expect(page.locator("body")).toBeVisible();
  368 |   });
  369 | 
  370 |   test("5.5 Shift+Enter creates new line", async ({ page }) => {
  371 |     const textarea = page.locator("textarea").first();
  372 |     await textarea.fill("Line 1");
  373 |     await textarea.press("Shift+Enter");
  374 |     await textarea.type("Line 2");
  375 |     const value = await textarea.inputValue();
  376 |     expect(value).toContain("Line 1");
  377 |     expect(value).toContain("Line 2");
  378 |     expect(value).toContain("\n");
  379 |   });
  380 | 
  381 |   test("5.6 Attach button opens file picker (click)", async ({ page }) => {
  382 |     // Just verify the button exists and is clickable
  383 |     const attachBtn = page.locator('button[title="Attach files"]').first();
  384 |     await expect(attachBtn).toBeVisible();
  385 |     await expect(attachBtn).toBeEnabled();
  386 |   });
  387 | 
  388 |   test("5.7 Textarea grows with input", async ({ page }) => {
  389 |     const textarea = page.locator("textarea").first();
  390 |     const initialHeight = await textarea.evaluate((el) => el.offsetHeight);
  391 |     await textarea.fill("Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6");
  392 |     await page.waitForTimeout(200);
  393 |     const finalHeight = await textarea.evaluate((el) => el.offsetHeight);
  394 |     expect(finalHeight).toBeGreaterThanOrEqual(initialHeight);
  395 |   });
  396 | 
  397 |   test("5.8 Helper text visible", async ({ page }) => {
  398 |     await expect(
  399 |       page.locator("text=/Shift\\+Enter|Drag & drop/i"),
  400 |     ).toBeVisible();
  401 |   });
  402 | });
  403 | 
  404 | // ============================================================================
  405 | // 6. WORKSPACE PANEL
  406 | // ============================================================================
  407 | test.describe("6. Workspace panel", () => {
  408 |   test.beforeEach(async ({ page }) => {
  409 |     await login(page, ADMIN);
  410 |     // Open workspace
  411 |     await page.locator('button[title="Toggle workspace"]').first().click();
  412 |     await page.waitForTimeout(500);
  413 |   });
  414 | 
  415 |   test("6.1 Workspace panel opens with header", async ({ page }) => {
  416 |     await expect(page.locator("text=/Workspace/i").first()).toBeVisible();
  417 |   });
  418 | 
  419 |   test("6.2 Refresh button visible and clickable", async ({ page }) => {
  420 |     const refreshBtn = page.locator('button[title="Refresh now"]').first();
  421 |     await expect(refreshBtn).toBeVisible();
  422 |     await refreshBtn.click();
  423 |     await page.waitForTimeout(500);
  424 |   });
  425 | 
```