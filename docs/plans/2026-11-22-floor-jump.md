# Plan · 2026-11-22 · Floor: Show on floor from every signed-in screen

Branch: `ux/2026-11-21-cycle`  
Backlog item: **rank 2** in `docs/ux-backlog.md`, fifth slice. The floor/site view depends on pointer picking and non-focusable floor targets, so keyboard and assistive-tech users can't reliably open halls, racks, servers, or alarm targets (WCAG 2.1.1, 4.1.2). Severity 4, effort L. Already shipped: the keyboard **List** drawer (`docs/plans/2026-11-22-floor.md`), **Show on floor** opening that List on the alarming rack (`docs/plans/2026-11-22-floor-alarm.md`), **Open Hall N overview** (`docs/plans/2026-11-22-floor-hall.md`), and Supply/Return piping in the Yard list (`docs/plans/2026-11-22-floor-pipes.md`, commit `718c42f`). Rank 2 stays **open** after this slice.

## Why this slice

- **The alarm banner is on every signed-in screen, but its keyboard route to the floor only exists on one of them.** `paint()` (`src/ui/render.ts` line 300) renders `alarmBanner()` on every view. In `src/ui/alarms.ts` line 173 the **Show on floor** button is gated on `state.view === "floor" && floorAlarmRackId(alarm)`. An operator who sees a P1 on Sessions, Rack, Control, or Fleet has no keyboard way to reach that rack on the floor. The other way in is the `alarm-focus` summary, and that only moves the camera on Floor (`render.ts` lines 581–586). Even if the button were rendered, `focusFloorAlarm()` (`src/views/floor.ts` line 572) returns straight away when `state.view !== "floor"`.
- **The whole landing already exists.** With `opts.list`, `focusFloorAlarm()` sets `level = "hall"`, `podId`, `rackId`, and `rowId`, sets `floorListOpen = true`, aims the camera, arms the pulse, calls `render()` (which is synchronous, see `src/ui/schedule.ts`), focuses the rack's `floor-rack` row in `#floor-detail`, and scrolls the drawer so the row is visible. The only thing missing is switching the view to `floor` first.
- **The hash needs no new code.** `paint()` ends with `syncHash()` (`render.ts` line 313). For `view === "floor"` and `level === "hall"`, `routeFromState()` (`src/domain/route.ts` line 215) returns `#/floor/hall`. `syncHash()` assigns `location.hash`, which pushes a history entry, so the browser's Back button returns to the screen you came from. The `hashchange` that follows matches `routeFromState()` and `onHashChange()` (line 277) does nothing.
- **Testable on every run.** The `watch-*`, `inlet-*`, and `recirc-*` alarms come from seeded devices that have a rack, so `floorAlarmRackId()` is non-empty for at least one alarm on any screen. The existing `floor-alarm.spec.js` already depends on this. Yard alarms are **not** part of this slice, because nothing seeds one (`neighbors` is empty, and plant alarms are devices and outlets).
- **Estimate:** about 8 changed source lines, about 110 lines in the new spec, and a 1–3 line edit to the existing spec. Roughly 120 lines in total.

## What remains of rank 2 after this slice

- Pod plates (`.pod[data-act="floor-pod"]`) and aisle bands (`.aisle[data-act="floor-server"]`) in the 3D world are still clickable `div`s that aren't focusable.
- Feeds and pipes in the 3D world (`feedHtml`, `pipeHtml`) are still `aria-hidden` and pointer-only. Pipes are reachable from the Yard list, but the 3D targets themselves aren't.
- `.rackbox` Tab order follows DOM order, the camera doesn't follow focus, a focused box can be off-stage, and there are 20 or more tab stops before the drawer.
- Pan, orbit, and drag-to-place are pointer-only. A new library item can only be placed by dragging.
- **Show on floor** for yard-located alarms. It needs a seeded yard alarm first.
- Returning focus to the alarm row after the drawer is closed. Escape still returns focus to `#floor-list-toggle`.
- The `alarm-focus` summary still moves the camera without announcing anything to assistive tech, and it still only moves the camera on Floor.
- Focus is still lost on re-render everywhere outside the floor drawer.
- Nobody has done a live screen-reader pass (VoiceOver, NVDA) of the floor.

## Problem (today, from the code)

1. **The button disappears off Floor.** On `/#/sessions`, `/#/rack/...`, `/#/control`, `/#/fleet`, and every other signed-in view, an expanded alarm row shows only **Ack**, **Explain**, and the response button (for example `Open serial`). `e2e/floor-alarm.spec.js` line 90 asserts there are zero `[data-act="alarm-floor"]` buttons on `/#/sessions`.
2. **The handler would refuse anyway.** `focusFloorAlarm()` starts with `if (state.view !== "floor" || !alarm) return;`.
3. **The keyboard detour is long.** You have to leave the alarm, go to Floor through the rail, open the alarm chip again, expand the same row, and Tab to the button. Nothing on the other screens says this route exists.

## User story

As a keyboard or screen-reader operator who sees a rack alarm in the banner while I'm on Sessions (or any other screen), I want the expanded alarm to offer **Show on floor**. Pressing it should take me to the floor with the List open on that rack's hall and focus on the rack's row, exactly as if I had pressed it on Floor. The address should become `#/floor/hall` so the browser's Back button returns me to where I was.

## Change (for the builder)

Keep `aria-label="Show on floor · " + esc(alarm.asset)` and the visible text `Show on floor`. The button stays inside `.alarm-extra`, a sibling of the `Explain` details, and never inside a `<summary>`. Don't change the `alarm-focus` summary, Escape handling, the pulse, the camera, `routeFromState()`, `syncHash()`, or `demo.ts` (no demo caption says Show on floor is Floor-only).

1. **Render on every view** (`src/ui/alarms.ts` line 173). Drop the view check:
   ```ts
   (floorAlarmRackId(alarm)
   ```
   in place of
   ```ts
   (state.view === "floor" && floorAlarmRackId(alarm)
   ```
   `state` is still used elsewhere in the file, so the import stays.
2. **Let the list jump switch views** (`src/views/floor.ts` `focusFloorAlarm()`, lines 572–576). Replace the first line, and switch the view after the rack/yard checks so a refused alarm never leaves the current screen:
   ```ts
   export function focusFloorAlarm(alarm, opts: { list?: boolean } = {}) {
     if (!alarm) return;
     if (state.view !== "floor" && !opts.list) return;
     const place = locateAlarm(alarm);
     if (!place) return;
     if (opts.list && place.kind !== "rack") return;
     if (state.view !== "floor") {
       state.view = "floor";
       state.toast = "";
       state.menuOpen = false;
     }
     if (runtime.walk) stopWalk(false, false);
     // ...rest unchanged
   ```
   The three assignments mirror `go()` in `src/ui/shell.ts`. Don't import `go()`, because it calls `render()` before the floor state is set. The existing `if (!same || opts.list) render();` already forces the render. `paint()` sees the view change, scrolls the window to the top, and `syncHash()` writes `#/floor/hall`. Then the existing code focuses the `floor-rack` row and scrolls the drawer.
3. **No change to `render.ts`.** The `alarm-floor` branch (lines 587–590) already calls `focusFloorAlarm(alarm, { list: true })` on any view. The `alarm-focus` branch keeps its own `state.view === "floor"` guard, and step 2 keeps the same guard inside `focusFloorAlarm()` for calls without `list`.
4. **No CSS change.** `.act` already has the global `:focus-visible` ring, and the drawer rows have theirs from the first slice.
5. **Update the one old assertion.** In `e2e/floor-alarm.spec.js` test "Show on floor button presence and naming", replace line 90
   ```js
   await expect(page.locator('[data-act="alarm-floor"]')).toHaveCount(0);
   ```
   with an assertion that on `/#/sessions` there is at least one `[data-act="alarm-floor"]` and none inside a `summary` (`.alarm-list summary [data-act="alarm-floor"]` has count 0). Don't change any other line of that spec. It must keep passing as it is.

Loading feedback: the jump is a synchronous local render followed by the existing camera glide, so there's no wait over 300 ms. There's no empty state to add, because the button only renders when `floorAlarmRackId(alarm)` is non-empty, and the hall List already handles its own empty sections.

## Acceptance criteria

All criteria are checked in one new spec, `e2e/floor-alarm-jump.spec.js`. Setup: use a 1440×900 viewport, go to `/#/sessions`, sign in as `dsvs.operator` (`[data-user="dsvs.operator"]`), and wait until `#app` doesn't contain "Loading the asset repository". Don't visit a floor route first. The alarm chip (`.alarm-chip`, text `/P1 · \d+/`) is already in the banner. Steps marked "keyboard" use `page.keyboard`. "The rack row" means the first `.alarm-row` that has `[data-act="alarm-floor"]`.

1. **The button renders off Floor, named and placed as before.**
   - `.shell` has `data-view="sessions"`.
   - After `.alarm-chip` is opened, every `.alarm-list > .alarm-row` has at most one `[data-act="alarm-floor"]`, and at least one row has one.
   - Each one is a `<button>` with visible text `Show on floor` and `aria-label` equal to `"Show on floor · " + <that row's summary b text>`.
   - `.alarm-list summary [data-act="alarm-floor"]` has count 0, and each button's parent is `.alarm-extra`.
2. **Reach it by keyboard.** Focus the rack row's `summary[data-act="alarm-focus"]` and press Enter (keyboard). The button becomes visible. Press Tab (keyboard) at most 4 times until it is `document.activeElement`. Its computed `outline-style` is not `none`.
3. **Enter lands on the floor exactly as it does from Floor.** Press Enter (keyboard). Then:
   - `.shell` has `data-view="floor"`.
   - `.rackbox.is-pulse` has count 1. Call its `data-rack` value `rackId`.
   - `.hud-mission` matches `/Hall \d+/`.
   - `#floor-list-toggle` has `aria-expanded="true"`, and `#floor-detail` is visible with an h2 matching `/^Hall \d+$/`.
   - `#floor-detail [data-act="floor-rack"][data-rack="<rackId>"]` is focused (poll for about 1 s), its accessible name matches `/^(Nominal|Rise|Hot|RDP|BMC) .*\d+ devices$/`, its computed `outline-style` is not `none`, and its bounding box is inside the drawer's bounding box.
   - The URL hash is `#/floor/hall`, which is what `routeFromState()` already writes for this state.
4. **Same rack as from Floor.** Go to `/#/floor/hall`, press Escape if `.inspector` is present, open `.alarm-chip`, and activate the rack row's Show on floor (repeat step 2 and the first part of step 3). The pulsed `data-rack` equals `rackId` from step 3.
5. **Escape is unchanged.** Right after a jump from `/#/sessions` (steps 2 and 3), press Escape (keyboard). `.inspector` has count 0, `#floor-list-toggle` has `aria-expanded="false"`, and `#floor-list-toggle` is `document.activeElement`.
6. **Back returns to the screen you came from.** After a jump from `/#/sessions`, call `page.goBack()`. `.shell` has `data-view="sessions"` and the hash is `#/sessions`.
7. **It isn't an ack.** If the rack row had class `unacked` before the jump, then after the jump, reopening `.alarm-chip` shows the row with that alarm's `data-alarm` still has class `unacked`.
8. **Another screen works too.** Go to `/#/fleet`, open `.alarm-chip`, and activate the rack row's Show on floor by keyboard (steps 2 and 3). `.shell` has `data-view="floor"`, the rack row is focused in `#floor-detail`, and the hash is `#/floor/hall`.
9. **Existing specs pass.** `floor-alarm.spec.js` passes with only the one assertion from Change step 5 replaced. These pass unchanged: `alarm.spec.js`, `floor-list.spec.js`, `floor-hall.spec.js`, `floor-pipes.spec.js`, `stage.spec.js`, `hall.spec.js`, `floor-drag.spec.js`, `floor-rack3d.spec.js`, `lod.spec.js`, the KVM, outlet, and sub-navigation specs, and the demo specs.
10. **The whole suite passes:** `npm test` in `prototypes/access-control` (`pretest` runs `vite build`), with no skipped or removed tests. The product change is about 8 lines, and the whole diff is well under about 300 lines.

## Files to touch

| file | change | est. lines |
|---|---|---:|
| `prototypes/access-control/src/ui/alarms.ts` | drop `state.view === "floor" &&` from the Show on floor condition | ~1 |
| `prototypes/access-control/src/views/floor.ts` | `focusFloorAlarm()`: allow `opts.list` off Floor and switch the view after the rack check | ~7 |
| `prototypes/access-control/e2e/floor-alarm.spec.js` | replace the one zero-count assertion on `/#/sessions` | ~2 |
| `prototypes/access-control/e2e/floor-alarm-jump.spec.js` | new spec for the criteria above | ~110 |

That is about 120 lines in total. Don't touch `render.ts`, `route.ts`, `shell.ts`, `styles.css`, `state.ts`, `types.ts`, `demo.ts`, or `CHANGELOG.md`, and don't touch `dcim-hall-board`.

## Out of scope

- **Yard alarms.** No yard alarm is seeded, and this slice doesn't invent one (no fake heat fault). `focusFloorAlarm(..., { list: true })` still returns early for `place.kind !== "rack"`, and it does so before switching views.
- **The `alarm-focus` summary off Floor.** Expanding a summary on Sessions still only expands it. It doesn't move the camera or change the screen.
- **Announcing the camera move** or the screen change to assistive tech. The focused rack row's accessible name is the only cue, as on Floor today.
- **Focus changes.** Escape still returns to `#floor-list-toggle`, not the alarm row. 3D targets stay unfocusable.
- **New routes or hash formats.** The hash is whatever `routeFromState()` already writes for `view = "floor"`, `level = "hall"`.
- **Mobile layout** of the banner or drawer. The spec runs at 1440×900.
- **Done items, which must not regress:** rank 1, outlet confirmation (`docs/plans/2026-11-22.md`); rank 3, Operate/Plan sub-navigation (PR #44); rank 4, alarm banner actions (`docs/plans/2026-11-22-alarm.md`); rank 5, KVM console (`docs/plans/2026-11-22-kvm.md`); and rank 2's earlier slices: the floor List, Show on floor on Floor, the hall overview, and yard pipes.
