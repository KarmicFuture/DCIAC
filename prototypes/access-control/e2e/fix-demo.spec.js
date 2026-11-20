const { test, expect } = require("@playwright/test");

async function fresh(page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await page.waitForFunction(() => window.AccessDemo && typeof window.AccessDemo.startFixDemo === "function");
}

const caption = (page) => page.locator("#demo-caption");
const next = (page) => page.evaluate(() => window.AccessDemo.advanceDemo());

test("AI fix demo: alarm, serial session, AI diagnosis, automatic fix, verified", async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => {
    window.AccessDemo.setDemoPauseMs(60000);
    window.AccessDemo.setFixLineMs(0);
  });
  await page.locator('.login-wrap [data-act="demo-fix"]').click();
  await expect(page.locator(".demo-tour")).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".shell")).toHaveAttribute("data-demo", "fix");
  await expect(page.locator(".demo-kicker")).toContainText("AI fix demo · 1 of 11");
  await expect(caption(page)).toContainText("acs.watch logs in");

  // 2-3: the tray reboots; its device view shows no OS in band, and acs.watch raises a P1.
  await next(page);
  await expect(page.locator('.device-view tr[data-path="ssh"]')).toContainText("No OS running");
  await expect(page.locator('.device-view tr.best[data-band="oob"]')).toHaveAttribute("data-path", "acs-serial");
  await next(page);
  await expect(caption(page)).toContainText("raises a P1");
  const alarmRow = page.locator('summary[data-alarm="watch-tray-05"]');
  await expect(alarmRow).toBeVisible();
  await expect(alarmRow).toContainText("UEFI shell");

  // 4-5: the alarm launches an ACS serial session that shows the stuck boot.
  await next(page);
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "sessions");
  await expect(page.locator(".session .term-path")).toContainText("ttyS7");
  const lines = () => page.evaluate(() => window.AccessDemo.state.sessions[0].lines.join("\n"));
  expect(await lines()).toContain("No bootable option succeeded");
  await next(page);

  // 6-7: read-only check, then the diagnosis.
  await next(page);
  await next(page);
  expect(await lines()).toContain("bcfg boot dump -s");
  await expect(page.locator(".session .explain")).toContainText("Boot0003");
  await expect(page.locator(".session .explain")).toContainText("93%");

  // 8-9: the runbook runs, the tray boots Ubuntu, and the alarm clears.
  await next(page);
  expect(await lines()).toContain("bcfg boot mv 02 00");
  expect(await lines()).toContain("Reached target multi-user.target");
  await next(page);
  await expect(caption(page)).toContainText("P1 clears");
  await expect(page.locator('summary[data-alarm="watch-tray-05"]')).toHaveCount(0);
  await expect(page.locator(".session .explain")).toContainText("97%");

  // 10: the audit names who did each step.
  await next(page);
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "audit");
  const audit = page.locator(".view");
  for (const text of ["session launched from alarm", "read-only check", "diagnosis", "runbook RB-UEFI-01 run (pre-approved)", "fix verified"]) {
    await expect(audit).toContainText(text);
  }

  // 11 and stop: everything is put back.
  await next(page);
  await next(page);
  await expect(page.locator(".demo-tour")).toHaveCount(0);
  const after = await page.evaluate(() => ({
    sessions: window.AccessDemo.state.sessions.length,
    stuck: window.AccessDemo.devices.find((d) => d.id === "tray-05").bootStuck,
  }));
  expect(after).toEqual({ sessions: 0, stuck: false });
});

test("an operator can run the same fix from the Explain panel; read only cannot", async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => window.AccessDemo.setFixLineMs(0));
  await page.locator('[data-act="login"][data-user="dsvs.operator"]').click();
  await expect(page.locator(".shell")).toBeVisible();
  await page.evaluate(() => { window.AccessDemo.breakBoot("tray-05"); location.hash = "#/rack/A14/tray-05"; });

  // Open serial from the alarm. No work order is needed: the P1 is the reason.
  await page.locator(".alarm-banner > summary").click();
  await page.locator('details.alarm-row:has(summary[data-alarm="watch-tray-05"]) [data-act="alarm-go"]').click();
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "sessions");

  const run = page.locator('.session .explain [data-act="explain-run"]');
  await expect(run).toHaveText("Read the boot order (read-only)");
  await run.click();
  await expect(run).toContainText("Run RB-UEFI-01");
  await run.click();
  await expect(page.locator(".session .explain")).toContainText("booted Ubuntu");
  await expect(page.locator('summary[data-alarm="watch-tray-05"]')).toHaveCount(0);

  await page.evaluate(() => { location.hash = "#/audit"; });
  await expect(page.locator(".view")).toContainText("runbook RB-UEFI-01 run");
  await expect(page.locator(".view")).toContainText("dsvs.operator");

  // Read only sees the diagnosis but cannot send commands.
  await page.evaluate(() => document.querySelector('[data-act="signout"]').click());
  await page.locator('[data-act="login"][data-user="colo.readonly"]').click();
  await expect(page.locator(".shell")).toBeVisible();
  await page.evaluate(() => { window.AccessDemo.breakBoot("tray-05"); window.AccessDemo.state.sessions = []; });
  await page.evaluate(() => { location.hash = "#/rack/A14/tray-05"; });
  await page.locator(".alarm-banner > summary").click();
  await page.locator('details.alarm-row:has(summary[data-alarm="watch-tray-05"]) [data-act="alarm-go"]').click();
  await expect(page.locator(".session .explain [data-act=explain-run]")).toBeDisabled();
  await expect(page.locator(".session .explain [data-act=explain-run]")).toContainText("requires Operator");
});
