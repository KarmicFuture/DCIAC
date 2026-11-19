const { test, expect } = require("@playwright/test");

async function signIn(page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("dciac.world"));
  await page.goto("/");
  await page.locator('[data-act="login"][data-user="dsvs.operator"]').click();
  await expect(page.locator(".shell")).toBeVisible();
}

async function visit(page, hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
}

async function settle(page, hash) {
  await visit(page, hash);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(hash);
}

test("broken links land on the nearest real page and say why", async ({ page }) => {
  const failed = [];
  page.on("response", (r) => { if (r.status() === 404 && r.url().indexOf("/api/") >= 0) failed.push(r.url()); });
  await signIn(page);

  const cases = [
    ["#/bogus", "#/floor", "no page at #/bogus"],
    ["#/floor/nopod", "#/floor/hall", "no hall called nopod"],
    ["#/floor/pod-a/NORACK", "#/floor/pod-a", "Rack NORACK is not in"],
    ["#/floor/pod-a/A14/ghost", "#/floor/pod-a/A14", "no device ghost in rack A14"],
    ["#/sessions/nope", "#/sessions", "session is closed"],
    ["#/rack/A14/ghost", "#/rack/A14/tray-01", "no device ghost in rack A14"],
  ];
  for (const [from, to, says] of cases) {
    await settle(page, "#/floor");
    await visit(page, from);
    await expect.poll(() => page.evaluate(() => location.hash), { message: from }).toBe(to);
    await expect.poll(() => page.evaluate(() => window.AccessDemo.state.toast), { message: from }).toContain(says);
  }
  expect(failed, "no API lookups for racks that do not exist").toEqual([]);

  // A good link afterwards clears the note.
  await visit(page, "#/floor/pod-a/A14");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/floor/pod-a/A14");
  await expect.poll(() => page.evaluate(() => window.AccessDemo.state.toast)).toBe("");
});

test("every page marks where you are in the navigation", async ({ page }) => {
  await signIn(page);
  const expectations = [
    ["#/floor", "Floor"],
    ["#/manage/bmc/tray-01", "Floor"],
    ["#/control", "Operate"],
    ["#/dcim", "Plan"],
    ["#/audit", "Audit"],
    ["#/simulate", "Simulate"],
  ];
  for (const [hash, label] of expectations) {
    await visit(page, hash);
    await expect(page.locator('.rail [aria-current="page"]'), hash).toHaveText(label);
  }
});

test("a re-render right after a link click does not undo the navigation", async ({ page }) => {
  await signIn(page);
  await settle(page, "#/control");
  // Change the URL, then trigger a render before the hashchange event is handled.
  await page.evaluate(() => {
    location.hash = "#/audit";
    document.querySelector('.rail [data-act="theme"]').click();
  });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/audit");
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "audit");
  await page.evaluate(() => document.querySelector('.rail [data-act="theme"]').click());
});
