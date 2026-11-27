# Changelog

## 2026-11-27 (outlet policy on the server)

The server now holds two more of the web app's outlet rules. Outside a named maintenance window, `/api/v1/actions/outlet` refuses any action on Outlet 6, which feeds no device, and refuses whole-PDU control, with a 409 that says why (`"policy": "maintenance-window"`). A covering work order is not enough for either, the same as in the web app. A script or another platform can no longer cycle every outlet on rack PDU A14 with only a work order number.

- With the window open, both are allowed as before. Bound outlets with a covering work order are unaffected.
- Role checks and the DI-1 leak interlock still come first, and a refused action is never written to the audit log as done.
- A test checks that the server's outlet bindings match `src/data/outlets.ts`, so the two lists can't drift apart.
- Still in the web app only: RM1048 owns Control while a device's BMC is up. Next on the roadmap.

## 2026-11-27 (experimental, part 2)

Experimental now reaches every view.

- **Where the switch is:** every page heading (Operate, Plan, Audit, Manage, Simulate) has an **Experimental** button next to NOC theme. The floor and the rack opened from it keep their own buttons. It is one switch everywhere.
- **Dashboard views:** Control, Sessions, Port map, Fleet, Audit, Manage, Models, DCIM, and Simulate read as a dashboard.
  - A row of live tiles sits under the heading: open alarms (with the P1 count), IT load, outlets on, live sessions, and DI-1 leak state. Each tile opens its view, and a tile with a P1 alarm or a leak glows red.
  - The panels sit in a card grid. Tables and port grids span the full width.
- **Cards on every view:**
  - Cards are rounded, cast a layered shadow, and have a lit top edge.
  - Every card lifts toward you on hover or keyboard focus.
  - Small cards also lean a few degrees toward the pointer.
  - Cards that hold a 3D scene only lift their shadow, so dragging the scene stays steady.
  - Nothing tilts when reduced motion is set or on touch screens.
- **One-line in three.js:**
  - The diagram becomes a 3D board: a utility tower, the feeders, breakers, transformer coils, power modules, battery strings, the MV bus, and all ten halls, each labeled.
  - Moving light runs along every energized conductor. At-risk conductors and nodes pulse orange, and open or failed ones turn red and go dark, so a Simulate scenario shows on the board.
  - Click a node or a hall to open it on the floor, as on the standard diagram. The build timeline works too.

## 2026-11-27 (experimental)

Experimental is now one switch for every 3D view. Turn it on from the floor, the rack, or Plan, and Floor › Outside, the hall floor, the rack (in Operate and from the floor), and the Plan site scene all draw with three.js until you turn it off again.

- **Outside:** the halls, the power yard, the feeders, and the cooling pipes are drawn in 3D. Halls show lit windows. Power flows along the feeders as moving lights. Cool supply runs blue through the pipes and warm return runs orange. Cooler fans spin. A failed feeder or pipe in a Simulate scenario turns red and stops flowing, and the gear it hits glows red. Click a hall or a piece of yard gear to open it, as on the standard view.
- **Plan:** the site for the chosen build day, from grass field to 100 MW. Pads and shells are see-through until the hall is live. Click a hall to open its timeline.
- Both scenes are drawn from the standard scene itself, which stays in the page out of sight. They show the same halls, gear, and lines, and a click lands on the same control the standard scene uses.
- Walk through needs the standard floor, so it is hidden while Experimental is on.

## 2026-11-26 (experimental)

The hall floor has an **Experimental** button. It swaps the CSS floor for a live 3D hall drawn with three.js: dark racks with glowing fronts that use the usual alarm colors, aisles tinted hot and cold, the CDUs, and moving air. Warm particles rise off the hot aisle, and cool particles sink at the rack inlets and around the CDUs. The air comes from the same heat-cloud readings as Heat path, so a Simulate scenario changes it within two seconds. Racks with an alarm pulse, and priority 1 pulses fastest. Drag to orbit, scroll to zoom, hover a rack to see its name and state, and click a rack to open it. The view turns slowly until you touch it. It holds still when reduced motion is set. Pressing the button again brings the normal floor back.

- three.js loads only when someone turns Experimental on, in its own file, so the normal floor loads no slower.
- If the browser can't draw WebGL, the view says so instead of failing.

The rack view has the same **Experimental** button. It draws the rack with three.js from the same model as the 3D rack: each device at its U with a status LED, the selected device lit blue, and the rack PDU on the rear rail with every socket colored by state. Cycling sockets blink, and leak-locked sockets pulse red. Air flows through each powered device, cold at the front door and warm out the rear, faster on busier devices. Devices on an outlet that is off go dark and move no air. Front, Angle, Side and Rear still aim the camera. Clicking a device or a lit socket does what it does in the standard rack. Outlet changes still go to Control and its confirmations. Operate › Rack and the rack opened from the floor are one view, so the button works in both.

- The read-only PDU table stays under the 3D rack, as the keyboard route to the same outlets.
- Demos and tours turn the Experimental views off first, so their spotlights land on the standard floor and rack.

## 2026-11-26

The DI-1 leak interlock now holds on the server, not only in the web app. While DI-1 reports a leak, `/api/v1/actions/outlet` refuses to switch on or power-cycle Outlet 1 (GPU tray 01) or Outlet 2 (GPU tray 02), and refuses whole-PDU control, with a 409 that names the interlock. Shedding those outlets (off) is still allowed, and other outlets are unaffected. A script or another platform calling the API can no longer restart a tray that sits on a leaking cold-plate rope.

- The server reads DI-1 from its latest reading (`/api/v1/collect` or `/api/v1/metrics`, device `di-1`, metric `leak`). A reading of 0 releases the interlock.
- Lab › Post readings now always sends DI-1, so a quiet DI-1 clears the server's interlock.
- Role checks still come first, and a refused action is never written to the audit log as done.
- Still in the web app only: the rest of the outlet policy (RM1048 ownership while a BMC is up, unbound outlets). Next on the roadmap.

## 2026-11-25

Heat path is now a heat map. Turning it on opens the hall floor with soft, drifting clouds of heat over the hot aisle and blue cold spots where supply air reaches the racks and around the CDU. The clouds come from the same readings as the racks and CDUs, so a Simulate scenario moves them as it plays. In a CDU failure, rack heat grows and spreads over the racks toward the cold aisle, the cold spots shrink, and the CDU's blue patch turns warm. Reset settles everything back. While the heat map is on, it replaces the thermal overlay. The step-by-step heat tour is gone. Clouds hold still when reduced motion is set.

- Fix: a toast on the full-screen hall floor squeezed the 3D floor into a narrow column. It now sits
  top right over the scene, under Pop out and clear of the Simulate bar.

900 service checks and 450 usability tests.

- `services/test_matrix.py` adds 879 generated checks to the 21 in `test_services.py`. Every
  service refuses every route it doesn't own. The gateway sends every route to its owner. Every route
  answers the same through the gateway as from `serve.py` for anonymous, read-only, operator and
  administrator callers. Each route is documented only by its owner, and every service passes its
  health checks.
- `e2e/usability.spec.js` checks 15 views at 5 screen sizes (1440, 1024, 768, 390 and 360 px)
  against 6 rules: the heading names the view above the fold, nothing scrolls sideways, there are no
  console errors or failed API calls, every control has a name, touch targets are at least 24 px,
  and keyboard focus is visible.
- Fixed what the new tests found:
  - The rear-exhaust button on Operate › Rack had no name for screen readers.
  - The Battery A and B hit areas on the one-line diagram had no name for screen readers.
  - Inside a rack on the floor on a phone, nothing on screen said which rack it was. The top bar
    now reads "Floor · A14".
- Known UX debt, listed in the test's `KNOWN_SMALL` list: controls under 24 px.
  - Outlet sockets on the 3D rack PDU
  - Text links in detail panels
  - Gantt bars
  - Simulate ticks
  - Floor-plan racks on tablets and phones
  - One-line diagram boxes on phones
  - Floor breadcrumbs (at 24 px they slide under the drawer's Pop out button)

DCIAC runs as microservices. The backend is split into nine services behind a gateway: identity, inventory, connectivity, power, control, capacity, work orders, monitoring, and reporting. Each has its own API contract and health checks. `docker compose -f services/docker-compose.yml up --build` starts the whole stack, so another platform can host it. The web app, the API paths, and the data are the same. The full browser suite passes against the services as it does against `serve.py`. See `services/README.md` and `services/ROADMAP.md`.

- Safety is unchanged and tested through the gateway: role checks, the outlet work-order gate and
  reason, the 60-a-minute action limit, and the audit hash chain under concurrent writes from several
  services. A timed-out power action says the outcome is unknown and points to Audit, so nobody
  retries it blindly.
- New UX guard: every main view at desktop and iPhone width must keep its heading above the fold, not
  scroll sideways, and log no console errors or API 5xx answers.
- Test fix: the DCIM install test now waits for its own work order to reach Approved and Verified.
  It used to move on as soon as an older order showed those words.

The hall floor can show a thermal map. Cold aisles take each rack's inlet, the hot aisle takes the contained return (or the exhaust when cold-aisle containment is on), and the rest of the hall stays at the 20.5 °C supply. Thermal in the floor controls turns it off.

Adding or moving a device on the 3D hall floor changes that map. A compute load warms the air at its position, scaled to the hall's kW per rack. A cooler stated in its notes, or a CDU, pulls that air back toward the 20.5 °C supply, and the pull follows the unit when it moves. Gear mounted in a rack warms that rack's place on the aisle.

The placed device shows its air temperature above the box, the floor scale names that reading instead of clipping it, and Thermal stays marked while the map is on. Placing or moving says the temperature and whether cooling next to it is taking the heat.

The hall shows that air as a volume. The hot aisle stands above the racks. The cold aisles stay low. A load grows a column off the top of its box, and a cooler stays a short pool on the floor. Empty floor is left clear.

That air is an overlay on the hall. The floor keeps a translucent wash, the rising air stays see-through, and the racks remain visible through it.

Test fix: "outlet confirmation dialog › 11 — commit restores focus when Undo was focused" no longer fails at random.

- Its last check handed an unfinished page read to `expect` without waiting for it, so the test
  could end while the read was still running ("page.evaluate: Test ended"), and the check itself
  never looked at the answer. It now waits for the read and fails if focus has fallen to the page body.
- No app code changed; the published build is byte-for-byte the same.

## 2026-11-24

The Full demo's feeder fault opens the one-line. Feeder A is drawn open, side B stays live and still feeds every hall, and the hall taps are at risk. The summary reads "No load lost · redundancy gone."

Test fix: "clicking a rack on the floor opens the same 3D rack view as Operate" passes again.

- The test failed on every run since at least 2026-11-21 with "feed whip-A04 intercepts pointer
  events". Nothing in the app was wrong: a real mouse click at the centre of rack A14's top lands on
  A14 and opens it. Chromium's `elementsFromPoint`, which Playwright uses for its pre-click check,
  lists the overhead power whips first inside the 3D floor and ignores that the rack top is in front.
- The test now makes a forced click, which is still a real mouse click at the same point, so the A14
  checks that follow still fail if anything actually covers the rack.
- No app code changed; the published build is byte-for-byte the same.
Ask decisions from Vinu, applied:

- Ask is for operators. The Operator and Administrator roles see it below Audit; the read-only
  colo role has no Ask button and `/` does nothing.
- Bulk non-power actions have no cap. "Ack all alarms" proposes every open alarm and still waits
  for Confirm. Power is never bulk.
- The conversation is kept between logins and reloads, per user, in this browser (last 30 turns).
  Demo tours don't add to it.
- An explanation flags its evidence as stale after 1 minute instead of 5.
- Answers stay scripted ("Demo answers"). The plan for a small self-hosted model is in
  `docs/nl-assistant-ux.md`.

## 2026-11-23

Ask DCIAC, a natural-language assistant (side menu, below Audit; fifth tab on phones). Built from
`docs/nl-assistant-ux.md`, all 14 UI stories:

- Ask questions in plain English: "What's wrong in Hall 1?", "Why is GPU Tray 06 alarming?",
  "Which halls have less than 50% headroom?", "Where can I fit 2 more 120 kW racks?", "What happened
  last shift?", "How do I power-cycle GPU Tray 03?". Every answer shows its source and read time.
- Navigate by asking: "Open rack A14 from the rear", "Show Hall 3's racks by power". Unclear names
  ask back with options.
- Actions are proposals: "Ack all P3 inlet alarms in Hall 1" and "Open a serial session on Tray 05"
  wait for Confirm. Power requests only hand off to Control's own confirmation. Role limits and the
  DI-1 leak interlock show as refusals with no override. Text from devices is treated as data.
- Every question, proposal, confirm and cancel is in Audit, tagged "via Ask", with a new
  All / Manual / via Ask filter.
- `/` opens Ask (not inside a console), Escape closes it, and focus moves to each new answer.
- Answers come from a built-in parser, labelled "Demo answers". A language model can replace it
  through `setAskParser()` without touching the gates.
- The Full demo has an Ask step, the AI fix demo asks "Why is GPU Tray 05 down?", and the executive
  briefing mentions Ask.

Alarm SLA and escalation clocks (the alarm chip at the top of every Operate and Floor screen):

- Each alarm shows how long it has been open and how long until it escalates, for example
  `Open 2m · escalates in 3m`. The clock ticks live.
- Ack targets by priority: P1 5 minutes, P2 15 minutes, P3 60 minutes. Opening a row shows
  the target and the time it is due.
- An unacked alarm past its target reads `Escalated · 1m past 5m` in red, its row is tinted,
  and the chip adds the count, for example `P1 · 7 · 2 escalated`.
- Ack stops the escalation; the row then reads `Acked · open 6m`.
- A clock starts when the alarm first appears and is dropped when the alarm clears. If an
  alarm changes priority it gets a fresh clock, the same way its ack is reset. Clocks are
  kept across a page reload and cleared by Lab › Reset.
- The banner's Ack button works again. Two functions named `ackAlarm` were imported into the
  click handler and the DCIM one won, so Ack in the banner never acknowledged the alarm.
- The AI fix demo's alarm step says the 5-minute ack clock starts.
- This finishes priority 3 in `DAILY_IMPROVEMENT.md`.

Heat path walks the heat from the yard coolers through the hall, rack, one-line, fleet, control, port map, and sessions. Next and Back move one view at a time, and it also advances on its own until the last view.

## 2026-11-22

The Full demo test passes again. It still looked for the old lowercase "one-line" caption, so it waited while the tour ran ahead on its own and then failed on the 3D rack step. The test now steps through the tour by hand, checks each beat by its step number and its `Operate · …` caption, and checks auto-advance once at the end. No app change.

The floor has Orbit left, right, up, and down between Pan and Zoom. Each press turns or tilts the view, focus stays on the button, and Reset view restores the starting angle.

The floor has Pan left, right, up, and down beside Zoom. Each press moves the view 48 pixels, focus stays on the button, and Reset view returns to the center.

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
