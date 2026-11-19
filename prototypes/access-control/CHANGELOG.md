# Changelog

## 2026-11-19

Hall build schedule (Plan › Halls, `#/halls`):

- A Gantt-style schedule with one row per hall and one bar per phase, from Field and Pad
  through Empty shell, Power and cooling, Racks set and Commissioning to Live. Each row
  lists its shell and live dates.
- A line marks the plan date chosen on the campus timeline. Each hall shows the phase it
  is in on that day, and the header counts how many halls are live.
- Click a phase to open that hall's timeline on the phase's first day. Click a hall name
  to open it on the current plan date.

Hall build timeline (Plan › Campus):

- Click any hall on the campus build scene, or pick it from the new Hall timeline row
  under the scene, to open that hall's own timeline on the same date. `#/plan/<hall>`
  links straight to it.
- The hall has its own phase bar: Field, Pad, Empty shell, Power and cooling, Racks set,
  Commissioning, Live. A top-down floor plan fills in as the date moves. Busway, CDUs and
  containment appear first, then racks are set row by row, and they turn green when the
  hall goes live. A count shows how many racks are set.
- The calendar moves both views. "← Campus" goes back, and a live hall has Open live hall.
- Clicking a hall in the build scene used to do nothing, because the scene took the
  click for orbiting. It now opens the hall.
- Halls 6–8 now appear as shells from 1 Jul 2027 instead of jumping straight from pad to
  live on 16 Aug, so their fit-out has room on the timeline.

New Fleet view (Operate › Fleet, `#/fleet`), the first slice of the fleet summary:

- One row per hall with its open alarms and worst priority, IT power against the hall's
  capacity, power headroom, and how many racks are critical or near capacity.
- Tiles across the top total the campus: halls, open alarms, IT load, critical racks.
- Alarm counts match the alarm banner exactly; each alarm is counted in the hall it is in.
- Each hall name opens that hall on the floor. Readings update with the live simulation.

New MP1000 KVM demo, on the sign-in screen and in the Lab drawer:

- A guided tour of how an operator reaches any server through the MP1000 management
  platform. It shows Hall 1 and its RM1048 rack managers, then the MP1000 device list. The
  operator opens a maintenance window for rack A14, picks GPU Tray 02, and launches KVM.
  MP1000 brokers the session through rack A14's RM1048 to the tray's BMC graphical
  console. The HTML5 viewer shows the OS, then BIOS from the same session. The audit
  log shows the request and the session.
- Operate › Sessions now has an MP1000 devices panel. Each row has Launch KVM. A dark BMC
  or RM1048 plane disables the button and points to ACS KVM.
- MP1000 launches go through the same console check as every other launch. Without a
  maintenance window or an in-progress work order, the launch is refused.

Navigation fixes, found by crawling every route and navigation control as all three
roles on desktop and iPhone widths:

- Clicking a link or pasting a URL could be ignored. If the page re-rendered in the
  moment before the app read the new address, it wrote the old page back over it.
  The router now leaves a changed address alone until it has applied it.
- Broken links now land on the nearest real page with a note that says why, instead
  of keeping a dead address: an unknown page goes to the floor, an unknown hall to
  the hall view, an unknown rack to its hall, an unknown device to its rack, and a
  closed session to the session list.
- An unknown rack no longer fires two failing lookups at the server.
- Simulate and Manage now mark where you are in the side navigation.

New AI fix demo, on the sign-in screen and in the Lab drawer:

- GPU Tray 05 reboots after a BIOS update and stops at the UEFI shell. acs.watch
  reads the console and raises a P1. The alarm opens an ACS serial session. The
  analyzer runs a read-only `bcfg boot dump`, finds the boot order was reset, and
  runs runbook RB-UEFI-01 (move Ubuntu first, reset). The tray boots, acs.watch logs
  in, and the alarm clears. Every step is in the audit log with who ran it.
- Outside the demo, an operator can run the same check and fix from the session's
  Explain panel. Read only sees the diagnosis but cannot send commands.
- The runbook changes only the boot order over serial. It never touches outlet power.

## 2026-11-18

- `serve.py` falls back to IPv4 when IPv6 is unavailable, so the preview server and the
  Playwright suite run on Linux CI machines and cloud runners as well as macOS.
- Added `DAILY_IMPROVEMENT.md`, the priority list for the daily improvement task.
