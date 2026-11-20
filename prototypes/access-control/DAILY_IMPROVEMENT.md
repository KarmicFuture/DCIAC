# Daily improvement

A scheduled Claude task reads this file every morning. It makes one small, tested
improvement to DCIAC and opens a pull request. Nothing reaches the live site until
you merge the pull request.

Edit this file to steer the work. The task reads it from `main` each run.

## Rules

- Make exactly one focused improvement per run, about 200 changed lines or fewer.
- Add or update a test that proves the change (Playwright in `e2e/`, or Python in `server/`).
- All Python tests and all Playwright tests must pass before a pull request opens.
- Never weaken power-control confirmations, role permissions, leak or power interlocks,
  or the audit log unless a priority below explicitly asks for it.
- Do not add Vertiv or Avocent branding.
- Operate › Rack and the rack you open from the floor are one view. Both draw from
  `rackViewHtml` in `src/views/rack3d.ts`. Change the rack view there so they stay the same.
  Never fork one of them.
- When a change adds or alters something a user sees, update the demos to match: the
  Full demo, the AI fix demo, the MP1000 KVM demo, the Lab walks, and the executive
  briefing. Spotlight targets must point at elements that exist. `AccessDemo.tourBeatInfo()`
  reports the current beat's target.
- Build and publish the same way the repo already does: `npm run build`, then copy
  `dist/index.html` and `dist/assets/*` to the repository root, replacing the old
  hashed assets. Merging the pull request then updates the live site.
- Leave `data/unubtanium.sqlite` unchanged unless the improvement needs new seed data.
- Add a dated entry to `CHANGELOG.md` in this folder.
- If three or more daily pull requests are still open, skip the run instead of piling up more.

## How fixes are decided

Each run works like hospital triage: urgent problems first, then scheduled work,
then optional work chosen by value for effort. Go through the steps in order and
stop at the first one that produces a candidate.

### Step 1: Find problems

Before choosing anything, check the app's health:

- Build errors and warnings from `npm run build`
- Failing Python or Playwright tests
- Browser console errors while the tests run
- A quick visual check of the main views at desktop width (1440 px) and iPhone width
  (390 px): page headings above the fold, nothing overlapping or cut off

### Step 2: Must-fix (always first, in this order)

1. The build fails, or a test that passed before now fails.
2. Safety behavior is wrong: power-control confirmations, role permissions, leak or
   power interlocks, or the audit log don't work as designed. Fix only to restore the
   intended behavior; never loosen it.
3. Console errors or crashes in a main view.
4. Layout regressions: content pushed below the fold, overlap, or broken on iPhone width.

If several must-fix problems exist, take the highest one. If it's too big for one
run, fix the part that restores working behavior and list the rest under follow-ups.

### Step 3: The priority list

With nothing to fix, take the first unfinished item in the priority list below.
If it's bigger than one run allows, ship the smallest slice that a user can see and a
test can prove (for example, a fleet view that lists halls with alarm counts before
adding power and capacity). Leave the item open and note what remains.

### Step 4: Scoring (when the list is done, or to choose between candidates)

Score each candidate and take the highest:

**Score = Impact × Confidence ÷ Size**

| Factor | 1 | 2 | 3 |
|---|---|---|---|
| Impact: how much it helps a data center manager do the job | Nice to have | Saves time or prevents confusion | Prevents an outage, missed alarm, or unsafe action |
| Confidence: how well a test can prove it works | Hard to test | Partly testable | Fully testable |
| Size: how much code it touches | Under 75 lines | 75 to 150 lines | 150 to 200 lines |

A score of 9 (high impact, fully testable, small) beats everything; ties go to the
smaller change.

### Disqualifiers (skip these, whatever the score)

- It duplicates a daily pull request that's still open.
- It needs outside services, accounts, or API keys.
- It changes how existing data is stored in a way old data can't load.
- It loosens safety behavior, or adds Vertiv or Avocent branding.
- It needs a product decision from Vinu (naming, direction, scope). Don't build it;
  list it under "Questions for Vinu" in the pull request instead.

### Explain the choice

Every pull request includes a "Why this one" section: which step produced the choice,
the other candidates considered with their scores, and why this one won.

## Priorities (top first)

Mark items done here in the same pull request that finishes them.

1. Fix any failing test, console error, or broken layout on desktop or iPhone width.
2. Fleet view: a summary across halls and racks showing alarms, power, and capacity at a glance.
   *In progress.* Shipped 2026-11-19: Operate › Fleet (`#/fleet`) lists every hall with open
   alarms, IT power, headroom, and hot-rack counts. Still to do: a per-rack drill-down list
   (sortable by power or alarms) inside each hall row.
3. SLA and escalation timers on alarms, so it's clear how long each has been open and when it escalates.
4. Shift handover summary: what happened, what's still open, and what the next shift should watch.
5. Liquid-cooling telemetry: CDU supply and return temperatures, flow, and kW-per-rack budget.
6. Remote-hands dispatch: turn an alarm into a work order with steps and sign-off.
7. Mobile usability polish on the most-used views.
8. Accessibility: keyboard navigation, focus states, and color contrast.

When the list is exhausted, use the scoring in Step 4.
