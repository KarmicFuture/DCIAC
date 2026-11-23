# Plan · 2026-11-22 · Floor: a keyboard link from the hall list to the hall overview

Branch: `ux/2026-11-21-cycle`  
Backlog item: **rank 2** in `docs/ux-backlog.md`, third slice. The floor/site view depends on pointer picking and non-focusable floor targets, so keyboard and assistive-tech users can't reliably open halls, racks, servers, or alarm targets (WCAG 2.1.1, 4.1.2). Severity 4, effort L. Already shipped: the keyboard **List** drawer for halls and racks (`docs/plans/2026-11-22-floor.md`), and **Show on floor** opening that List on the alarming rack (`docs/plans/2026-11-22-floor-alarm.md`).

## Why this slice

- **It's the smallest remaining item that unlocks a whole drawer of content for keyboard users.** The hall overview already exists. It is the `level === "pod"` branch of `renderInspector()` (`src/views/floor.ts` lines 1873–1883), with a **Rows** list (`data-act="floor-row"`), a **Racks** list, an **Infrastructure** list, and a **Nearing capacity** list (with the empty state "None right now."). A row then opens `rowPanel()` (lines 1788–1798), which lists that row's **Aisles** (cold and hot). But the only way to reach `level = "pod"` is:
  - clicking the pod plate `div.pod[data-act="floor-pod"]` in the 3D world (line 1524), which isn't focusable, or
  - the `floor-go data-level="pod"` crumb (line 1819), which only appears once you're already below the hall, for example in a rack's drawer.
  
  The hall-level List (the `else` branch, lines 1884–1893) shows Racks, Power and cooling, and Watch list, and nothing leads to Rows, aisles, or Nearing capacity.
- **It needs its own action. `floor-pod` can't be reused.** In `src/ui/render.ts` (lines 473–477), `floor-pod` on the current hall at `hall`, `pod`, or `row` level calls `startWalk()`. That is the pointer behavior "click the plate you're in to walk through it". A `floor-pod` button in the hall list would therefore start the walk-through instead of opening the overview. `floor-go data-level="pod"` can't be used either. It relies on `state.floor.podId`, but the hall drawer falls back to `PODS[0]` when `podId` is empty (line 1885), so the button and the overview could disagree. A new `floor-overview` action that calls the existing `openPod(id)` (line 894) with an explicit `data-pod` avoids both problems.
- **Focus already works.** `recordFloorDrawerFocus()` and `restoreFloorDrawerFocus()` (`render.ts` lines 243–282) fall back to `#floor-detail` when the focused button isn't in the new drawer body. Escape (`render.ts` line 769) already closes the drawer at pod level, because `openPod()` sets `state.inspectorOpen`, and returns focus to `#floor-list-toggle`. The `Hall` crumb at pod level calls `goFloor("hall")`, which leaves `state.floorListOpen` as it is. So a user who came in from the List returns to the hall list, and focus is restored to that crumb.
- **Estimate:** about 2 changed source lines and about 95 lines in one new spec, roughly 100 lines in total. That is well under the ~300-line cap, so the fallback (pipes in the Yard list) isn't needed.

## What remains of rank 2 after this slice

- Pod plates (`.pod[data-act="floor-pod"]`) and aisle bands (`.aisle[data-act="floor-server"]`) in the 3D world are still clickable `div`s that aren't focusable. This slice adds a list route to the same content, not focusable world targets.
- Feeds and pipes (`feedHtml`, `pipeHtml`) are `aria-hidden` and pointer-only. Pipes still aren't in the Yard list (`kind !== "Pipe"`, `floor.ts` line 1848).
- `.rackbox` Tab order follows DOM order, the camera doesn't follow focus, a focused box can be off-stage, and there are 20 or more tab stops before the drawer.
- Pan, orbit, and drag-to-place are pointer-only. A new library item can only be placed by dragging.
- **Show on floor** for yard-located alarms, and from views other than Floor.
- Returning focus to the alarm row after the drawer is closed.
- The `alarm-focus` summary still moves the camera without announcing anything to assistive tech.
- Focus is still lost on re-render everywhere outside the floor drawer.
- After the overview opens, focus lands on the drawer itself, not on its heading or first row. This matches the existing fallback.
- Nobody has done a live screen-reader pass (VoiceOver, NVDA) of the floor.

## Problem (today, from the code)

1. **The hall overview can't be reached from the hall list.** With the List open at `#/floor/hall`, the drawer contains the crumbs `Outside / Hall`, the `Hall N` heading, and the Racks, Power and cooling, and Watch list sections. Nothing in it sets `level = "pod"`. A keyboard user can't see the hall's Rows, its Infrastructure as a separate list, or which devices are Nearing capacity.
2. **The only keyboard route is roundabout.** You have to open a rack, wait for its drawer, then press the `Hall N` crumb. Nothing on the hall list suggests that route exists.
3. **The obvious action does the wrong thing.** `floor-pod` on the current hall starts the walk-through POV (`startWalk`), which hides the List button (`hudHtml()` line 1052) and replaces the drawer flow.

## User story

As a keyboard or screen-reader operator with the floor List open on a hall, I want an **Open Hall N overview** button in that list. It should open the hall overview with its Rows, Racks, Infrastructure, and Nearing capacity, with focus still in the drawer. From there I can open a row to reach its aisles, without a mouse or the 3D scene.

## Change (for the builder)

Escape every interpolated value with `esc()`. Don't change pointer behavior, `floor-pod`, `openPod()`, or the walk-through.

1. **Button** (`renderInspector()`, the hall `else` branch, `src/views/floor.ts` lines 1887–1888). Insert the button between the intro `</p>` and `<h3>Racks</h3>`:
   ```ts
   '<button type="button" class="act" data-act="floor-overview" data-pod="' + esc(hall.id) + '">Open ' + esc(hall.name) + ' overview</button>'
   ```
   The visible text is the accessible name, the same way `feedPanel()` names `Open <rack>` (line 1766), so label-in-name (WCAG 2.5.3) holds. Don't add `floor-overview` to `drillEl()` (line 195). The drawer isn't inside `.world`, and `pickDrill()` already ignores `.inspector`.
2. **Action** (`src/ui/render.ts` `onClick`, next to `floor-hall` at line 545):
   ```ts
   else if (act === "floor-overview") openPod(el.dataset.pod);
   ```
   `openPod` is already imported from `../views/floor` (`render.ts` line 36). `openPod()` already stops any walk, sets `state.inspectorOpen = true`, sets `level = "pod"` and `podId`, clears `serverId`, `rowId`, `feedId`, and `partId`, and renders.
3. **No focus code.** The button isn't in the pod body, so `restoreFloorDrawerFocus()` falls back to `#floor-detail` (`render.ts` line 281). `floorListOpen` is left as it is, so the `Hall` crumb returns to the List.
4. **No CSS change.** `.act` already has the global `:focus-visible` ring (`styles.css` line 131), and the drawer has its own focus ring from the first slice.

Loading feedback: `openPod()` is a synchronous local render, so there's no wait over 300 ms. Empty states already exist: Nearing capacity shows "None right now." when the list is empty. Rows, Racks, and Infrastructure are seeded for every hall.

## Acceptance criteria

All criteria are checked in one new spec, `e2e/floor-hall.spec.js`. Setup, following `floor-list.spec.js`: use a 1440×900 viewport, go to `/#/floor/hall`, sign in as `dsvs.operator`, and wait until `#app` doesn't contain "Loading the asset repository". Open the List by focusing `#floor-list-toggle` and pressing Enter. Steps marked "keyboard" use `page.keyboard`.

1. **The button is in the hall list only.**
   - In the hall drawer, `#floor-detail [data-act="floor-overview"]` has count 1. It is a `<button>` with `data-pod="pod-a"` and accessible name `Open Hall 1 overview`.
   - It comes before the `Racks` heading in DOM order.
   - At `/#/floor` (site level) with the List open, `[data-act="floor-overview"]` has count 0.
2. **Reach it by keyboard.** With the hall drawer focused (`#floor-detail` is `document.activeElement` after opening), press Tab (keyboard) at most 4 times until the overview button is `document.activeElement`. That means past the `Outside` and `Hall` crumbs. Its computed `outline-style` is not `none`.
3. **Enter opens the overview and keeps focus in the drawer.** Press Enter (keyboard). Then:
   - `#floor-detail` is visible, and `.inspector` has count 1.
   - `#floor-detail .crumbs` contains a `[data-act="floor-go"][data-level="pod"]` crumb with text `Hall 1`.
   - The drawer has the headings `Hall 1` (h2), and `Rows`, `Racks`, `Infrastructure`, and `Nearing capacity` (h3).
   - `#floor-detail [data-act="floor-row"]` has count ≥ 1.
   - `#floor-detail [data-act="floor-rack"]` has count 20.
   - Under `Nearing capacity` there is either at least one `[data-act="floor-server"]` button or the text `None right now.`
   - Using `expect.poll` (about 1 s), `document.activeElement` is `#floor-detail` or inside it.
   - `#floor-list-toggle` has `aria-expanded="true"`.
4. **It doesn't start the walk-through.** After step 3, `.scene.walking` has count 0, `.walk-bar` has count 0, and `#floor-list-toggle` is still present.
5. **The aisles are one more step away.** Press Tab (keyboard) until the first `[data-act="floor-row"]` is focused, then press Enter. `#floor-detail` has the heading `Aisles` and buttons named `Cold aisle Supply` and `Hot aisle Exhaust`. Focus is in the drawer.
6. **The Hall crumb goes back to the hall list.** From the overview (repeat steps 2 and 3), focus the drawer's `[data-act="floor-go"][data-level="hall"]` crumb and press Enter (keyboard). Then the drawer is visible with heading `Hall 1` and the `Watch list` heading, `[data-act="floor-overview"]` has count 1 again, and focus is on that drawer's `Hall` crumb.
7. **Escape closes it and returns focus to the List button.** From the overview, press Escape (keyboard). `.inspector` has count 0, `#floor-list-toggle` has `aria-expanded="false"`, and `#floor-list-toggle` is `document.activeElement`.
8. **Another hall works too.** From the site List, open `Hall 2` (`[data-act="floor-hall"][data-pod]`, the second one), then activate its overview button. Its accessible name is `Open Hall 2 overview`, and afterwards the h2 is `Hall 2` and `.hud-mission` matches `/Hall 2/`.
9. **Pointer behavior is unchanged.** These pass unchanged: `floor-list.spec.js`, `floor-alarm.spec.js`, `stage.spec.js`, `hall.spec.js`, `floor-drag.spec.js`, `floor-rack3d.spec.js`, `alarm.spec.js`, `lod.spec.js`, and the demo specs.
10. **The whole suite passes:** `npm test` in `prototypes/access-control` (`pretest` runs `vite build`), with no skipped or removed tests. The total diff is under about 300 lines.

## Files to touch

| file | change | est. lines |
|---|---|---:|
| `prototypes/access-control/src/views/floor.ts` | **Open Hall N overview** button in the hall branch of `renderInspector()` | ~1 |
| `prototypes/access-control/src/ui/render.ts` | `floor-overview` branch in `onClick` | ~1 |
| `prototypes/access-control/e2e/floor-hall.spec.js` | new spec for the criteria above | ~95 |

That is about 100 lines in total. Don't touch `styles.css`, `state.ts`, `types.ts`, `demo.ts`, or `alarms.ts`, and don't touch `dcim-hall-board`.

## Out of scope

- **The rest of rank 2** (see "What remains of rank 2 after this slice"): focusable pod plates, aisle bands, feeds, and pipes in the 3D world; pipes in the Yard list; `.rackbox` Tab order and camera follow; keyboard pan, orbit, and placement; yard-located alarms and Show on floor from other views; returning focus to the alarm row; announcing the summary's camera move; general focus retention; a live screen-reader pass.
- **Changing `floor-pod` or `startWalk()`.** Clicking the plate of the hall you're in still starts the walk-through.
- **Rewriting the pod-level or hall-level drawer content**, or moving focus to a heading or first row after the overview opens. The existing drawer focus fallback is kept.
- **A route for the overview** (for example `#/floor/pod-a`). The URL behavior of `openPod()` is unchanged.
- **Mobile layout** of the drawer. The spec runs at 1440×900.
- **Done items, which must not regress:** rank 1, outlet confirmation (`docs/plans/2026-11-22.md`); rank 3, Operate/Plan sub-navigation (PR #44); rank 4, alarm banner actions (`docs/plans/2026-11-22-alarm.md`); rank 5, KVM console (`docs/plans/2026-11-22-kvm.md`); and rank 2's first two slices, the floor List (`docs/plans/2026-11-22-floor.md`) and Show on floor (`docs/plans/2026-11-22-floor-alarm.md`).
