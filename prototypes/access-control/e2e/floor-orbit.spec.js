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

function rotateXDeg(transform) {
  const match = transform.match(/rotateX\((-?\d+(?:\.\d+)?)deg\)/);
  return match ? Number(match[1]) : null;
}

function rotateZDeg(transform) {
  const match = transform.match(/rotateZ\((-?\d+(?:\.\d+)?)deg\)/);
  return match ? Number(match[1]) : null;
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

test("keyboard orbit buttons tilt and turn the floor camera", async ({ page }) => {
  await signInFloor(page);

  const orbitGroup = page.locator('[role="group"][aria-label="Orbit"]');
  await expect(orbitGroup).toHaveCount(1);
  const orbitBtns = page.locator('[data-act="floor-orbit"]');
  await expect(orbitBtns).toHaveCount(4);
  await expect(orbitBtns.nth(0)).toHaveAccessibleName("Orbit left");
  await expect(orbitBtns.nth(1)).toHaveAccessibleName("Orbit right");
  await expect(orbitBtns.nth(2)).toHaveAccessibleName("Orbit up");
  await expect(orbitBtns.nth(3)).toHaveAccessibleName("Orbit down");

  const panBeforeOrbitBeforeZoom = await page.evaluate(() => {
    const pan = document.querySelector('[role="group"][aria-label="Pan"]');
    const orbit = document.querySelector('[role="group"][aria-label="Orbit"]');
    const zoom = document.querySelector('[role="group"][aria-label="Zoom"]');
    const panBeforeOrbit = !!(pan.compareDocumentPosition(orbit) & Node.DOCUMENT_POSITION_FOLLOWING);
    const orbitBeforeZoom = !!(orbit.compareDocumentPosition(zoom) & Node.DOCUMENT_POSITION_FOLLOWING);
    return panBeforeOrbit && orbitBeforeZoom;
  });
  expect(panBeforeOrbitBeforeZoom).toBe(true);

  const panLeft = page.getByRole("button", { name: "Pan left" });
  await panLeft.focus();
  const orbitLeft = page.getByRole("button", { name: "Orbit left" });
  await tabToFocused(page, orbitLeft, 5);
  await expect(orbitLeft).toBeFocused();
  const outline = await orbitLeft.evaluate((el) => window.getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");

  const before = await worldTransform(page);
  expect(rotateZDeg(before)).toBe(-40);
  const beforeTranslate = translatePortion(before);
  const beforeRotateX = rotateXDeg(before);

  await page.keyboard.press("Enter");
  const afterLeft = await worldTransform(page);
  expect(rotateZDeg(afterLeft)).toBe(-48);
  expect(translatePortion(afterLeft)).toBe(beforeTranslate);
  expect(rotateXDeg(afterLeft)).toBe(beforeRotateX);
  await expect(orbitLeft).toBeFocused();
  await expect(page.locator(".scene.walking")).toHaveCount(0);

  const orbitRight = page.getByRole("button", { name: "Orbit right" });
  await orbitRight.focus();
  await page.keyboard.press("Enter");
  const afterRight = await worldTransform(page);
  expect(rotateZDeg(afterRight)).toBe(-40);

  const orbitUp = page.getByRole("button", { name: "Orbit up" });
  await orbitUp.focus();
  await page.keyboard.press("Enter");
  const afterUp = await worldTransform(page);
  expect(afterUp).toContain("rotateX(60deg)");
  expect(rotateXDeg(afterUp)).toBeGreaterThanOrEqual(16);
  expect(rotateXDeg(afterUp)).toBeLessThanOrEqual(84);

  const orbitDown = page.getByRole("button", { name: "Orbit down" });
  await orbitDown.focus();
  await page.keyboard.press("Enter");
  const afterDown = await worldTransform(page);
  expect(afterDown).toContain("rotateX(56deg)");
  expect(rotateXDeg(afterDown)).toBeGreaterThanOrEqual(16);
  expect(rotateXDeg(afterDown)).toBeLessThanOrEqual(84);

  await orbitLeft.focus();
  await page.keyboard.press("Enter");

  const resetBtn = page.locator('[data-act="floor-zoom"][data-dir="reset"]');
  await resetBtn.focus();
  await page.keyboard.press("Enter");
  const afterReset = await worldTransform(page);
  expect(afterReset).toContain("rotateX(56deg)");
  expect(afterReset).toContain("rotateZ(-40deg)");

  await expect(page.locator('[role="group"][aria-label="Zoom"]')).toHaveCount(1);
  await expect(page.locator('[role="group"][aria-label="Pan"]')).toHaveCount(1);
  await expect(page.locator('[role="group"][aria-label="Orbit"] button')).toHaveCount(4);
});