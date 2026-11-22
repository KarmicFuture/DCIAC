# Plan · 2026-11-22 · Floor: the Grid drawer opens its own feeder

Branch: `ux/2026-11-21-cycle`  
Backlog item: **rank 2** in `docs/ux-backlog.md`, seventh slice. The floor/site view depends on pointer picking and non-focusable or `aria-hidden` floor targets, so keyboard and assistive-tech users can't reliably open halls, racks, servers, or alarm targets (WCAG 2.1.1, 4.1.2). Severity 4, effort L. Already shipped: the keyboard **List** drawer (`docs/plans/2026-11-22-floor.md`), **Show on floor** on the Floor view (`docs/plans/2026-11-22-floor-alarm.md`), **Open Hall N overview** (`docs/plans/2026-11-22-floor-hall.md`), yard pipes in the list (`docs/plans/2026-11-22-floor-pipes.md`), **Show on floor** from every signed-in screen (`docs/plans/2026-11-22-floor-jump.md`, commit `983ac38`), and **Feeder A** and **Feeder B** in the site list (`docs/plans/2026-11-22-floor-feeds.md`, commit `0426282`).

## Why this slice

- **It's the gap the feeder plan named.** `serverInspector()` (`src/views/floor.ts`, the `entity.kind === "Grid"` branch, lines 1668–1670) gives every Grid entity the same button: `data-act="floor-feed" data-feed="grid-xfmr"`, text **Open the feeder**. `siteFeedHtml()` (lines 1357–1362) never draws `grid-xfmr`. It draws `grid-1` to `xfmr-1` as `grid-xfmr-a` and `grid-2` to `xfmr-2` as `grid-xfmr-b`.
- **The round trip is broken today.** From the site List, **Feeder A** opens `grid-xfmr-a`, and **Open the grid** opens `grid-1` (`feedPanel()`, lines 1779–1782). From there, **Open the feeder** opens the singular `grid-xfmr` copy ("Utility feeder from the grid gantry to the MV transformer"), not Feeder A. From `grid-2` (Feeder B) it's worse: the singular branch's **Open the grid** points at `grid-1`, so the operator lands on the wrong grid. A keyboard user has no way to tell from the 3D scene that this happened.
- **Everything else already exists.** `render.ts` line 487 routes `data-act="floor-feed"` to `openFeed()`. `feedPanel()` already has Feeder A/B copy and the right **Open the grid** target. Focus falls back to `#floor-detail` through `restoreFloorDrawerFocus()`, and Escape closes the drawer and returns focus to `#floor-list-toggle`. So this is a one-expression change.
- **Estimate:** about 5 lines in `floor.ts`, plus about 100 lines in one new spec, roughly 105 lines in total.

## What remains of rank 2 after this slice

- Pod plates (`.pod[data-act="floor-pod"]`) and aisle bands (`.aisle[data-act="floor-server"]`) in the 3D world are still clickable `div`s that aren't focusable. The list routes reach the same content.
- All 3D `.feed` and `.pipe` segments stay `aria-hidden` and pointer-only. The other site feeds (`xfmr-mod-a/b`, `mod-c`, `mod-d`, `batt-a/b`, `mod-bus`, `mod-bus-b`, `mod-riser`, `feed-hall-*`) and the hall feeds (`bus-*`, `whip-*`) aren't in the site list. Bus and whip feeds are reachable from rack and aisle drawers.
- The Grid drawer's copy still says "One feeder is closed through the transformer…" for both grids. The unused `grid-xfmr` branch in `feedPanel()` stays (it guards old hashes and state).
- `.rackbox` Tab order follows DOM order, the camera doesn't follow focus, a focused box can be off-stage, and there are 20 or more tab stops before the drawer.
- Pan, orbit, and drag-to-place are pointer-only. A new library item can only be placed by dragging.
- Returning focus to the alarm row after the drawer is closed.
- The `alarm-focus` summary still moves the camera without announcing anything to assistive tech.
- Focus is still lost on re-render everywhere outside the floor drawer.
- After a list item opens, focus lands on the drawer itself, not on its heading.
- Nobody has done a live screen-reader pass (VoiceOver, NVDA) of the floor.

## Problem (today, from the code)

1. **Open the feeder goes to a feeder that isn't on the floor.** Both `grid-1` (Feeder A · 150 MW) and `grid-2` (Feeder B · 150 MW) open the singular `grid-xfmr` detail, which doesn't name a side.
2. **From Feeder B, the way back goes to the wrong grid.** The singular detail's **Open the grid** is hard-wired to `grid-1`.
3. **The button name doesn't say which feeder.** A screen-reader user hears "Open the feeder" from both grids.

## User story

As a keyboard or screen-reader operator in a Grid drawer, I want the button to say **Open Feeder A** or **Open Feeder B** and open the feeder that grid actually feeds, so I can go grid → feeder → grid and land back where I started, without a mouse or the 3D scene.

## Change (for the builder)

One edit in `serverInspector()`, the `entity.kind === "Grid"` branch (`src/views/floor.ts` lines 1668–1670). Replace the button string with a per-grid one. Keep the `yardArt(entity)` call and the paragraph as they are:

```ts
} else if (entity.kind === "Grid") {
  const side = entity.id === "grid-2" ? "b" : "a";
  action = yardArt(entity) + "<p>The utility grid lands on a gantry outside the shell. One feeder is closed through the transformer and the power module, and it stops at the hall wall.</p>" +
    '<button type="button" class="act" data-act="floor-feed" data-feed="grid-xfmr-' + side + '">Open Feeder ' + side.toUpperCase() + "</button>";
```

The exact button expression:

```ts
'<button type="button" class="act" data-act="floor-feed" data-feed="grid-xfmr-' + side + '">Open Feeder ' + side.toUpperCase() + "</button>"
```

with `side = entity.id === "grid-2" ? "b" : "a"`. Resulting markup:

- `grid-2`: `<button type="button" class="act" data-act="floor-feed" data-feed="grid-xfmr-b">Open Feeder B</button>`
- `grid-1` and any other Grid: `<button type="button" class="act" data-act="floor-feed" data-feed="grid-xfmr-a">Open Feeder A</button>`

`side` is one of two literals, so there's nothing to escape. Still exactly one button, still no `data-pod` (site-level feed, same as the site List buttons).

Don't change `feedPanel()` (leave the unused `id === "grid-xfmr"` branch so an old state doesn't crash), the site List, `openFeed()`, `feedHtml()`, `siteFeedHtml()`, `render.ts`, the 3D feeds, focus code, or CSS. `.act` already has the drawer's `:focus-visible` ring.

Loading feedback: `openFeed()` is a synchronous local render, so there's no wait over 300 ms. Empty and error states are unchanged.

## Acceptance criteria

All criteria are checked in one new spec, `e2e/floor-grid.spec.js`. Setup matches `floor-feeds.spec.js`: use a 1440×900 viewport, go to `/#/floor`, sign in as `dsvs.operator`, and wait until `#app` doesn't contain "Loading the asset repository". Open the List by focusing `#floor-list-toggle` and pressing Enter; `#floor-detail` is visible and focused, with heading `Ten halls`. Steps marked "keyboard" use `page.keyboard`.

1. **The grid-1 drawer points at Feeder A.** Activate the Yard row `#floor-detail [data-act="floor-server"][data-server="grid-1"]` (focus it, press Enter). In `#floor-detail`:
   - The h2 matches `/Feeder A/` (the grid's name, `Feeder A · 150 MW`).
   - `[data-act="floor-feed"]` has count 1. It is a `<button type="button">` with `data-feed="grid-xfmr-a"`, no `data-pod`, and accessible name exactly `Open Feeder A`.
   - `[data-feed="grid-xfmr"]` (exact match) has count 0 in the whole page.
2. **Keyboard opens Feeder A.** Press Tab (keyboard), at most the drawer's focusable count + 2 times, until `Open Feeder A` is `document.activeElement`. Its computed `outline-style` is not `none`. Press Enter (keyboard). Then:
   - `#floor-detail` is visible and `.inspector` has count 1.
   - The drawer has an h2 `Energized`, and contains the text `Feeder A` and `Utility feeder`.
   - Using `expect.poll` (about 1 s), `document.activeElement` is `#floor-detail` or inside it.
   - `.scene.walking` and `.walk-bar` have count 0.
   - `#floor-list-toggle` has `aria-expanded="true"`.
3. **Open the grid comes back to grid-1.** Tab (keyboard) to `Open the grid` (`data-server="grid-1"`) and press Enter. The h2 matches `/Feeder A/`, focus is in the drawer, and the `Open Feeder A` button with `data-feed="grid-xfmr-a"` is present again.
4. **The same round trip for grid-2.** Reopen the site List (Escape, then the toggle, or the `Outside` crumb), activate `[data-server="grid-2"]`. The only `floor-feed` button has `data-feed="grid-xfmr-b"` and accessible name `Open Feeder B`. Tab to it (outline-style not `none`) and press Enter: h2 `Energized`, text includes `Feeder B` and `Utility feeder`, focus in the drawer, no walk, toggle `aria-expanded="true"`. `Open the grid` has `data-server="grid-2"`; Enter returns to an h2 matching `/Feeder B/` with `Open Feeder B` present.
5. **The 3D feeds stay hidden.** Every `.world .feed` has `aria-hidden="true"` and no `tabindex`, and the count is > 0.
6. **Existing specs still pass unchanged:** `floor-feeds.spec.js` in particular, plus `floor-list.spec.js`, `floor-pipes.spec.js`, `floor-hall.spec.js`, `floor-alarm.spec.js`, `floor-alarm-jump.spec.js`, `floor-drag.spec.js`, `floor-rack3d.spec.js`, `stage.spec.js`, and `hall.spec.js`.
7. **The whole suite passes:** `npm test` in `prototypes/access-control` (`pretest` runs `vite build`), with no skipped or removed tests. The total diff is under about 150 lines (rule cap ~300).

## Files to touch

| file | change | est. lines |
|---|---|---:|
| `prototypes/access-control/src/views/floor.ts` | Grid branch of `serverInspector()`: per-grid `data-feed` and button text | ~5 |
| `prototypes/access-control/e2e/floor-grid.spec.js` | new spec for the criteria above | ~100 |

That is about 105 lines in total. Don't touch `render.ts`, `styles.css`, `state.ts`, `types.ts`, `CHANGELOG`, or other specs, and don't touch `dcim-hall-board`.

## Out of scope

- **The rest of rank 2** (see "What remains of rank 2 after this slice"). Rank 2 stays open.
- **A second button** in the Grid drawer, or offering both feeders from one grid.
- **Changing `feedPanel()`**, including removing or fixing the singular `grid-xfmr` branch and its hard-wired `grid-1` target.
- **Rewriting the Grid drawer paragraph** ("One feeder is closed…") per grid.
- **The site List, `openFeed()`, `feedHtml()`, `siteFeedHtml()`, `render.ts`, and the 3D `.feed` segments.**
- **Reflecting a simulated feeder failure** in the feeder detail. `feedMode()` returns `"live"` for these ids, which is existing behavior.
- **Mobile layout** of the drawer. The spec runs at 1440×900.
- **Done items, which must not regress:** ranks 1, 3, 4, and 5, and rank 2's earlier slices listed at the top.
