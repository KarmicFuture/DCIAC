# Plan · 2026-11-22 · Floor: Feeder A and Feeder B in the site list

Branch: `ux/2026-11-21-cycle`  
Backlog item: **rank 2** in `docs/ux-backlog.md`, sixth slice. The floor/site view depends on pointer picking and non-focusable or `aria-hidden` floor targets, so keyboard and assistive-tech users can't reliably open halls, racks, servers, or alarm targets (WCAG 2.1.1, 4.1.2). Severity 4, effort L. Already shipped: the keyboard **List** drawer (`docs/plans/2026-11-22-floor.md`), **Show on floor** on the Floor view (`docs/plans/2026-11-22-floor-alarm.md`), **Open Hall N overview** (`docs/plans/2026-11-22-floor-hall.md`), yard pipes in the list (`docs/plans/2026-11-22-floor-pipes.md`), and **Show on floor** from every signed-in screen (`docs/plans/2026-11-22-floor-jump.md`, commit `983ac38`).

## Why this slice

- **The two utility feeders are the only top-level site power paths a keyboard user can't open.** `siteFeedHtml()` (`src/views/floor.ts` lines 1357–1362) draws them as `feedHtml()` segments with `data-feed="grid-xfmr-a"` (`grid-1` to `xfmr-1`) and `data-feed="grid-xfmr-b"` (`grid-2` to `xfmr-2`). `feedHtml()` (lines 1247–1258) renders a `div.feed` with `aria-hidden="true"` and no `tabindex`. The site list (the `level === "site"` branch of `renderInspector()`, lines 1850–1854) lists Halls and Yard gear, including the pipes since the last slice, but no feeders.
- **The click path already exists.** `render.ts` line 487 handles `data-act="floor-feed"` with `openFeed(el.dataset.pod, el.dataset.feed)`. `openFeed()` (lines 874–883) sets `view = "floor"`, `inspectorOpen = true`, `feedId`, `level = "feed"`, and `podId = ""` when there's no `data-pod`, then renders. `renderFloor()` (line 1961) keeps the site scene when `level === "feed"` and there's no pod. `floorDetailOpen()` (line 1938) shows the drawer at feed level. So a list button needs no new action.
- **The feeder detail is generic today.** `feedPanel()` (lines 1761–1792) has a branch only for `id === "grid-xfmr"` (singular), which is never drawn. `grid-xfmr-a` and `grid-xfmr-b` fall through to "This segment is energized. The state is read from the gear on the path." and offer no next step. This slice gives them the utility-feeder copy and an **Open the grid** button, the same pattern as the existing `grid-xfmr` branch.
- **Focus already works.** `recordFloorDrawerFocus()` records `[data-act="floor-feed"][data-feed="grid-xfmr-a"]`. That button isn't in the feed drawer, so `restoreFloorDrawerFocus()` (`render.ts` lines 267–282) falls back to `#floor-detail`. Escape (`render.ts` lines 767–776) closes the drawer and returns focus to `#floor-list-toggle`. The `Outside` crumb calls `goFloor("site")`, which leaves `floorListOpen` as it is, so the user returns to the site list (as `floor-pipes.spec.js` already shows for pipes).
- **Estimate:** about 3 lines in the site list and about 5 in `feedPanel()`, plus about 100 lines in one new spec, roughly 110 lines in total.

## What remains of rank 2 after this slice

- Pod plates (`.pod[data-act="floor-pod"]`) and aisle bands (`.aisle[data-act="floor-server"]`) in the 3D world are still clickable `div`s that aren't focusable. The list routes reach the same content.
- All 3D `.feed` and `.pipe` segments stay `aria-hidden` and pointer-only. The other site feeds (`xfmr-mod-a/b`, `mod-c`, `mod-d`, `batt-a/b`, `mod-bus`, `mod-bus-b`, `mod-riser`, `feed-hall-*`) and the hall feeds (`bus-*`, `whip-*`) aren't in the site list. Bus and whip feeds are reachable from rack and aisle drawers.
- The Grid entity's drawer (`serverInspector`, line 1670) still has an **Open the feeder** button pointing at `data-feed="grid-xfmr"`, which isn't drawn, so it opens the singular `grid-xfmr` copy rather than Feeder A or B.
- `.rackbox` Tab order follows DOM order, the camera doesn't follow focus, a focused box can be off-stage, and there are 20 or more tab stops before the drawer.
- Pan, orbit, and drag-to-place are pointer-only. A new library item can only be placed by dragging.
- Returning focus to the alarm row after the drawer is closed.
- The `alarm-focus` summary still moves the camera without announcing anything to assistive tech.
- Focus is still lost on re-render everywhere outside the floor drawer.
- After a list item opens, focus lands on the drawer itself, not on its heading. This matches the existing fallback.
- Nobody has done a live screen-reader pass (VoiceOver, NVDA) of the floor.

## Problem (today, from the code)

1. **The feeders can't be reached from the keyboard.** With the List open at `#/floor`, the drawer has `Ten halls`, `Halls`, and `Yard` (gear and pipes). Nothing opens `grid-xfmr-a` or `grid-xfmr-b`. The only route is clicking a thin `aria-hidden` cable in the 3D yard.
2. **Even with a mouse, the feeder detail says nothing useful.** It shows `Energized` and the generic segment sentence. It doesn't say it's the utility feeder or where it runs, and it has no route to the grid gear.

## User story

As a keyboard or screen-reader operator with the floor List open on the site, I want **Feeder A** and **Feeder B** buttons under a **Feeders** heading. Each should open a detail that tells me it's the utility feeder, where it runs, and whether it's energized, with an **Open the grid** button, and keep focus in the drawer, without a mouse or the 3D scene.

## Change (for the builder)

Escape every interpolated value with `esc()`. Don't change `feedHtml()`, `siteFeedHtml()`, `openFeed()`, `render.ts`, or pointer behavior.

1. **Feeders section** (`renderInspector()`, the `level === "site"` branch, `src/views/floor.ts` lines 1853–1854). Append after the Yard `rowButton` join, so Halls and Yard keep their order and the existing Yard assertions (which stop at the next `h3`) stay valid:
   ```ts
   '<h3>Yard</h3>' +
     infra.filter((item) => item.yard).map(rowButton).join("") +
     '<h3>Feeders</h3>' +
     '<button type="button" class="floor-row" data-act="floor-feed" data-feed="grid-xfmr-a">Feeder A</button>' +
     '<button type="button" class="floor-row" data-act="floor-feed" data-feed="grid-xfmr-b">Feeder B</button>';
   ```
   The resulting markup:
   ```html
   <h3>Feeders</h3>
   <button type="button" class="floor-row" data-act="floor-feed" data-feed="grid-xfmr-a">Feeder A</button>
   <button type="button" class="floor-row" data-act="floor-feed" data-feed="grid-xfmr-b">Feeder B</button>
   ```
   No `data-pod`: these are site-level feeds. No status percentage or LED: they aren't `rowButton()` entities. The text is literal, so there's nothing to escape. Don't add these to `drillEl()`. The drawer isn't inside `.world`.
2. **Feeder copy** (`feedPanel()`, after the `grid-xfmr` branch at lines 1776–1778). Add:
   ```ts
   } else if (id === "grid-xfmr-a" || id === "grid-xfmr-b") {
     const side = id === "grid-xfmr-a" ? "A" : "B";
     copy = "Feeder " + side + ". Utility feeder from the grid gantry to MV transformer " + side + ". " + copy + " The conductor stays in the yard.";
     next = '<button type="button" class="act" data-act="floor-server" data-server="' + (side === "A" ? "grid-1" : "grid-2") + '">Open the grid</button>';
   ```
   `copy` already starts as "This segment is energized. …" from `energWord(feedMode(id))`, and `feedMode()` returns `"live"` for these ids, so the h2 is **Energized**. The final `return` already wraps `copy` in `esc()`. The `data-server` value is one of two literals. The visible text **Open the grid** is the accessible name, the same as the existing `grid-xfmr` branch. Leave the `grid-xfmr` branch as it is.
3. **No focus code, no CSS.** `.floor-row` and `.act` already have the drawer's `:focus-visible` ring from the first slice.

Loading feedback: `openFeed()` is a synchronous local render, so there's no wait over 300 ms. Empty state: the two feeders are always drawn in `siteFeedHtml()`, so the section is never empty.

## Acceptance criteria

All criteria are checked in one new spec, `e2e/floor-feeds.spec.js`. Setup, following `floor-list.spec.js`: use a 1440×900 viewport, go to `/#/floor`, sign in as `dsvs.operator`, and wait until `#app` doesn't contain "Loading the asset repository". Open the List by focusing `#floor-list-toggle` and pressing Enter. The drawer `#floor-detail` is visible and focused, with heading `Ten halls`. Steps marked "keyboard" use `page.keyboard`.

1. **The buttons are in the site list, after Yard.**
   - `#floor-detail [data-act="floor-feed"]` has count 2: `data-feed="grid-xfmr-a"` and `data-feed="grid-xfmr-b"`, in that order.
   - Each is a `<button>` with `type="button"`, class `floor-row`, no `data-pod` attribute, and accessible names exactly `Feeder A` and `Feeder B`.
   - There is an h3 `Feeders`. In DOM order: `Halls` h3, then `Yard` h3, then all Yard `floor-server` buttons (including `pipe-sup` and `pipe-ret`), then the `Feeders` h3, then both feeder buttons. Walking siblings from the `Yard` h3 to the next h3 finds no `floor-feed` button.
2. **They're only on the site list.** At `/#/floor/hall` with the List open, `[data-act="floor-feed"][data-feed^="grid-xfmr"]` inside `#floor-detail` has count 0.
3. **Reach it by keyboard.** Press Tab (keyboard), at most the drawer's button count + 2 times, until the `Feeder A` button is `document.activeElement`. Its computed `outline-style` is not `none`.
4. **Enter opens the feeder detail.** Press Enter (keyboard). Then:
   - `#floor-detail` is visible, and `.inspector` has count 1.
   - The drawer has an h2 `Energized` (the output of `energWord("live")`).
   - The drawer contains the text `Feeder A. Utility feeder from the grid gantry to MV transformer A.` and `The conductor stays in the yard.`
   - The drawer has a button with accessible name `Open the grid`, `data-act="floor-server"`, and `data-server="grid-1"`.
   - `.crumbs` contains `[data-act="floor-go"][data-level="site"]` and the text `Feed`, and no `[data-level="hall"]` crumb.
   - Using `expect.poll` (about 1 s), `document.activeElement` is `#floor-detail` or inside it.
   - `#floor-list-toggle` has `aria-expanded="true"`.
5. **It doesn't start the walk-through.** `.scene.walking` has count 0, `.walk-bar` has count 0, and `#floor-list-toggle` is still present.
6. **The 3D feeds stay hidden.** Every `.world .feed` has `aria-hidden="true"` and no `tabindex`. The count is > 0, and `.world .feed[data-feed="grid-xfmr-a"]` has count ≥ 1.
7. **Open the grid works.** Tab (keyboard) to `Open the grid` and press Enter. The drawer h2 matches `/Feeder A/`, and focus is in the drawer.
8. **Escape closes it and returns focus to the List button.** Reopen Feeder A from the List, then press Escape (keyboard). `.inspector` has count 0, `#floor-list-toggle` has `aria-expanded="false"`, and `#floor-list-toggle` is `document.activeElement`.
9. **The other feeder works too.** Reopen the List, Tab to `Feeder B`, and press Enter. The h2 is `Energized`, the text contains `Feeder B. Utility feeder from the grid gantry to MV transformer B.`, and `Open the grid` has `data-server="grid-2"`. Focus is in the drawer.
10. **Existing specs still pass unchanged:** `floor-list.spec.js` and `floor-pipes.spec.js` (their Yard assertions stop at the next h3), plus `floor-hall.spec.js`, `floor-alarm.spec.js`, `floor-alarm-jump.spec.js`, `floor-drag.spec.js`, `floor-rack3d.spec.js`, `stage.spec.js`, and `hall.spec.js`.
11. **The whole suite passes:** `npm test` in `prototypes/access-control` (`pretest` runs `vite build`), with no skipped or removed tests. The total diff is under about 150 lines.

## Files to touch

| file | change | est. lines |
|---|---|---:|
| `prototypes/access-control/src/views/floor.ts` | Feeders section in the site branch of `renderInspector()`; `grid-xfmr-a`/`-b` branch in `feedPanel()` | ~8 |
| `prototypes/access-control/e2e/floor-feeds.spec.js` | new spec for the criteria above | ~100 |

That is about 110 lines in total. Don't touch `render.ts`, `styles.css`, `state.ts`, `types.ts`, `CHANGELOG`, or other specs, and don't touch `dcim-hall-board`.

## Out of scope

- **The rest of rank 2** (see "What remains of rank 2 after this slice"): focusable pod plates, aisle bands, feeds, and pipes in the 3D world; listing the other site and hall feeds; `.rackbox` Tab order and camera follow; keyboard pan, orbit, and placement; returning focus to the alarm row; announcing the summary's camera move; general focus retention; a live screen-reader pass.
- **Fixing the Grid drawer's `Open the feeder` button** (`data-feed="grid-xfmr"`, line 1670) or removing the singular `grid-xfmr` branch in `feedPanel()`.
- **Reflecting a simulated feeder failure in the feeder detail.** `feedMode()` returns `"live"` for these ids, so the h2 stays `Energized` even during a power-fail simulation. That's existing behavior.
- **Status, LED, or load on the feeder rows**, a route for the feeder detail (for example `#/floor/feed/grid-xfmr-a`), or changing `openFeed()`, `feedHtml()`, or `siteFeedHtml()`.
- **Reordering Halls or Yard** in the site list.
- **Mobile layout** of the drawer. The spec runs at 1440×900.
- **Done items, which must not regress:** ranks 1, 3, 4, and 5, and rank 2's earlier slices listed at the top.
