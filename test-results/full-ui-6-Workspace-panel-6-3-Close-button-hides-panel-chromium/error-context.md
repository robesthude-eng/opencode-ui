# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: full-ui.spec.ts >> 6. Workspace panel >> 6.3 Close button hides panel
- Location: e2e/full-ui.spec.ts:426:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('header').filter({ hasText: 'Workspace' }).first().locator('button[title="Close"]')
Expected: visible
Timeout: 2000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 2000ms
  - waiting for locator('header').filter({ hasText: 'Workspace' }).first().locator('button[title="Close"]')

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
- complementary:
  - text: Files
  - button "Refresh now":
    - img
  - img
  - textbox "Filter files…"
  - paragraph: Выберите или создайте чат, чтобы увидеть workspace.
```

# Test source

```ts
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
  426 |   test("6.3 Close button hides panel", async ({ page }) => {
  427 |     // Find close button INSIDE the workspace panel (the sidebar's mobile close button has md:hidden)
  428 |     // Workspace panel header text: 'Workspace' — the close button is in the same header
  429 |     const wsHeader = page.locator("header", { hasText: "Workspace" }).first();
  430 |     const closeBtn = wsHeader.locator('button[title="Close"]');
> 431 |     await expect(closeBtn).toBeVisible({ timeout: 2000 });
      |                            ^ Error: expect(locator).toBeVisible() failed
  432 |     await closeBtn.click();
  433 |     await page.waitForTimeout(500);
  434 |     // Workspace panel should be hidden now
  435 |     const wsHeaders = page.locator('header:has-text("Workspace")');
  436 |     expect(await wsHeaders.count()).toBe(0);
  437 |   });
  438 | 
  439 |   test("6.4 Search filter input", async ({ page }) => {
  440 |     const search = page.locator('input[placeholder*="Filter"]').first();
  441 |     await expect(search).toBeVisible();
  442 |     await search.fill("test");
  443 |     await expect(search).toHaveValue("test");
  444 |   });
  445 | 
  446 |   test("6.5 Upload folder button visible", async ({ page }) => {
  447 |     const uploadBtn = page.locator('button:has-text("Upload folder")').first();
  448 |     await expect(uploadBtn).toBeVisible();
  449 |   });
  450 | 
  451 |   test("6.6 Empty state message when no chat selected", async ({ page }) => {
  452 |     // Should show "Выберите или создайте чат" since no chat is selected
  453 |     await expect(
  454 |       page.locator("text=/Выберите или создайте чат|Загрузка файлов/i").first(),
  455 |     ).toBeVisible({ timeout: 3000 });
  456 |   });
  457 | });
  458 | 
  459 | // ============================================================================
  460 | // 7. SETTINGS PANEL — tabs and admin features
  461 | // ============================================================================
  462 | test.describe("7. Settings panel", () => {
  463 |   test.beforeEach(async ({ page }) => {
  464 |     await login(page, ADMIN);
  465 |     await page.getByRole("button", { name: /Settings/i }).click();
  466 |     await page.waitForTimeout(500);
  467 |   });
  468 | 
  469 |   test("7.1 Settings panel opens", async ({ page }) => {
  470 |     // The panel should be visible — check for tab labels
  471 |     await expect(
  472 |       page
  473 |         .locator(
  474 |           "text=/Self-Improvement|self-improve|Самоулучшение|Провайдеры|About|О приложении/i",
  475 |         )
  476 |         .first(),
  477 |     ).toBeVisible({ timeout: 3000 });
  478 |   });
  479 | 
  480 |   test("7.2 Self-Improve tab — toggle switch visible to admin", async ({
  481 |     page,
  482 |   }) => {
  483 |     // Look for the toggle switch in the self-improve tab (default)
  484 |     const toggle = page.locator('button[role="switch"]').first();
  485 |     if (await toggle.isVisible({ timeout: 1000 }).catch(() => false)) {
  486 |       // Toggle ON
  487 |       await toggle.click();
  488 |       await page.waitForTimeout(500);
  489 |       // Should trigger a network call to /api/settings/self-improve
  490 |     }
  491 |   });
  492 | 
  493 |   test("7.3 Self-Improve tab — rebuild button visible to admin", async ({
  494 |     page,
  495 |   }) => {
  496 |     // Rebuild button — visible but disabled when self-improve is OFF
  497 |     const rebuildBtn = page
  498 |       .locator('button:has-text("Rebuild"), button:has-text("Пересобрать")')
  499 |       .first();
  500 |     if (await rebuildBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
  501 |       // Don't click — would actually rebuild. Just verify it's there
  502 |     }
  503 |   });
  504 | 
  505 |   test("7.4 Self-Improve tab — reset UI button visible to admin", async ({
  506 |     page,
  507 |   }) => {
  508 |     const resetBtn = page
  509 |       .locator('button:has-text("Reset"), button:has-text("Сбросить")')
  510 |       .first();
  511 |     if (await resetBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
  512 |       // Don't click — would actually reset
  513 |     }
  514 |   });
  515 | 
  516 |   test("7.5 Self-Improve tab — checkpoints list visible", async ({ page }) => {
  517 |     // Checkpoints list should load (uses /api/git/checkpoints which works without OpenCode)
  518 |     await page.waitForTimeout(1000); // give it time to load
  519 |     // Look for any text indicating checkpoint list (could be "No checkpoints" or actual commits)
  520 |   });
  521 | 
  522 |   test("7.6 Switch to Providers tab", async ({ page }) => {
  523 |     // Find and click Providers tab
  524 |     const tab = page
  525 |       .locator(
  526 |         'button[role="tab"]:has-text("Providers"), button:has-text("Провайдеры")',
  527 |       )
  528 |       .first();
  529 |     if (await tab.isVisible({ timeout: 1000 }).catch(() => false)) {
  530 |       await tab.click();
  531 |       await page.waitForTimeout(500);
```