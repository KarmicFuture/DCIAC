# Plan · 2026-11-22 · Floor: keyboard Orbit buttons

Branch: `ux/2026-11-21-cycle`  
Backlog item: **rank 2** in `docs/ux-backlog.md`, ninth slice. The floor/site view depends on pointer picking, dragging, and non-focusable or `aria-hidden` floor targets, so keyboard and assistive-tech users can't reliably open halls, racks, servers, or alarm targets (WCAG 2.1.1, 4.1.2). Severity 4, effort L. Already shipped: the keyboard **List** drawer (`docs/plans/2026-11-22-floor.md`), **Show on floor** on the Floor view (`docs/plans/2026-11-22-floor-alarm.md`), **Open Hall N overview** (`docs/plans/2026-11-22-floor-hall.md`), yard pipes in the list (`docs/plans/2026-11-22-floor-pipes.md`), **Show on floor** from every signed-in screen (`docs/plans/2026-11-22-floor-jump.md`, commit `983ac38`), **Feeder A** and **Feeder B** in the site list (`docs/plans/2026-11-22-floor-feeds.md`, commit `0426282`), the Grid drawer opening its own feeder (`docs/plans/2026-11-22-floor-grid.md`, commit `d5fcab7`), and keyboard **Pan** buttons (`docs/plans/2026-11-22-floor-pan.md`, commit `33a22f9`).

## Why this slice

- **Orbit is the last pointer-only camera control.** The Pan plan listed it first under "What remains". `onPointerMove` (`src/views/floor.ts` line ~412) is the only thing that changes the floor camera's angle: `state.floor.yaw += dx * 0.45` and `state.floor.pitch = clamp(state.floor.pitch - dy * 0.28, 16, 84)`. Dragging right increases yaw, and dragging up (negative `dy`) increases pitch. A keyboard user can pan and zoom but can't turn the hall to see behind a row or look more top-down.
- **Everything it needs already exists.** `cameraTransform()` (line 97) emits `rotateX(<pitch>deg) rotateZ(<yaw>deg)`. `applyCamera()` (line 109) writes it to `.world` `style.transform` (plus `--pitch` / `--yaw`) without a render, so focus stays on the button. `panFloor()` (line 1995) is the exact pattern to copy. `zoomFloor("reset")` (line 1974) already restores pitch 56 and yaw -40, so **Reset view** also undoes orbit.
- **No CSS.** `.zoom-cluster` already styles a button row, and the global `:focus-visible` rule covers buttons.
- **Always testable.** The result is a string on `.world` `style.transform`, with no timing, picking, or 3D geometry involved.
- **Estimate:** about 30 lines across `floor.ts` and `render.ts`, plus about 100 lines in one new spec, roughly 130 lines in total.

## What remains of rank 2 after this slice

- Drag-to-place is pointer-only. A new library item can only be placed by dragging.
- Chassis (rack/server scene) orbit stays pointer-only. There are no chassis orbit buttons.
- Pod plates (`.pod[data-act="floor-pod"]`) and aisle bands (`.aisle[data-act="floor-server"]`) in the 3D world are still clickable `div`s that aren't focusable. The list routes reach the same content.
- All 3D `.feed` and `.pipe` segments stay `aria-hidden` and pointer-only. The other site feeds (`xfmr-mod-a/b`, `mod-c`, `mod-d`, `batt-a/b`, `mod-bus`, `mod-bus-b`, `mod-riser`, `feed-hall-*`) and the hall feeds (`bus-*`, `whip-*`) aren't in the site list.
- `.rackbox` Tab order follows DOM order, the camera doesn't follow focus, a focused box can be off-stage, and there are 20 or more tab stops before the drawer.
- Camera moves (pan, orbit, zoom, `alarm-focus`) aren't announced to assistive tech.
- Returning focus to the alarm row after the drawer is closed.
- Focus is still lost on re-render everywhere outside the floor drawer.
- After a list item opens, focus lands on the drawer itself, not on its heading.
- The Grid drawer paragraph is the same for both grids, and the unused `grid-xfmr` branch in `feedPanel()` stays.
- Nobody has done a live screen-reader pass (VoiceOver, NVDA) of the floor.

## Problem (today, from the code)

1. **No keyboard orbit.** `pitch` / `yaw` on the floor scene only change through pointer drag (`onPointerMove`) or the walk/briefing/route/login resets. A keyboard user can pan and zoom but can't change the viewing angle.
2. **Some content is only readable from another angle.** At the default pitch 56 / yaw -40, tall racks hide what's behind them. A pointer user drags to look; a keyboard user has no way to.

## User story

As a keyboard operator on the Floor view, I want **Orbit left**, **Orbit right**, **Orbit up**, and **Orbit down** buttons next to the Pan and Zoom buttons, so I can turn and tilt the hall or yard without a mouse, and keep my focus on the button while I press it repeatedly.

## Change (for the builder)

### 1. `prototypes/access-control/src/views/floor.ts` — `hudHtml()` (line 1052; HUD string at line 1068)

Insert an Orbit group **after** the Pan group and **before** the Zoom group. Reuse class `zoom-cluster`; don't add a new class or CSS:

```html
<div class="zoom-cluster" role="group" aria-label="Orbit">
  <button type="button" data-act="floor-orbit" data-dir="left" aria-label="Orbit left">↺</button>
  <button type="button" data-act="floor-orbit" data-dir="right" aria-label="Orbit right">↻</button>
  <button type="button" data-act="floor-orbit" data-dir="up" aria-label="Orbit up">⤒</button>
  <button type="button" data-act="floor-orbit" data-dir="down" aria-label="Orbit down">⤓</button>
</div>
```

(As one concatenated string in the same style as the Pan and Zoom groups; whitespace between tags is optional.) The accessible name is the `aria-label`; the glyphs are only a visual cue. Leave the Pan and Zoom groups exactly as they are.

### 2. `prototypes/access-control/src/views/floor.ts` — new `orbitFloor(dir)` immediately after `panFloor()` (line 1995)

```ts
export function orbitFloor(dir) {
  if (runtime.walk) stopWalk(false, false);
  if (dir === "left") state.floor.yaw -= 8;
  else if (dir === "right") state.floor.yaw += 8;
  else if (dir === "up") state.floor.pitch += 4;
  else if (dir === "down") state.floor.pitch -= 4;
  state.floor.pitch = clamp(state.floor.pitch, 16, 84);
  applyCamera();
}
```

Rules:

- Signature: `export function orbitFloor(dir: "left" | "right" | "up" | "down" | string | undefined): void` (untyped `dir` to match `panFloor(dir)`). An unknown `dir` only re-clamps pitch and re-applies; it doesn't throw.
- `left`: yaw −8. `right`: yaw +8. `up`: pitch +4. `down`: pitch −4. These match the pointer directions (drag right = yaw up, drag up = pitch up).
- Clamp pitch to 16..84 with the existing `clamp()` (same bounds as `onPointerMove`). **Don't clamp yaw** (the pointer path doesn't either).
- Call `applyCamera()` only. **Don't** call `render()`, so focus stays on the button.
- Don't change `panX`, `panY`, `zoom`, `chassisPitch`, `chassisYaw`, or `chassisZoom`.

### 3. `prototypes/access-control/src/ui/render.ts`

- Line 36: add `orbitFloor` to the existing `from "../views/floor"` import, next to `panFloor`.
- Line 580: right after the `floor-pan` branch, add:

```ts
  else if (act === "floor-orbit") orbitFloor(el.dataset.dir);
```

Don't change pointer drag (`onPointerDown` / `onPointerMove` / `onPointerUp`), the chassis orbit, `onWheel`, `panFloor`, or `zoomFloor`.

Loading feedback: `orbitFloor()` is a synchronous style write, so there's no wait over 300 ms. Empty and error states are unchanged. Labels come from `aria-label`; the focus ring comes from the global `:focus-visible` rule.

## Acceptance criteria

All criteria are checked in one new spec, `prototypes/access-control/e2e/floor-orbit.spec.js`. Setup matches `floor-pan.spec.js`: use a 1440×900 viewport, go to `/#/floor`, sign in as `dsvs.operator`, and wait until `#app` doesn't contain "Loading the asset repository". **Don't open the List.** Steps marked "keyboard" use `page.keyboard`. The `.world` transform starts with a `scale(<fit>)` from `applyCamera()`, so parse `rotateX(…deg)`, `rotateZ(…deg)`, and `translate(…)` out of the string rather than comparing whole strings where noted.

1. **The Orbit group is there, between Pan and Zoom.** `[role="group"][aria-label="Orbit"]` has count 1 and contains exactly four buttons with accessible names `Orbit left`, `Orbit right`, `Orbit up`, `Orbit down`, in that order. Page-wide, `[data-act="floor-orbit"]` has count 4. In DOM order, `[role="group"][aria-label="Pan"]` comes before the Orbit group, and the Orbit group comes before `[role="group"][aria-label="Zoom"]` (check with `compareDocumentPosition(...) & Node.DOCUMENT_POSITION_FOLLOWING`).
2. **Keyboard reaches Orbit left with a visible focus ring.** Focus the `Pan left` button, then press Tab (keyboard) at most 5 times until `document.activeElement` is the `Orbit left` button (expected: 4 presses). Its computed `outline-style` is not `none`.
3. **Enter orbits left and keeps focus.** Record `.world` `style.transform` as `before`; its `rotateZ` is `-40deg`. Press Enter (keyboard). Then:
   - The transform's `rotateZ` is `-48deg` (yaw moved by −8), i.e. it contains `rotateZ(-48deg)` or parses to −48.
   - The `translate(` portion equals the one in `before` (pan unchanged), and `rotateX` is still `56deg`.
   - `document.activeElement` is still the `Orbit left` button.
   - `.scene.walking` has count 0.
4. **Left then right cancels.** Move focus to `Orbit right` and press Enter (keyboard). The transform's `rotateZ` is back to `-40deg`.
5. **Up and down tilt within bounds.** Move focus to `Orbit up` and press Enter (keyboard). The transform contains `rotateX(60deg)`. Move focus to `Orbit down` and press Enter (keyboard). The transform contains `rotateX(56deg)`. After every step, the parsed `rotateX` is within 16..84. (Hammering the clamp isn't required.)
6. **Reset view undoes orbit.** Orbit once (e.g. `Orbit left`, keyboard Enter), then move focus to `[data-act="floor-zoom"][data-dir="reset"]` and press Enter (keyboard). The transform contains `rotateX(56deg)` and `rotateZ(-40deg)`. `[role="group"][aria-label="Zoom"]` and `[role="group"][aria-label="Pan"]` each still have count 1, and the Orbit group still has 4 buttons.
7. **Existing specs still pass unchanged:** `floor-pan.spec.js` in particular, plus `floor-grid.spec.js`, `floor-feeds.spec.js`, `floor-list.spec.js`, `floor-pipes.spec.js`, `floor-hall.spec.js`, `floor-alarm.spec.js`, `floor-alarm-jump.spec.js`, `floor-drag.spec.js`, `floor-rack3d.spec.js`, `stage.spec.js`, and `hall.spec.js`.
8. **The whole suite passes:** `npm test` in `prototypes/access-control` (`pretest` runs `vite build`), with no skipped or removed tests. The total diff is under about 150 lines (rule cap ~300).

## Files to touch

| file | change | est. lines |
|---|---|---:|
| `prototypes/access-control/src/views/floor.ts` | Orbit group in `hudHtml()`; new exported `orbitFloor(dir)` after `panFloor()` | ~12 |
| `prototypes/access-control/src/ui/render.ts` | import `orbitFloor`; one `floor-orbit` click branch | ~2 |
| `prototypes/access-control/e2e/floor-orbit.spec.js` | new spec for the criteria above | ~100 |

That is about 115–130 lines in total. Don't touch `styles.css`, `state.ts`, `types.ts`, `CHANGELOG`, `floor-pan.spec.js`, or other specs, and don't touch `dcim-hall-board`.

## Out of scope

- **The rest of rank 2** (see "What remains of rank 2 after this slice"). Rank 2 stays open.
- **Drag-to-place** for library items.
- **Chassis orbit buttons** (`chassisPitch` / `chassisYaw`) in the rack/server scene, and arrow-key shortcuts on the stage.
- **Making 3D targets focusable** or camera-follows-focus (pods, aisles, feeds, pipes, rack boxes).
- **Announcing the camera move** to assistive tech (live region).
- **Other site and hall feeds** in the list.
- **Returning focus to the alarm row** after the drawer closes.
- **Changing pointer drag, the pointer orbit path, wheel zoom, pan, or zoom.**
- **New CSS**, a new class, or restyling `.zoom-cluster`.
- **Mobile layout** of the HUD. The spec runs at 1440×900.
- **Done items, which must not regress:** ranks 1, 3, 4, and 5, and rank 2's earlier slices listed at the top.
