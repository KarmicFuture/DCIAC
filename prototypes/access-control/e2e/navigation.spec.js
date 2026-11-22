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

async function settleView(page, hash, viewId) {
  await visit(page, hash);
  await expect.poll(() => page.evaluate(() => window.AccessDemo.state.view)).toBe(viewId);
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

const SUB_VIEWS = [
  ["#/rack", "rack", "Operate · Rack", "Operate views"],
  ["#/map", "map", "Operate · Port map", "Operate views"],
  ["#/control", "control", "Operate · Control", "Operate views"],
  ["#/sessions", "sessions", "Operate · Sessions", "Operate views"],
  ["#/oneline", "oneline", "Operate · One-line", "Operate views"],
  ["#/fleet", "fleet", "Operate · Fleet", "Operate views"],
  ["#/plan", "plan", "Plan · Campus", "Plan views"],
  ["#/halls", "halls", "Plan · Halls", "Plan views"],
  ["#/models", "models", "Plan · Models", "Plan views"],
  ["#/dcim", "dcim", "Plan · DCIM", "Plan views"],
];

test("sub-navigation names the current screen", async ({ page }) => {
  await signIn(page);
  for (const [hash, viewId, heading, navName] of SUB_VIEWS) {
    await settleView(page, hash, viewId);
    await expect(page.locator('.view-tabs [role="tab"]'), hash).toHaveCount(0);
    await expect(page.locator('.view-tabs [role="tablist"]'), hash).toHaveCount(0);
    await expect(page.locator('.view-tabs [aria-selected]'), hash).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: navName }), hash).toBeVisible();
    await expect(page.locator("nav [data-view]"), hash).toHaveCount(4);
    const current = page.locator('.view-tabs [aria-current="page"]');
    await expect(current, hash).toHaveCount(1);
    await expect(current, hash).toHaveAttribute("data-view", viewId);
    await expect(page.locator("h1"), hash).toHaveText(heading);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  for (const [hash, viewId, heading] of [["#/map", "map", "Operate · Port map"], ["#/dcim", "dcim", "Plan · DCIM"]]) {
    await settleView(page, hash, viewId);
    await expect(page.locator("h1"), hash).toHaveText(heading);
    await expect(page.locator(".topbar-view"), hash).toHaveText(heading);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await settleView(page, "#/map", "map");
  const currentChip = page.locator('.view-tabs [aria-current="page"]');
  await expect(currentChip).toHaveAttribute("data-view", "map");
  const selectedBg = await currentChip.evaluate((el) => getComputedStyle(el).backgroundColor);
  const plainBg = await page.locator('.view-tabs [data-view="rack"]').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(selectedBg).not.toBe(plainBg);

  const order = ["rack", "map", "control", "sessions", "oneline", "fleet"];
  await page.locator("h1").click();
  let seen = 0;
  for (let n = 0; n < 120 && seen < order.length; n += 1) {
    await page.keyboard.press("Tab");
    const view = await page.evaluate(() => document.activeElement?.getAttribute?.("data-view"));
    if (view === order[seen]) {
      const outline = await page.evaluate(() =>
        getComputedStyle(document.activeElement, ":focus-visible").outlineStyle);
      expect(outline, view).not.toBe("none");
      seen += 1;
    }
  }
  expect(seen).toBe(order.length);
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/fleet");
  await expect.poll(() => page.evaluate(() => window.AccessDemo.state.view)).toBe("fleet");
  await expect(page.locator("h1")).toHaveText("Operate · Fleet");
  await expect(page.locator('.view-tabs [aria-current="page"]')).toHaveAttribute("data-view", "fleet");

  await page.locator('.view-tabs [data-view="rack"]').focus();
  await page.keyboard.press("Space");
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#\/rack(?:\/|$)/);
  await expect(page.locator("h1")).toHaveText("Operate · Rack");
  await expect(page.locator('.view-tabs [aria-current="page"]')).toHaveAttribute("data-view", "rack");

  await page.evaluate(() => window.AccessDemo.state.sessions.push({
    id: "acceptance-session",
    deviceId: "tray-01",
    path: "acs",
    type: "kvm",
    medium: "",
    openedAt: Date.now(),
    lines: null,
    stage: "login",
    media: null,
    mediaChoice: "Ubuntu 24.04 ISO",
    screen: "os",
    keys: "",
    via: "",
  }));
  await settleView(page, "#/sessions", "sessions");
  await expect(page.locator("h1")).toHaveText("Operate · Sessions");
  await expect(page.locator('.view-tabs [data-view="sessions"]')).toHaveText(/^Sessions · \d+$/);

  for (const [hash, viewId, heading] of [["#/audit", "audit", "Audit"], ["#/simulate", "simulate", "Simulate"]]) {
    await settleView(page, hash, viewId);
    await expect(page.locator("h1"), hash).toHaveText(heading);
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
