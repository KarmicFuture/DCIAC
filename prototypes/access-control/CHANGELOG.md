# Changelog

## 2026-11-19

New Fleet view (Operate › Fleet, `#/fleet`), the first slice of the fleet summary:

- One row per hall with its open alarms and worst priority, IT power against the hall's
  capacity, power headroom, and how many racks are critical or near capacity.
- Tiles across the top total the campus: halls, open alarms, IT load, critical racks.
- Alarm counts match the alarm banner exactly; each alarm is counted in the hall it is in.
- Each hall name opens that hall on the floor. Readings update with the live simulation.

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
