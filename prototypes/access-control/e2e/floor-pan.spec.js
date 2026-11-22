const { test, expect } = require("@playwright/test");

async function signInFloor(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/floor", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator("#app")).not.toContainText("Loading the asset repository");
}

async function worldTransform(page) {
  return page.locator(".world").evaluate((el) => el.style.transform);
}

function translatePortion(transform) {
  const match = transform.match(/translate\([^)]+\)/);
  return match ? match[0] : "";
}

async function tabToFocused(page, locator, maxTabs) {
  for (let i = 0; i < maxTabs; i += 1) {
    if (await locator.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
}

test("keyboard pan buttons move the floor camera", async ({ page }) => {
  await signInFloor(page);

  const panGroup = page.locator('[role="group"][aria-label="Pan"]');
  await expect(panGroup).toHaveCount(1);
  const panBtns = page.locator('[data-act="floor-pan"]');
  await expect(panBtns).toHaveCount(4);
  await expect(panBtns.nth(0)).toHaveAccessibleName("Pan left");
  await expect(panBtns.nth(1)).toHaveAccessibleName("Pan right");
  await expect(panBtns.nth(2)).toHaveAccessibleName("Pan up");
  await expect(panBtns.nth(3)).toHaveAccessibleName("Pan down");

  const panBeforeZoom = await page.evaluate(() => {
    const pan = document.querySelector('[role="group"][aria-label="Pan"]');
    const zoom = document.querySelector('[role="group"][aria-label="Zoom"]');
    return !!(pan.compareDocumentPosition(zoom) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(panBeforeZoom).toBe(true);

  const panLeft = page.getByRole("button", { name: "Pan left" });
  await page.locator("#floor-list-toggle").focus();
  await tabToFocused(page, panLeft, 8);
  await expect(panLeft).toBeFocused();
  const outline = await panLeft.evaluate((el) => window.getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");

  const before = await worldTransform(page);
  const beforeTranslate = translatePortion(before);

  await page.keyboard.press("Enter");
  const afterLeft = await worldTransform(page);
  expect(afterLeft).not.toBe(before);
  const afterLeftTranslate = translatePortion(afterLeft);
  expect(afterLeftTranslate).not.toBe(beforeTranslate);
  await expect(panLeft).toBeFocused();
  await expect(page.locator(".scene.walking")).toHaveCount(0);

  const panRight = page.getByRole("button", { name: "Pan right" });
  await page.keyboard.press("Tab");
  await expect(panRight).toBeFocused();
  await page.keyboard.press("Enter");
  const afterRight = await worldTransform(page);
  expect(afterRight).toBe(before);

  const panUp = page.getByRole("button", { name: "Pan up" });
  await panUp.focus();
  await page.keyboard.press("Enter");
  const afterUp = await worldTransform(page);
  expect(afterUp).not.toBe(before);

  const resetBtn = page.locator('[data-act="floor-zoom"][data-dir="reset"]');
  await resetBtn.focus();
  await page.keyboard.press("Enter");
  const afterReset = await worldTransform(page);
  const resetTranslate = translatePortion(afterReset);
  expect(resetTranslate === "translate(0px,0px)" || resetTranslate === beforeTranslate).toBe(true);

  await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zoom out" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset view" })).toBeVisible();

  await expect(page.locator('[role="group"][aria-label="Zoom"]')).toHaveCount(1);
  await expect(page.locator('[role="group"][aria-label="Pan"] button')).toHaveCount(4);
});