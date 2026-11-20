const { test, expect } = require("@playwright/test");

async function signIn(page) {
  await page.goto("/");
  await page.locator('[data-user="dsvs.operator"]').click();
  await expect(page.locator(".who strong")).toHaveText("dsvs.operator");
}

const angles = (page) => page.evaluate(() => ({ view: window.AccessDemo.state.rackView, yaw: window.AccessDemo.state.rackYaw, pitch: window.AccessDemo.state.rackPitch }));

async function dragStage(page, scope, dx, dy) {
  const stage = page.locator(scope + " .r3-stage");
  await expect(stage).toBeVisible();
  const box = await stage.evaluate((el) => {
    el.scrollIntoView({ block: "nearest" });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
  // Start in an empty corner of the stage, away from the rack itself.
  const x = box.x + 16;
  const y = box.y + 16;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

test("Operate › Rack rotates freely by drag and by keyboard", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await signIn(page);
  await page.locator('.rail [data-act="nav"][data-view="rack"]').click();
  await expect(page.locator(".rack3d-panel .r3-pdu")).toHaveCount(2);

  await dragStage(page, ".rack3d-panel", 120, -40);
  const after = await angles(page);
  expect(after.view).toBe("custom");
  expect(after.yaw).toBeGreaterThan(-42 + 40);
  expect(after.pitch).toBeGreaterThan(-14);
  await expect(page.locator(".rack3d-panel .r3-world")).toHaveAttribute("style", new RegExp("rotateY\\(" + after.yaw));
  await expect(page.locator('.rack3d-panel [data-act="rack-view"][aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator(".shell")).toHaveAttribute("data-view", "rack");

  // Arrow keys turn it in 15° steps; a preset snaps back.
  await page.locator(".rack3d-panel .r3-stage").focus();
  await page.keyboard.press("ArrowRight");
  expect((await angles(page)).yaw).toBe(after.yaw + 15);
  await page.keyboard.press("ArrowRight");
  expect((await angles(page)).yaw).toBe(after.yaw + 30);
  await page.locator('.rack3d-panel [data-act="rack-view"][data-rack-view="front"]').click();
  expect(await angles(page)).toEqual({ view: "front", yaw: -24, pitch: -8 });

  // Pitch is kept between looking down from above and slightly from below.
  await dragStage(page, ".rack3d-panel", 0, 900);
  expect((await angles(page)).pitch).toBeGreaterThanOrEqual(-60);
  expect(errors).toEqual([]);
});

test("the floor rack rotates without moving the floor camera, and a drag does not open a device", async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => { location.hash = "#/floor/hall"; });
  await page.evaluate(() => document.querySelector('.rackbox[data-act="floor-rack"][data-rack="A14"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await expect(page.locator(".rack-scene .r3-pdu")).toHaveCount(2);
  const camera = await page.evaluate(() => ({ yaw: window.AccessDemo.state.floor.yaw, pitch: window.AccessDemo.state.floor.pitch }));

  await dragStage(page, ".rack-scene", -150, 30);
  expect((await angles(page)).view).toBe("custom");
  expect(await page.evaluate(() => ({ yaw: window.AccessDemo.state.floor.yaw, pitch: window.AccessDemo.state.floor.pitch }))).toEqual(camera);
  expect(await page.evaluate(() => window.AccessDemo.state.floor.level)).toBe("rack");

  // Start a drag on a device bezel: it turns the rack, and does not open the device.
  await page.locator('.rack-scene [data-act="rack-view"][data-rack-view="front"]').click();
  await page.waitForTimeout(600);
  const bezel = await page.locator('.rack-scene .r3-bezel[data-server="tray-01"]').boundingBox();
  await page.mouse.move(bezel.x + bezel.width / 2, bezel.y + bezel.height / 2);
  await page.mouse.down();
  await page.mouse.move(bezel.x + bezel.width / 2 + 90, bezel.y + bezel.height / 2, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.AccessDemo.state.floor.level)).toBe("rack");

  // The angle carries over: Operate › Rack shows the rack turned the same way.
  const turned = await angles(page);
  await page.locator('.rail [data-act="nav"][data-view="rack"]').click();
  await expect(page.locator(".rack3d-panel .r3-world")).toHaveAttribute("style", new RegExp("rotateY\\(" + turned.yaw));
});
