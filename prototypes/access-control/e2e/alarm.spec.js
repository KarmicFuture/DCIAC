const { test, expect } = require("@playwright/test");

async function signInFloorHall(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();
  const chip = page.locator(".alarm-chip");
  await expect(chip).toHaveText(/P1 · \d+/);
  return chip;
}

test("alarm chip focuses the rack and the action leaves the floor", async ({ page }) => {
  const chip = await signInFloorHall(page);
  await expect(page.locator(".alarm-list")).toBeHidden();
  await chip.click();
  const row = page.locator(".alarm-row").first();
  const summary = row.locator('summary[data-act="alarm-focus"]');
  await expect(summary).toBeVisible();
  await expect(summary.locator("b")).toBeVisible();
  await expect(summary.locator(".alarm-line")).toBeVisible();
  await expect(row.locator(':scope > [data-act="alarm-go"]')).toBeVisible();
  await expect(row.locator('[data-act="alarm-ack"]')).toBeHidden();

  const before = await page.locator(".world").evaluate((el) => el.style.transform);
  await summary.locator("b").click();
  await expect(page.locator(".hud-mission")).toContainText("Hall 1");
  await expect(page.locator(".rackbox.is-pulse")).toHaveCount(1);
  await expect(row.locator("details.alarm-fold[open] [data-act='alarm-ack']")).toBeVisible();
  await expect.poll(async () => page.locator(".world").evaluate((el) => el.style.transform)).not.toBe(before);

  await row.locator(':scope > [data-act="alarm-go"]').click();
  await expect(page.locator("h1")).toHaveText("Operate · Sessions");
  await expect(page.locator('.view-tabs [data-view="sessions"]')).toHaveAttribute("aria-current", "page");
});

test("each alarm shows how long it has been open and escalates past its ack target", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  await page.locator('[data-user="dsvs.operator"]').click();

  const chip = page.locator(".alarm-chip");
  await expect(chip).toHaveText(/P1 · \d+$/);
  await chip.click();
  // tray-06 (BMC dark) and tray-07 (login rejected) are P1s that stay put while the world runs.
  const row = (id) => page.locator('div.alarm-row:has(summary[data-alarm="watch-' + id + '"])');
  const late = row("tray-07");
  const acked = row("tray-06");
  await expect(late).toHaveClass(/pri-1/);
  await expect(acked).toHaveClass(/pri-1/);
  await expect(late.locator(".alarm-clock")).toHaveText(/^Open \d+s · escalates in 4m$/);
  await expect(late).not.toHaveClass(/escalated/);

  // Ack tray-06 now; it keeps its open time but never escalates.
  await acked.locator("summary b").click();
  await expect(acked.locator(".alarm-target")).toContainText("P1 ack target 5 min, due ");
  await acked.locator('[data-act="alarm-ack"]').click();
  await expect(acked.locator(".alarm-clock")).toHaveText(/^Acked · open \d+s$/);

  // Past the 5-minute P1 target: the unacked row and the chip say it escalated.
  await page.clock.fastForward("06:00");
  await expect(late.locator(".alarm-clock")).toHaveText(/^Escalated · 1m past 5m$/);
  await expect(late.locator(".alarm-clock")).toHaveClass(/is-escalated/);
  await expect(late).toHaveClass(/escalated/);
  await expect(chip).toHaveText(/P1 · \d+ · \d+ escalated/);
  await expect(acked.locator(".alarm-clock")).toHaveText(/^Acked · open 6m$/);
  await expect(acked).not.toHaveClass(/escalated/);
});

test("alarm banner structure, naming, and layout", async ({ page }) => {
  const chip = await signInFloorHall(page);
  await chip.click();
  await expect(page.locator(".alarm-list")).toBeVisible();

  const chipText = await chip.innerText();
  const countMatch = chipText.match(/·\s*(\d+)/);
  const n = Number(countMatch[1]);

  await expect(page.locator(".alarm-list summary button")).toHaveCount(0);
  await expect(page.locator('.alarm-list summary [data-act="alarm-go"]')).toHaveCount(0);

  const rows = page.locator(".alarm-list > .alarm-row");
  await expect(rows).toHaveCount(n);
  const listItems = page.locator('.alarm-list > [role="listitem"]');
  await expect(listItems).toHaveCount(n);

  await expect(chip).not.toHaveAttribute("aria-label");
  await expect(chip).toHaveAccessibleName(/^Abnormal conditions: P1 · \d+$/);

  const firstRow = rows.first();
  const firstSummary = firstRow.locator('summary[data-act="alarm-focus"]');
  await expect(firstSummary).toHaveAccessibleName(/^Priority 1\. /);

  const rowCount = await rows.count();
  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    const summary = row.locator('summary[data-act="alarm-focus"]');
    const priClass = await row.evaluate((el) => {
      const m = el.className.match(/\bpri-(\d+)\b/);
      return m ? m[1] : null;
    });
    await expect(summary).toHaveAccessibleName(new RegExp("^Priority " + priClass + "\\. "));

    const go = row.locator(':scope > [data-act="alarm-go"]');
    if ((await go.count()) === 0) continue;
    const asset = await summary.locator("b").innerText();
    const visible = await go.innerText();
    await expect(go).toHaveAccessibleName(visible + " · " + asset);
    const accessibleName = await go.evaluate((el) => el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.innerText);
    expect(accessibleName.startsWith(visible)).toBeTruthy();
    await expect(page.getByRole("button", { name: visible + " · " + asset })).toHaveCount(1);
  }

  await firstSummary.click();
  const goBtn = firstRow.locator(':scope > [data-act="alarm-go"]');
  const summaryBox = await firstSummary.boundingBox();
  const goBox = await goBtn.boundingBox();
  const lineBox = await firstSummary.locator(".alarm-line").boundingBox();
  expect(Math.abs(goBox.y - summaryBox.y)).toBeLessThanOrEqual(8);
  expect(goBox.x).toBeGreaterThan(lineBox.x + lineBox.width - 1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(goBtn).toBeVisible();
});

test("alarm banner keyboard order and activation", async ({ page }) => {
  test.setTimeout(60000);
  const chip = await signInFloorHall(page);
  await chip.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".alarm-list")).toBeVisible();

  const rows = page.locator(".alarm-list > .alarm-row");
  const firstRow = rows.first();
  const firstSummary = firstRow.locator('summary[data-act="alarm-focus"]');
  const firstGo = firstRow.locator(':scope > [data-act="alarm-go"]');
  const secondRow = rows.nth(1);
  const secondSummary = secondRow.locator('summary[data-act="alarm-focus"]');
  const chipLocator = page.locator(".alarm-chip");

  const missionBefore = await page.locator(".hud-mission").innerText();

  await page.keyboard.press("Tab");
  await expect(firstSummary).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(firstGo).toBeFocused();

  for (const locator of [chipLocator, firstSummary, firstGo]) {
    await locator.focus();
    const outline = await locator.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
  }

  await page.keyboard.press("Tab");
  await expect(secondSummary).toBeFocused();
  await firstSummary.focus();
  await page.keyboard.press("Enter");
  await expect(firstRow.locator("details.alarm-fold")).toHaveAttribute("open", "");
  await expect(firstRow.locator('[data-act="alarm-ack"]')).toBeVisible();
  await expect(page.locator(".hud-mission")).toHaveText(missionBefore);
  await page.keyboard.press("Space");
  await expect(firstRow.locator("details.alarm-fold")).not.toHaveAttribute("open");

  const wasOpen = await firstRow.locator("details.alarm-fold").evaluate((el) => el.open);
  expect(wasOpen).toBe(false);
  const firstAlarmId = await firstGo.getAttribute("data-alarm");
  await firstGo.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("h1")).toHaveText("Operate · Sessions");
  await page.goto("/#/floor/hall", { waitUntil: "domcontentloaded" });
  await page.locator(".alarm-chip").click();
  const ackedRow = page.locator('.alarm-row:has(summary[data-alarm="' + firstAlarmId + '"])');
  await expect.poll(async () => ackedRow.getAttribute("class")).not.toMatch(/\bunacked\b/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.locator('[data-user="dsvs.operator"]').click();
  await page.locator(".alarm-chip").click();
  const freshFirst = page.locator(".alarm-list > .alarm-row").first();
  const freshGo = freshFirst.locator(':scope > [data-act="alarm-go"]');
  await freshGo.focus();
  await page.keyboard.press("Space");
  await expect(page.locator("h1")).toHaveText("Operate · Sessions");
});
