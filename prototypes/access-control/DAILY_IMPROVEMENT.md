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
- Build and publish the same way the repo already does: `npm run build`, then copy
  `dist/index.html` and `dist/assets/*` to the repository root, replacing the old
  hashed assets. Merging the pull request then updates the live site.
- Leave `data/unubtanium.sqlite` unchanged unless the improvement needs new seed data.
- Add a dated entry to `CHANGELOG.md` in this folder.
- If three or more daily pull requests are still open, skip the run instead of piling up more.

## Priorities (top first)

Pick the first item that is not done. Mark items done here in the same pull request.

1. Fix any failing test, console error, or broken layout on desktop or iPhone width.
2. Fleet view: a summary across halls and racks showing alarms, power, and capacity at a glance.
3. SLA and escalation timers on alarms, so it's clear how long each has been open and when it escalates.
4. Shift handover summary: what happened, what's still open, and what the next shift should watch.
5. Liquid-cooling telemetry: CDU supply and return temperatures, flow, and kW-per-rack budget.
6. Remote-hands dispatch: turn an alarm into a work order with steps and sign-off.
7. Mobile usability polish on the most-used views.
8. Accessibility: keyboard navigation, focus states, and color contrast.

When the list is exhausted, choose the improvement a data center manager would value
most and explain why in the pull request.
