# Plan · 2026-11-22 · Floor: supply and return piping in the Yard list

Branch: `ux/2026-11-21-cycle`  
Backlog item: **rank 2** in `docs/ux-backlog.md`, fourth slice. The floor/site view depends on pointer picking and non-focusable or `aria-hidden` floor targets, so keyboard and assistive-tech users can't reliably open halls, racks, servers, or alarm targets (WCAG 2.1.1, 4.1.2). Severity 4, effort L. Already shipped: the keyboard **List** drawer (`docs/plans/2026-11-22-floor.md`), **Show on floor** opening that List on the alarming rack (`docs/plans/2026-11-22-floor-alarm.md`), and **Open Hall N overview** from the hall List (`docs/plans/2026-11-22-floor-hall.md`, commit `63c2522`).

## Why this slice

- **It's the smallest remaining rank-2 gap, and the fix is one filter.** The site-level List (`renderInspector()`, `level === "site"` branch, `src/views/floor.ts` lines 1844–1848) builds the **Yard** section with
  ```ts
  infra.filter((item) => item.yard && item.kind !== "Pipe").map(rowButton).join("")
  ```
  The two pipe entities are seeded in `src/data/pods.ts` lines 173–174 as yard infrastructure, the same way as every other yard item:
  - `pipe-sup`, "Supply piping", kind `Pipe`, power 22
  - `pipe-ret`, "Return piping", kind `Pipe`, power 36
  
  Only the `kind !== "Pipe"` clause keeps them out of the list. So including every pipe adds exactly **two** buttons, not one per drawn segment, and there's no risk of a huge unlabeled list.
- **The pipe detail already exists, and it already opens from a `floor-server` click.** Today a pipe can only be opened with the pointer: `pipeHtml()` (lines 1254–1265) draws each segment as `div.pipe[data-act="floor-server"][data-server="pipe-sup|pipe-ret"][aria-hidden="true"]`, with no tabindex. `sitePipesHtml()` (lines 1377–1398) draws the spines, the per-hall runs, and the per-gear runs from that one function, so every segment maps to one of the two entities. A click goes through `onClick` in `src/ui/render.ts` (lines 541–544), `act === "floor-server"`, which calls `openFloorServer(id)` (`floor.ts` lines 923–939). Because the pipe entity has `yard: true`, that sets `state.inspectorOpen = true`, `level = "site"`, and `serverId = id`, and renders. The site branch of `renderInspector()` (line 1842) then shows `serverInspector(entity)`, which has a dedicated `entity.kind === "Pipe"` panel (lines 1665–1669): the `yardArt()` sheet with the caption "Cool supply. It runs along the outside of the east wall." or "Warm return. It runs beside the supply and stays outside the hall.", plus a sentence about supply or return piping.
- **`rowButton()` already produces exactly that open path.** `rowButton(entity)` (lines 1805–1809) renders `<button type="button" class="floor-row" data-act="floor-server" data-server="<id>" data-load-for="<id>">` with the status LED (`role="img"`, `aria-label` = tone word), the entity name in a `<span>`, and the score in `<b data-score>`. That is the same `data-act`/`data-server` pair as the 3D pipe div, so Enter on the list button runs the same `openFloorServer()` call the pointer does. No new action, no new level, no new focus target.
- **The names are already the pointer labels.** `rowButton()` escapes `entity.name` with `esc()`, and that name ("Supply piping", "Return piping") is the same text the pointer panel shows as its `<h2>`. Pipes are facilities, so `conditionTone()` uses `load.power` (22 and 36, drift 0.01) and the LED word is `Nominal`. The accessible names are `Nominal Supply piping 22%` and `Nominal Return piping 36%` (the percentage can drift by a point). This also satisfies the existing `floor-list.spec.js` check that every Yard button's name starts with a status word.
- **Focus already works.** After Enter, `recordFloorDrawerFocus()` (`render.ts` lines 243–265) records `[data-act="floor-server"][data-server="pipe-sup"]`. The pipe panel doesn't contain that button (at `level = "site"` the crumbs are only `Outside`), so `restoreFloorDrawerFocus()` (lines 267–282) falls back to `#floor-detail`. The `Outside` crumb calls `goFloor("site")`, which clears `serverId` and leaves `state.floorListOpen` as it is, so the user returns to the **Ten halls** list with focus restored to that crumb. Escape (`render.ts` lines 767–776) calls `closeFloorDetail()` and moves focus to `#floor-list-toggle`.
- **Estimate:** 1 changed source line and about 90 lines in one new spec, roughly 90–100 lines in total.

## What remains of rank 2 after this slice

- Pod plates (`.pod[data-act="floor-pod"]`) and aisle bands (`.aisle[data-act="floor-server"]`) in the 3D world are still clickable `div`s that aren't focusable.
- Feeds and pipes drawn in the 3D world (`feedHtml`, `pipeHtml`, `siteFeedHtml`, `sitePipesHtml`) stay `aria-hidden` and pointer-only. After this slice the pipe *entities* have a list route, but individual pipe segments (for example `supply-pod-a` or a failed segment in a simulation) still have no keyboard or screen-reader route, and site feed segments (`grid-xfmr`, `xfmr-mod`, `feed-hall-*`) are only reachable through the grid's "Open the feeder" button or by pointer.
- A failed pipe segment in a simulation (`report.failedPipes`) is only shown visually in the 3D world. The list row's LED doesn't reflect it.
- `.rackbox` Tab order follows DOM order, the camera doesn't follow focus, a focused box can be off-stage, and there are 20 or more tab stops before the drawer.
- Pan, orbit, and drag-to-place are pointer-only. A new library item can only be placed by dragging.
- **Show on floor** for yard-located alarms, and from views other than Floor.
- Returning focus to the alarm row after the drawer is closed.
- The `alarm-focus` summary still moves the camera without announcing anything to assistive tech.
- Focus is still lost on re-render everywhere outside the floor drawer.
- After a detail opens from the List, focus lands on the drawer itself, not on its heading. This matches the existing fallback.
- Nobody has done a live screen-reader pass (VoiceOver, NVDA) of the floor.

## Problem (today, from the code)

1. **The pipes are missing from the Yard list.** With the List open at `#/floor`, the drawer shows `Ten halls`, the 10 hall buttons, and a **Yard** section with every yard item except the two pipes. The filter `item.kind !== "Pipe"` (line 1848) is the only reason.
2. **The only route to the pipe detail is the pointer.** The pipe segments in the 3D yard are `aria-hidden="true"` `div`s without tabindex. A keyboard user can't reach them, and a screen-reader user isn't told they exist. The pipe detail panel (the supply and return descriptions and the yard sheet) exists but can't be reached without a mouse.
3. **The hydro skid and dry cooler panels point at the pipes** ("Pumps sit on the yard manifold, on the supply and return pipes.", "Fan decks reject the heat the pipes bring out of the shell.") with no way to follow that reference from the keyboard.

## User story

As a keyboard or screen-reader operator with the floor List open at the site, I want **Supply piping** and **Return piping** in the Yard list, as buttons like the other yard infrastructure. Pressing Enter on one should open the same pipe detail the pointer opens, with focus still in the drawer, so I can learn where the cooling loop runs without a mouse or the 3D scene.

## Change (for the builder)

Don't change pointer behavior, `pipeHtml()`, `sitePipesHtml()`, `rowButton()`, `openFloorServer()`, `serverInspector()`, or `render.ts`.

1. **Filter** (`renderInspector()`, the site branch, `src/views/floor.ts` line 1848). Drop the pipe exclusion:
   ```ts
   infra.filter((item) => item.yard).map(rowButton).join("");
   ```
   That's the whole product change. `rowButton()` already escapes the name with `esc()`. Its `data-server` value is a seeded id (`pipe-sup`, `pipe-ret`) like every other `rowButton` call, so don't add new escaping there. The pipes are seeded last (`pods.ts` lines 173–174), so they appear at the end of the Yard section, after the YARD gear.
2. **No `render.ts` change.** `floor-server` already calls `openFloorServer()`, which handles yard entities at `level = "site"`.
3. **No focus code.** The existing drawer focus fallback puts focus on `#floor-detail` after the pipe opens, and on the `Outside` crumb after returning.
4. **No 3D change.** The pipe `div`s stay `aria-hidden`, without tabindex. Don't add them to `drillEl()` or change `pickDrill()`.
5. **No CSS change.** `.floor-row` and `.act` already have the global `:focus-visible` ring (`styles.css` line 131), and the drawer has its own focus ring from the first slice.

Loading feedback: `openFloorServer()` is a synchronous local render, so there's no wait over 300 ms. Empty state: the Yard section is seeded with gear and now always has at least the two pipes, so no empty state is needed.

## Acceptance criteria

All criteria are checked in one new spec, `e2e/floor-pipes.spec.js`. Setup, following `floor-list.spec.js` and `floor-hall.spec.js`: use a 1440×900 viewport, go to `/#/floor`, sign in as `dsvs.operator`, and wait until `#app` doesn't contain "Loading the asset repository". Open the List by focusing `#floor-list-toggle` and pressing Enter (keyboard). Steps marked "keyboard" use `page.keyboard` only.

1. **Both pipes are in the Yard list, as buttons.**
   - In `#floor-detail`, `h3:has-text("Yard") ~ [data-act="floor-server"][data-server="pipe-sup"]` and `…[data-server="pipe-ret"]` each have count 1.
   - Each is a `<button>` (`toHaveRole("button")`) with `type="button"` and class `floor-row`.
   - Their accessible names match `/^Nominal Supply piping \d+%$/` and `/^Nominal Return piping \d+%$/`. More loosely, they match `/^(Nominal|Rise|Hot|RDP|BMC) Supply piping \d+%$/` and the same for Return, so a simulated load swing doesn't fail the spec.
   - Both come after the `Yard` heading in DOM order. Within the Yard section, `[data-server^="pipe-"]` has count 2 and the total `[data-act="floor-server"]` count is at least 3, so the other yard gear is still listed.
2. **The 3D pipes are unchanged.** `.world .pipe` count is greater than 0, every `.pipe` still has `aria-hidden="true"`, and none has a `tabindex` attribute.
3. **Reach it by keyboard.** With the drawer focused (`#floor-detail` is `document.activeElement` after opening), press Tab (keyboard) until the `pipe-sup` button is `document.activeElement`. Bound the loop by the number of buttons in the drawer. Its computed `outline-style` is not `none`.
4. **Enter opens the supply pipe detail and keeps focus in the drawer.** Press Enter (keyboard). Then:
   - `#floor-detail` is visible and `.inspector` has count 1.
   - The drawer has the h2 `Supply piping` and the text `Pipe · simulated load`.
   - It contains `Cool supply. It runs along the outside of the east wall.` and `Supply piping carries cool fluid`.
   - `#floor-detail .crumbs` contains the `Outside` crumb (`[data-act="floor-go"][data-level="site"]`) and no `[data-level="hall"]` crumb.
   - Using `expect.poll` (about 1 s), `document.activeElement` is `#floor-detail` or inside it.
   - `#floor-list-toggle` has `aria-expanded="true"`.
5. **The Outside crumb goes back to the list.** Press Shift+Tab or Tab (keyboard) until the `Outside` crumb is focused, then press Enter. The drawer is visible with h2 `Ten halls` and the `Yard` heading, the `pipe-ret` button has count 1, and focus is on the drawer's `Outside` crumb.
6. **The return pipe works too.** Press Tab (keyboard) until the `pipe-ret` button is focused, then press Enter. The h2 is `Return piping`, and the drawer contains `Warm return. It runs beside the supply and stays outside the hall.` and `Return piping carries warm fluid`. Focus is in the drawer.
7. **Escape closes it and returns focus to the List button.** From the return pipe detail, press Escape (keyboard). `.inspector` has count 0, `#floor-list-toggle` has `aria-expanded="false"`, and `#floor-list-toggle` is `document.activeElement`.
8. **Pointer pipe open is unchanged.** In a separate test, at `/#/floor` with the List closed, dispatch a click on the first `.pipe.supply[data-server="pipe-sup"]` (use `dispatchEvent("click")` or `click({ force: true })`, because the pipe is thin and may be overlapped). The drawer opens with h2 `Supply piping`, exactly as in step 4.
9. **Existing specs pass unchanged.** In particular `floor-list.spec.js`, whose Yard check requires every Yard button's name to start with a status word, and `floor-alarm.spec.js`, `floor-hall.spec.js`, `stage.spec.js`, `hall.spec.js`, `floor-drag.spec.js`, `floor-rack3d.spec.js`, `alarm.spec.js`, `lod.spec.js`, and the demo specs.
10. **The whole suite passes:** `npm test` in `prototypes/access-control` (`pretest` runs `vite build`), with no skipped or removed tests. The total diff is under about 300 lines.

## Files to touch

| file | change | est. lines |
|---|---|---:|
| `prototypes/access-control/src/views/floor.ts` | drop `&& item.kind !== "Pipe"` from the Yard filter in the site branch of `renderInspector()` | ~1 |
| `prototypes/access-control/e2e/floor-pipes.spec.js` | new spec for the criteria above | ~90 |

That is about 90–100 lines in total. Don't touch `render.ts`, `styles.css`, `state.ts`, `types.ts`, `pods.ts`, `demo.ts`, or `alarms.ts`, and don't touch `dcim-hall-board`.

## Out of scope

- **Making 3D pipe or feed `div`s focusable**, removing their `aria-hidden`, or adding a per-segment list (spines, per-hall runs, per-gear runs). The list adds the two pipe entities only.
- **Showing a failed pipe segment** from a simulation report in the list or announcing it.
- **The rest of rank 2** (see "What remains of rank 2 after this slice"): pod plates, aisle bands, `.rackbox` Tab order and camera follow, keyboard pan, orbit, and placement, Show on floor for yard alarms and from other views, returning focus to the alarm row, announcing the summary's camera move, general focus retention, a live screen-reader pass.
- **Changing the pipe panel copy**, `rowButton()` markup, the Yard order, or adding a "Piping" subheading.
- **Moving focus to the pipe heading** after it opens. The existing drawer focus fallback is kept.
- **Styles.** `.floor-row` already has a visible focus ring.
- **Mobile layout** of the drawer. The spec runs at 1440×900.
- **Done items, which must not regress:** rank 1, outlet confirmation (`docs/plans/2026-11-22.md`); rank 3, Operate/Plan sub-navigation (PR #44); rank 4, alarm banner actions (`docs/plans/2026-11-22-alarm.md`); rank 5, KVM console (`docs/plans/2026-11-22-kvm.md`); and rank 2's first three slices: the floor List (`docs/plans/2026-11-22-floor.md`), Show on floor (`docs/plans/2026-11-22-floor-alarm.md`), and the hall overview (`docs/plans/2026-11-22-floor-hall.md`).
