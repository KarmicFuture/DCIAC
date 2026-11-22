# Changelog

## 2026-11-22

Each grid's drawer opens its own feeder. Feeder A returns to grid 1, and Feeder B returns to grid 2.

The floor List has Feeder A and Feeder B. Enter opens that utility feeder and an Open the grid button, and focus stays in the panel.

Show on floor is in the alarm banner on every screen. Enter opens the floor List on that rack's hall, and Back returns to the screen you left.

The Yard list includes Supply piping and Return piping. Enter opens that pipe's details, and focus stays in the panel.

The hall List has an Open Hall overview button. It opens that hall's rows, racks, infrastructure, and nearing-capacity list, and focus stays in the panel.

Each expanded floor alarm has a Show on floor button. It opens the List on that rack's hall and puts focus on the rack's row.

The floor view has a List button. Outside, it opens the halls. In a hall, it opens the racks, power and cooling, and the watch list. Focus stays in that panel while you drill in.

The KVM console is named for the device and screen it drives. The instructions say to Tab in and type, and the echo reads "Typed: nothing yet" until a key is sent.

Alarm responses are their own buttons, beside the row that expands the details. Each one is named with the asset, and the banner chip reads its priority and count.

Outlet confirmation keeps the keyboard inside the dialog. Focus starts on the first field (or Cancel), Tab stays in the card, Escape cancels, and the page behind the dialog is inert until the operator confirms or cancels. Focus returns to the button that opened it.

Demo paths use the screen names from the headings. The sign-in tours and their captions say `Operate · Fleet`, `Operate · Rack`, `Operate · Sessions`, `Operate · Control`, `Operate · One-line`, `Plan · Campus`, `Plan · Halls`, and `Plan · DCIM` for the screens they open.

## 2026-11-20

Fleet rack drill-down (Operate › Fleet, `#/fleet`):

- Each hall row has a "Show racks" button. It lists the hall's racks with open alarms
  (count and worst priority), IT power against the rack's budget, and heat (Normal, Near
  limit, Critical, BMC dark).
- Sort the racks by Power (highest first, the default) or Alarms (alarmed racks first,
  worst priority first). Per-rack alarm counts add up to the hall's count.
- Each rack name opens that rack on the floor in the 3D rack view.
- The Full demo's Fleet step opens Hall 1's racks sorted by alarms, so A14 is on top.
- This finishes priority 2 in `DAILY_IMPROVEMENT.md`.

Demos, simulations, and usability brought up to date with the new views. Every demo, Lab
walk, simulator event, and main view was crawled on desktop and iPhone widths.

- Full demo (now 21 steps) shows the new work:
  - Fleet.
  - The 3D rack from the rear with its rack PDUs.
  - The device view marking ACS serial as the best way in when Tray 06's BMC goes dark.
  - The one-line on a build date.
  - Hall 5 being racked.
  - The all-halls build schedule.
  Stopping the demo puts the build views back.
- AI fix demo: when Tray 05 stops at the UEFI shell, the spotlight is on its device view.
  SSH and RDP show "No OS running", and ACS serial stays the best way in.
- Executive briefing: "The rack" now describes the 3D rack, its PDUs, and the device view.
- Fleet follows the simulator. A hall on a failed or at-risk feed is flagged "Power lost"
  or "At risk", and the page shows the simulation summary.
- The device panel puts the name, the fault, and the ways in first, ahead of the faces and
  thermals. The floor inspector no longer repeats the RDP buttons the device view already has,
  and its table fits the narrow panel.
- Rack links match clicks. `#/floor/<hall>/<rack>` opens the 3D rack view with the
  details open, and so does a device link. The U positions editor moved to
  `#/floor/<hall>/<rack>/u`, opens in 2D, and has a "Back to the rack view" button.
- One name for the KVM: "MPU2 KVM" and "MPU2 port" everywhere, replacing "ACS KVM" and
  "MPU port".
- `DAILY_IMPROVEMENT.md` now asks every change to update the demos to match.

Device view by device type (Operate › Rack device panel, and the floor device panel):

- Every device opens a view built for its type: a GPU tray, a switch, a power shelf, or
  a server. Its ports are drawn by role: serial, KVM, management, host LAN, data, and
  power. Port lists follow the vendor documentation: GB200 NVL72 compute tray, SN2201,
  ORv3 power shelf, and a 2U server like the PowerEdge R760.
- Ports that are cabled show where they go: the serial console to its ACS-A14 port and
  ttyS line, and video plus USB to its MPU2 port.
- A "Ways in" table lists every path, out of band (ACS serial, MPU2 KVM, BMC) and in
  band (SSH, RDP, or the shelf controller). Each path has its state and a button, and
  the best out-of-band and best in-band paths are marked. The best path updates live.
  A dark BMC is held. With no operating system, SSH and RDP show "No OS running" and
  nothing in band is marked best. A dropped RDP offers the MPU2 KVM failover.
- A switch shows its 48 RJ45 and 4 QSFP28 ports and says plainly that it has no KVM,
  BMC, or RDP. A power shelf shows its six PSUs and its shelf controller.
- The same view appears in Operate › Rack and on the floor. Buttons go through the
  same session and console checks as before.

One rack view (Floor › hall › click a rack, and Operate › Rack):

- Clicking a rack on the floor now opens the same 3D rack as Operate › Rack, instead of
  the flat cabinet. That includes the Front, Angle, Side and Rear views, the rack PDUs on
  the rear rails, the legend, and the Rack PDU A14 table. Rack details, power path and
  "Break this" stay in the panel on the right. Picking a device in the rack shows its
  details there, and the rack stays in 3D.
- Both places, and the U positions 3D view, now draw from one shared rack view, so
  they stay the same. Operate › Rack now also shows both of rack A14's rPDUs from the
  asset repository. rPDU-A carries the live outlets.
- Racks with nothing in the asset repository show their simulated servers.
- `DAILY_IMPROVEMENT.md` now has a rule that the two rack views stay one view.
- Both rack views rotate freely. Drag the rack with a mouse or finger to turn it, tilting
  from about 60° above to 15° below. You can also focus the rack and use the arrow keys.
  Front, Angle, Side and Rear still snap to set views. The angle carries between the two
  views, and dragging across a device turns the rack without opening the device.

## 2026-11-19

Floor rack drill-down in 3D with rack PDUs (Floor › hall › rack):

- Opening a rack from the floor now shows it in 3D, using the same rack view as
  Operate › Rack (Front, Angle, Side, Rear). Every mounted device from the asset
  repository sits at its U and opens the server when clicked.
- The rack's 0U rack PDUs from the repository sit on the rear rails with all their
  ports. On rack A14, rPDU-A shows the live outlet state (On, Off, Cycling, Locked by
  the DI-1 leak), and a lit socket opens Control on that outlet. Other racks show their
  PDU ports without live readings.
- A 2D button brings back the editable elevation for moving devices, front and rear
  faces, and PNG or PDF export. The rack details panel is unchanged.
- Vendor names in repository model names are left off the 3D labels.
- Fixed a flaky floor drag test. It sent a click before the drag had finished
  swallowing its own click, and failed about one run in twelve.

Rack A14 in 3D with its rack PDU (Operate › Rack):

- The flat cabinet is now a 3D rack with Front, Angle, Side, and Rear views. Every device
  sits at its U as a box with a front bezel and a rear label. Its status light matches the
  floor, and a device whose outlet is off is drawn dark.
- The vertical rack PDU is on the rear-right rail. Each of its 11 outlets shows a light for
  On, Off, Cycling, or Locked (the DI-1 leak lock on outlets 1 and 2). The selected
  device's outlet is outlined.
- A Rack PDU A14 table under the rack lists each outlet, its device, and its state.
- The PDU here is read only. Clicking a socket or an outlet opens Control on that outlet,
  where the role, leak interlock, and confirmation checks still apply.

Hall build schedule (Plan › Halls, `#/halls`):

- A Gantt-style schedule with one row per hall and one bar per phase, from Field and Pad
  through Empty shell, Power and cooling, Racks set and Commissioning to Live. Each row
  lists its shell and live dates.
- A line marks the plan date chosen on the campus timeline. Each hall shows the phase it
  is in on that day, and the header counts how many halls are live.
- Click a phase to open that hall's timeline on the phase's first day. Click a hall name
  to open it on the current plan date.

One-line build timeline (Operate › One-line › Build timeline):

- A Build timeline button switches the one-line to a plan date, with the same stage bar
  as Plan › Campus. Feeders, transformers, power modules, batteries, the MV bus and each
  hall's tap are drawn energized, built with no load, or dashed and faint if not yet built.
- Each hall's tap shows its build phase on that date (Pad, Empty shell, Racks set, and so
  on). Clicking a hall opens its hall timeline.
- The header counts feeders and power modules in, halls energized, and MW of IT.
  `#/oneline?build=2027-07-01` links to a date. Turning the button off shows the live
  one-line again.

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
