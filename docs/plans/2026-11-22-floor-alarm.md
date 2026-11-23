# Plan · 2026-11-22 · Floor: "Show on floor" opens the List on the alarming rack and moves focus there

Branch: `ux/2026-11-21-cycle`  
Backlog item: **rank 2** in `docs/ux-backlog.md`, second slice. The floor/site view depends on pointer picking and non-focusable floor targets, so keyboard and assistive-tech users can't reliably open halls, racks, servers, or **alarm targets** (WCAG 2.1.1, 2.4.3, 4.1.2). Severity 4, effort L. The first slice, a keyboard **List** drawer for halls and racks (`docs/plans/2026-11-22-floor.md`), has shipped.

## Why this slice

- **It's the smallest remaining item that connects the alarm banner to the List that just shipped.** Today an operator can reach the alarm banner by keyboard (rank 4), and can reach a rack through the List (rank 2, first slice). But nothing gets them from an alarm to its rack in the List. `focusFloorAlarm()` (`src/views/floor.ts` line 566) moves the camera and pulses a `.rackbox`. Then it sets `state.inspectorOpen = false` (line 581), and keyboard focus stays in the banner. A screen-reader user hears nothing about where the alarm is.
- **The pieces already exist.** `state.floorListOpen` and `floorDetailOpen()` (line 1901) show the hall drawer at `level === "hall"`. The hall branch of `renderInspector()` (lines 1859–1867) already renders one `[data-act="floor-rack"][data-pod][data-rack]` button per rack, named with its status dot and device count. `focusFloorAlarm()` already sets `level = "hall"`, `podId`, and `rackId` for rack targets. `render()` is synchronous (`src/ui/schedule.ts` line 9), so the function can focus the drawer row right after it paints. `restoreFloorDrawerFocus()` (`render.ts` line 267) then keeps focus in the drawer across later re-renders. Escape already closes the drawer and returns focus to `#floor-list-toggle` (`render.ts` line 765).
- **It needs its own trigger. The alarm summary can't be reused.** Today `focusFloorAlarm()` runs from `<summary data-act="alarm-focus">` (`src/ui/alarms.ts` line 167), and that same press expands the row. Rank 4's accepted criterion 7 (`docs/plans/2026-11-22-alarm.md`) says Enter or Space on the summary only expands the row, and `e2e/alarm.spec.js` (lines 123–127) checks that the HUD mission is unchanged. If the summary also moved focus into the drawer, every press meant to expand the row would pull the user away from the Ack and Explain controls they just revealed. So this slice adds a separate, named **Show on floor** button inside the row's expanded area (`.alarm-extra`, next to Ack). The summary keeps its camera-only behavior.
- **It is limited to rack targets.** `locateAlarm()` (line 543) can also return `{ kind: "yard" }`, but no seeded alarm source in `activeAlarms()` or `plantAlarms()` resolves to a yard item. Every watch, outlet, inlet, recirculation, and neighbor alarm maps to a rack. A yard branch couldn't be tested end to end, so the button is only rendered when the target is a rack.
- **Estimate:** about 30 changed source lines and about 110 lines in one new spec, roughly 140 lines in total. That is well under the ~300-line cap.

## What remains of rank 2 after this slice

- Pod plates (`.pod[data-act="floor-pod"]`) and aisle bands (`.aisle[data-act="floor-server"]`) in the 3D world are clickable `div`s that aren't focusable.
- Feeds and pipes (`feedHtml`, `pipeHtml`) are `aria-hidden` and pointer-only. Pipes aren't in the Yard list (`kind !== "Pipe"`, `floor.ts` line 1823).
- `.rackbox` Tab order follows DOM order, the camera doesn't follow focus, a focused box can be off-stage, and there are 20 or more tab stops before the drawer.
- Pan, orbit, and drag-to-place are pointer-only. A new library item can only be placed by dragging.
- **Show on floor** for yard-located alarms (`locateAlarm()` → `kind: "yard"`), and from views other than Floor (the button is hidden there, because `focusFloorAlarm()` returns early when `state.view !== "floor"`).
- Returning focus to the alarm row after the drawer is closed. Escape goes to `#floor-list-toggle`, as the first slice set up.
- The `alarm-focus` summary still moves the camera without announcing anything to assistive tech.
- Focus is still lost on re-render everywhere outside the floor drawer.
- The hall list has no direct link to the hall overview (Rows, aisles, Nearing capacity).
- Nobody has done a live screen-reader pass (VoiceOver, NVDA) of the floor.

## Problem (today, from the code)

1. **An alarm can't take a keyboard user to its rack.** Activating the alarm summary on Floor calls `focusFloorAlarm(alarm)`. That function changes `state.floor`, glides the camera with `glideCamera(from)`, and adds `.is-pulse` to `.rackbox[data-rack="…"]`. It sets `state.inspectorOpen = false` and never sets `state.floorListOpen`, so no drawer opens. `document.activeElement` stays on the summary in the banner. The only cue is visual: a 2-second pulse in a CSS-3D scene.
2. **Nothing is announced.** No heading, list, or focused control changes, so a screen-reader user gets no feedback that the alarm was located.
3. **When the level doesn't change, nothing re-renders.** If the floor is already at that hall, `same` is true and `render()` is skipped (line 598). Setting the list state alone would not paint the drawer.

## User story

As a keyboard or screen-reader operator who sees an alarm in the banner while on the floor view, I want a **Show on floor** button on the alarm that opens the floor List on that rack's hall, with focus on that rack's row. That way I hear which rack it is and its status, and one more Enter opens the rack, without a mouse or the 3D scene.

## Change (for the builder)

Escape every interpolated value with `esc()`. Don't change pointer behavior or the `alarm-focus` summary.

1. **Target helper** (`src/views/floor.ts`, next to `locateAlarm()`):
   ```ts
   export function floorAlarmRackId(alarm) {
     const place = locateAlarm(alarm);
     return place && place.kind === "rack" ? place.rack.id : "";
   }
   ```
2. **`focusFloorAlarm(alarm, opts?)`** (line 566). Add an optional second parameter `opts: { list?: boolean } = {}`. When `opts.list` is true:
   - Return early unless `place.kind === "rack"`.
   - Set `state.floorListOpen = true` next to the existing `state.inspectorOpen = false`.
   - Re-render even when `same` is true: change `if (!same) render();` to `if (!same || opts.list) render();`.
   - After the existing pulse block, find `#floor-detail [data-act="floor-rack"][data-rack="<rack.id>"]`. If it exists:
     - Focus it with `{ preventScroll: true }`.
     - Scroll the drawer itself, not `.scene` or the window, so the row is visible. For example, if the row is outside the drawer's visible area, set `drawer.scrollTop = row.offsetTop - drawer.clientHeight / 2`. `.inspector` already has `overflow: auto` (`styles.css` line 1532), and the drawer is `position: absolute`, so it is the row's offset parent.
     - Don't call `scrollIntoView()`. It can scroll the `overflow: hidden` scene.
   - If the row isn't found, focus `#floor-detail` with `{ preventScroll: true }`.
   - Without `opts.list`, the function behaves exactly as it does today.
3. **Button** (`alarmBanner()`, `src/ui/alarms.ts` line 160). Import `floorAlarmRackId` from `../views/floor`, alongside the existing imports on line 13. Inside `.alarm-extra`, after the Ack button and before the `explain-fold`, render this only when `state.view === "floor" && floorAlarmRackId(alarm)`:
   ```html
   <button type="button" class="act" data-act="alarm-floor" data-alarm="ID" aria-label="Show on floor · ASSET">Show on floor</button>
   ```
   It sits inside `details.alarm-fold` but outside its `summary`, so rank 4's "no button inside a summary" rule still holds. It is hidden while the row is collapsed, so rank 4's Tab order (summary, then response button, then next summary) doesn't change. It doesn't ack the alarm, because locating isn't responding.
4. **Action** (`src/ui/render.ts` `onClick`, next to `alarm-focus` at line 580):
   ```ts
   else if (act === "alarm-floor") {
     const alarm = activeAlarms().find((item) => item.id === el.dataset.alarm);
     if (alarm) focusFloorAlarm(alarm, { list: true });
   }
   ```
5. **No CSS change.** The global `:focus-visible` rule (`styles.css` line 131) covers `.floor-row` and `.act`, and `.alarm-extra` already lays out its buttons.

Loading feedback: the action is a synchronous local render. Focus lands at once. The 760 ms camera glide is an animation and doesn't block anything, so no busy state is needed.

Empty and error states: the button only renders when a rack target resolves, so it never leads nowhere. If the row is missing for some reason, focus falls back to the drawer, which has a visible focus ring from the first slice.

## Acceptance criteria

All criteria are checked in one new spec, `e2e/floor-alarm.spec.js`. Setup, following `alarm.spec.js`: use a 1440×900 viewport, go to `/#/floor` (site level, so the level change is exercised), sign in as `dsvs.operator`, and wait until `.alarm-chip` reads `/P1 · \d+/`. Steps marked "keyboard" use `page.keyboard`.

1. **The button is present only where it can work.**
   - Open the banner. Every `.alarm-row` contains at most one `[data-act="alarm-floor"]`, and at least one row has one.
   - Each one has accessible name `Show on floor · <asset>`, where `<asset>` is that row's `summary b` text.
   - `.alarm-list summary [data-act="alarm-floor"]` has count 0.
   - Go to `/#/sessions` and open the banner: `[data-act="alarm-floor"]` has count 0.
2. **The collapsed Tab order is unchanged.** With the banner open and every row collapsed, the first row's `[data-act="alarm-floor"]` is hidden. Rank 4's keyboard test in `alarm.spec.js` (summary, then response button, then second summary) passes unchanged.
3. **Reach it by keyboard.** Take the first row that has the button. Focus its summary and press Enter (keyboard) to expand it. Then press Tab (keyboard) at most 3 times until the row's `[data-act="alarm-floor"]` is `document.activeElement`. Its computed `outline-style` is not `none`.
4. **Enter opens the List on that rack's hall and focuses the rack's row.** Press Enter (keyboard). Then:
   - `.hud-mission` matches `/Hall \d+/`.
   - `#floor-list-toggle` has `aria-expanded="true"`.
   - `#floor-detail` is visible and contains an `h2` matching `/^Hall \d+$/`.
   - Exactly one `.rackbox.is-pulse` exists. Call its `data-rack` R.
   - `document.activeElement` matches `#floor-detail [data-act="floor-rack"][data-rack="R"]`.
   - The focused row has an accessible name matching `/^(Nominal|Rise|Hot|RDP|BMC) .*\d+ devices$/`.
   - Its computed `outline-style` is not `none`.
5. **The focused row is visible, and the page didn't scroll.** The focused row's bounding box lies within `#floor-detail`'s bounding box. `window.scrollY` and `.scene`'s `scrollTop` are the same as before the press.
6. **It also works when the floor is already at that hall.** Go back to the floor's hall level with the List closed (`#floor-list-toggle` `aria-expanded="false"`) and repeat steps 3 and 4. The drawer opens and focus lands on the `[data-rack="R"]` row, even though the level didn't change.
7. **One more Enter opens the rack, and focus survives the re-render.** With the row focused, press Enter (keyboard). `#floor-detail .crumbs` contains R. After `[data-act="rack-positions"]` is visible, which means `loadElevation()`'s async re-render has happened, `expect.poll` (about 1 s) shows `document.activeElement` is still `#floor-detail` or inside it.
8. **Escape closes it and returns focus to the List button.** Repeat step 4 from a fresh `/#/floor`, then press Escape (keyboard). `.inspector` has count 0, `#floor-list-toggle` has `aria-expanded="false"`, and `#floor-list-toggle` is `document.activeElement`.
9. **It doesn't ack.** After step 4, reopen the banner. The row whose button was used still has class `unacked` if it had it before.
10. **The summary and pointer behavior are unchanged.** `alarm.spec.js` passes unchanged, including "alarm chip focuses the rack and the action leaves the floor": clicking `summary b` pans the floor, pulses one `.rackbox`, opens the row, and doesn't open `#floor-detail`. `floor-list.spec.js`, `stage.spec.js`, `hall.spec.js`, and `fix-demo.spec.js` pass unchanged.
11. **The whole suite passes:** `npm test` in `prototypes/access-control` (`pretest` runs `vite build`), with no skipped or removed tests. The total diff is under about 300 lines.

## Files to touch

| file | change | est. lines |
|---|---|---:|
| `prototypes/access-control/src/views/floor.ts` | `floorAlarmRackId()`, `opts.list` in `focusFloorAlarm()` (list state, render condition, focus and drawer scroll) | ~20 |
| `prototypes/access-control/src/ui/alarms.ts` | import, **Show on floor** button in `.alarm-extra` | ~5 |
| `prototypes/access-control/src/ui/render.ts` | `alarm-floor` branch in `onClick` | ~4 |
| `prototypes/access-control/e2e/floor-alarm.spec.js` | new spec for the criteria above | ~110 |

That is about 140 lines in total. Don't touch `styles.css`, `state.ts`, `types.ts`, or `demo.ts`, and don't touch `dcim-hall-board`.

## Out of scope

- **The rest of rank 2** (see "What remains of rank 2 after this slice"): focusable pods, aisles, feeds, and pipes; `.rackbox` Tab order and camera follow; keyboard pan, orbit, and placement; yard-located alarms; Show on floor from other views; returning focus to the alarm row; announcing the summary's camera move; general focus retention; a hall overview link; a live screen-reader pass.
- **Changing the `alarm-focus` summary.** It keeps expanding the row and moving the camera without moving focus, per rank 4.
- **Changing `goAlarm()`, `ackAlarm()`, alarm data, or `locateAlarm()`'s mapping.**
- **Mobile layout** of the drawer (the 390 px static `.inspector` order). The spec runs at 1440×900.
- **Done items, which must not regress:** rank 1, outlet confirmation (`docs/plans/2026-11-22.md`); rank 3, Operate/Plan sub-navigation (PR #44); rank 4, alarm banner actions (`docs/plans/2026-11-22-alarm.md`); rank 5, KVM console (`docs/plans/2026-11-22-kvm.md`); and rank 2's first slice, the floor List (`docs/plans/2026-11-22-floor.md`).
