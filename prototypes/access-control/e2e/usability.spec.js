// Usability suite: 15 views x 5 screen sizes x 6 checks = 450 tests.
// Each (view, size) opens once; its six checks are separate tests so a failure
// names the view, the screen and the rule that broke.
//
// Rules:
//   heading   one <h1> naming the view, above the fold; the floor has no page heading by design,
//             so there the HUD must name where you are and the navigation must mark Floor
//   width     the page never scrolls sideways
//   errors    no console errors, page crashes, failed requests or API 5xx answers
//   names     every visible control has a name a screen reader can say
//   targets   controls are at least 24 x 24 px (WCAG 2.2, 2.5.8); KNOWN_SMALL lists today's debt
//   focus     Tab from the top lands on a visible control with a visible focus ring
const { test, expect } = require("@playwright/test");

const VIEWS = [
  ["#/floor", "Floor"],
  ["#/floor/pod-a/A14", "Floor"],
  ["#/manage/bmc/tray-01", "Data center management"],
  ["#/rack", "Operate · Rack"],
  ["#/map", "Operate · Port map"],
  ["#/control", "Operate · Control"],
  ["#/sessions", "Operate · Sessions"],
  ["#/oneline", "Operate · One-line"],
  ["#/fleet", "Operate · Fleet"],
  ["#/plan", "Plan · Campus"],
  ["#/halls", "Plan · Halls"],
  ["#/models", "Plan · Models"],
  ["#/dcim", "Plan · DCIM"],
  ["#/audit", "Audit"],
  ["#/simulate", "Simulate"],
];

const SIZES = [
  ["desktop", 1440, 900],
  ["laptop", 1024, 768],
  ["tablet", 768, 1024],
  ["iPhone", 390, 844],
  ["small phone", 360, 740],
];

// Controls that are smaller than 24 px today. Each is UX debt to fix, not a rule
// change: a new small control anywhere else fails the targets check.
const KNOWN_SMALL = [
  ".r3-socket",   // outlet sockets drawn on the 3D rack PDU (also in Operate > Control's outlet table)
  ".linkish",     // text-style links inside detail panels
  ".gantt-bar",   // short build phases on the Plan > Halls Gantt chart
  ".sim-tick",    // event ticks on the Simulate timeline
  ".rackbox",     // racks and yard gear on the floor plan at tablet and phone width
  ".ol-node",     // one-line diagram boxes once the diagram is scaled down on phones
  ".ol-hall",     // hall taps on the one-line diagram on phones
  "[data-server^='batt-']", // battery hit areas on the one-line diagram on phones
  ".crumbs",      // floor breadcrumbs are 16 px tall; at 24 px they slide under the drawer's Pop out button
];

const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';

for (const [hash, heading] of VIEWS) {
  for (const [label, width, height] of SIZES) {
    test.describe(`${hash} on ${label} (${width}px)`, () => {
      let page;
      const problems = [];

      test.beforeAll(async ({ browser }) => {
        page = await browser.newPage({ viewport: { width, height } });
        page.on("console", (msg) => { if (msg.type() === "error") problems.push("console: " + msg.text()); });
        page.on("pageerror", (err) => problems.push("crash: " + err.message));
        page.on("requestfailed", (req) => {
          const why = (req.failure() || {}).errorText || "";
          if (req.url().includes("/api/") && !why.includes("ERR_ABORTED")) problems.push("request failed: " + req.url() + " " + why);
        });
        page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 500) problems.push("api " + r.status() + ": " + r.url()); });
        await page.goto("/");
        await page.locator('[data-act="login"][data-user="dsvs.operator"]').click();
        await expect(page.locator(".shell")).toBeVisible();
        await page.evaluate((h) => { location.hash = h; }, hash);
        if (heading === "Floor") await expect(page.locator(".shell")).toBeVisible();
        else await expect(page.locator("h1")).toHaveText(heading);
        await page.waitForLoadState("networkidle");
      });

      test.afterAll(async () => { await page.close(); });

      test("heading names the view and sits above the fold", async () => {
        if (heading === "Floor") {
          // Full-bleed 3D floor: no page heading (e2e/hall.spec.js keeps it that way).
          // Something on screen must say where you are: the HUD, the breadcrumbs, or the
          // phone top bar. Inside a rack it must name the rack.
          const place = hash.split("/")[3] || "";
          const said = await page.evaluate(() => [".hud-mission", ".crumbs", ".topbar-view"]
            .map((sel) => document.querySelector(sel))
            .filter((el) => el && (() => { const r = el.getBoundingClientRect(); return r.height > 0 && r.bottom > 0 && r.top < window.innerHeight; })())
            .map((el) => el.textContent.trim()).join(" | "));
          expect(said, "an on-screen label says where you are").not.toBe("");
          if (place) expect(said, "the on-screen label names the rack").toContain(place);
          await expect(page.locator('[aria-current="page"]').first()).toHaveText("Floor");
          return;
        }
        await expect(page.locator("h1")).toHaveCount(1);
        await expect(page.locator("h1")).toHaveText(heading);
        const box = () => page.evaluate(() => {
          const r = document.querySelector("h1").getBoundingClientRect();
          return r.height > 0 ? { top: Math.round(r.top), bottom: Math.round(r.bottom) } : null;
        });
        await expect.poll(box).not.toBeNull();
        expect((await box()).top).toBeGreaterThanOrEqual(0);
        expect((await box()).bottom).toBeLessThanOrEqual(height);
      });

      test("fits the screen width without sideways scrolling", async () => {
        const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        await expect.poll(overflow).toBeLessThanOrEqual(1);
      });

      test("loads without console errors or failed API calls", async () => {
        expect(problems).toEqual([]);
      });

      test("every visible control has an accessible name", async () => {
        const unnamed = await page.evaluate((sel) => {
          const shown = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
          const named = (el) => Boolean((el.getAttribute("aria-label") || "").trim() || el.getAttribute("aria-labelledby") ||
            (el.textContent || "").trim() || (el.getAttribute("title") || "").trim() || (el.labels && el.labels.length) ||
            (el.getAttribute("placeholder") || "").trim() || (el.tagName === "INPUT" && (el.value || "").trim()));
          return [...document.querySelectorAll(sel)].filter(shown).filter((el) => !named(el)).map((el) => el.outerHTML.slice(0, 120));
        }, INTERACTIVE);
        expect(unnamed).toEqual([]);
      });

      test("touch targets are at least 24 px", async () => {
        const small = await page.evaluate(({ sel, known }) => {
          const shown = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
          const inline = (el) => el.tagName === "A" && getComputedStyle(el).display === "inline"; // WCAG 2.5.8 inline exception
          return [...document.querySelectorAll(sel)].filter(shown)
            .filter((el) => !inline(el) && !known.some((k) => el.closest(k)))
            .filter((el) => { const r = el.getBoundingClientRect(); return r.width < 23.5 || r.height < 23.5; })
            .map((el) => el.outerHTML.slice(0, 100) + " " + Math.round(el.getBoundingClientRect().width) + "x" + Math.round(el.getBoundingClientRect().height));
        }, { sel: INTERACTIVE, known: KNOWN_SMALL });
        expect(small).toEqual([]);
      });

      test("keyboard focus is visible", async () => {
        await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); window.scrollTo(0, 0); });
        await page.keyboard.press("Tab");
        const focus = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return { moved: false };
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return {
            moved: true,
            onScreen: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight,
            ring: (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 1) || s.boxShadow !== "none",
          };
        });
        expect(focus).toEqual({ moved: true, onScreen: true, ring: true });
      });
    });
  }
}
