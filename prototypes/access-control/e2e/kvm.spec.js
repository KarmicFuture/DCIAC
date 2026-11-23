const { test, expect } = require("@playwright/test");

async function signIn(page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("dciac.world"));
  await page.goto("/");
  await page.locator('[data-act="login"][data-user="dsvs.operator"]').click();
  await expect(page.locator(".shell")).toBeVisible();
}

async function settleView(page, hash, viewId) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await expect.poll(() => page.evaluate(() => window.AccessDemo.state.view)).toBe(viewId);
}

function baseKvm(id, deviceId, extra) {
  return {
    id,
    deviceId,
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
    ...extra,
  };
}

async function openSessions(page, sessions) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.evaluate((list) => { window.AccessDemo.state.sessions = list; }, sessions);
  await settleView(page, "#/sessions", "sessions");
}

async function deviceName(page, sessionId) {
  return page.locator('[data-session-pane="' + sessionId + '"] .session-head h3 + p').innerText();
}

async function rerender(page) {
  await page.evaluate(() => document.querySelector('.rail [data-act="theme"]').click());
}

test("KVM console naming, description, and toggle group", async ({ page }) => {
  await openSessions(page, [
    baseKvm("kvm-a", "tray-01"),
    baseKvm("kvm-b", "tray-02", { rdpFailover: true }),
  ]);
  const nameA = await deviceName(page, "kvm-a");
  const nameB = await deviceName(page, "kvm-b");
  const cardA = page.locator('[data-session-pane="kvm-a"]');
  const consoleA = page.locator("#kvm-kvm-a");
  const consoleB = page.locator("#kvm-kvm-b");

  await expect(consoleA).toHaveAttribute("role", "application");
  await expect(consoleA).toHaveAccessibleName("KVM console for " + nameA + ", OS screen");

  const groupA = cardA.getByRole("group", { name: "Console screen for " + nameA });
  await expect(groupA).toHaveAttribute("role", "group");
  await expect(groupA.getByRole("button", { name: "BIOS" })).toHaveCount(1);
  await expect(
    page.getByRole("group", { name: "Console screen for " + nameA }).getByRole("button", { name: "BIOS" })
  ).toHaveCount(1);
  await groupA.getByRole("button", { name: "BIOS" }).click();
  await expect(consoleA).toHaveAccessibleName("KVM console for " + nameA + ", BIOS screen");

  await expect(consoleB).toHaveAttribute("role", "application");
  await expect(consoleB).toHaveAccessibleName("KVM failover console for " + nameB + ", OS screen");

  const descPattern = new RegExp(
    "^Click the console or Tab to it, then type\\. Keys go to " + nameA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
    "\\. Tab leaves the console\\..*Typed: nothing yet$"
  );
  await groupA.getByRole("button", { name: "OS", exact: true }).click();
  await expect(consoleA).toHaveAccessibleName("KVM console for " + nameA + ", OS screen");
  await expect(consoleA).toHaveAccessibleDescription(descPattern);

  await expect(cardA.locator("#kvm-keys-kvm-a")).toHaveText("Typed: nothing yet");
  const bareTyped = await page.evaluate(() =>
    [...document.querySelectorAll(".session.kvm .keys")].some((el) => {
      const span = el.querySelector("[data-keys]");
      const label = el.textContent.replace(span ? span.textContent : "", "").trim();
      return label === "Typed" && span && !span.textContent.trim();
    })
  );
  expect(bareTyped).toBe(false);
});

test("KVM console keyboard path, echo, and focus ring", async ({ page }) => {
  await openSessions(page, [
    baseKvm("kvm-a", "tray-01"),
    baseKvm("kvm-b", "tray-02", { rdpFailover: true }),
  ]);
  const nameA = await deviceName(page, "kvm-a");
  const cardA = page.locator('[data-session-pane="kvm-a"]');
  const groupA = cardA.getByRole("group", { name: "Console screen for " + nameA });
  const consoleA = page.locator("#kvm-kvm-a");
  const consoleB = page.locator("#kvm-kvm-b");

  await groupA.getByRole("button", { name: "OS", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(consoleA).toBeFocused();
  const ringA = await consoleA.evaluate((el) => {
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) || 0 };
  });
  expect(ringA.style).not.toBe("none");
  expect(ringA.width).toBeGreaterThanOrEqual(2);

  await page.keyboard.type("ls");
  await page.keyboard.press("Enter");
  await expect(consoleA.locator("[data-keys]")).toHaveText("ls↵");
  expect(await page.evaluate(() => window.AccessDemo.state.sessions.find((s) => s.id === "kvm-a").keys)).toBe("ls↵");
  await expect(consoleA).toHaveAccessibleDescription(/Typed: ls↵$/);

  await page.evaluate(() => { window.AccessDemo.state.sessions.find((s) => s.id === "kvm-a").keys = ""; });
  await rerender(page);

  await groupA.getByRole("button", { name: "OS", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(consoleA).toBeFocused();
  await page.keyboard.type("a");
  await expect(consoleA.locator("[data-keys]")).toHaveText("a");
  await expect(consoleA).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.locator("#media-kvm-a")).toBeFocused();
  await expect(consoleA.locator("[data-keys]")).toHaveText("a");

  await page.keyboard.press("Shift+Tab");
  await expect(consoleA).toBeFocused();

  const cardB = page.locator('[data-session-pane="kvm-b"]');
  await cardB.getByRole("button", { name: "OS", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(consoleB).toBeFocused();
  const ringB = await consoleB.evaluate((el) => {
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) || 0 };
  });
  expect(ringB.style).not.toBe("none");
  expect(ringB.width).toBeGreaterThanOrEqual(2);
});

test("KVM pointer input and blocked RM1048 session", async ({ page }) => {
  await openSessions(page, [baseKvm("kvm-a", "tray-01")]);
  const consoleA = page.locator("#kvm-kvm-a");
  await consoleA.click();
  await expect(consoleA).toBeFocused();
  await page.keyboard.type("x");
  await expect(consoleA.locator("[data-keys]")).toHaveText("x");
  await page.keyboard.press("Control+a");
  await expect(consoleA.locator("[data-keys]")).toHaveText("x");

  await page.evaluate(() => {
    window.AccessDemo.state.sessions.push({
      id: "kvm-c",
      deviceId: "tray-01",
      path: "rm1048",
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
    });
    window.AccessDemo.state.rm1048 = "dark";
  });
  await rerender(page);

  const cardC = page.locator('[data-session-pane="kvm-c"]');
  await expect(cardC.locator(".fail")).toBeVisible();
  await expect(cardC.getByRole("button", { name: "Open on ACS" })).toBeVisible();
  await expect(cardC.locator('[role="application"]')).toHaveCount(0);
});