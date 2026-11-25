# Unubtanium 2.0 access and DCIM

Local preview of the ten-hall floor, rack elevation, power chain, and the DCIM pages (capacity, cables, work orders, monitoring, reports, discovery).

## Run the preview

From this directory:

```bash
npm install
npm run build
python3 serve.py
```

Open http://127.0.0.1:8766/ (Safari can use https://127.0.0.1:8766/). `serve.py` serves `dist/` and the SQLite API. After a TypeScript or Python change, run `npm run build` again and restart `serve.py`.

Sign in as Operator, Administrator, or Read only. The password for all three is `hall-a14`. The sign-in buttons send it for you.

The database file is `data/unubtanium.sqlite`. Set `DCIAC_DB` to use another file.

## Run as microservices

`services/` runs the same API as nine services behind a gateway, with Docker Compose or `python3 services/run_local.py`. See [services/README.md](services/README.md) and the [roadmap](services/ROADMAP.md).

## Tests

Python:

```bash
python3 -m unittest server.test_fit server.test_api server.test_elevation server.test_power server.test_dcim
```

Browser, with the preview already running and Google Chrome installed:

```bash
npx playwright test e2e/dcim.spec.js
```

`e2e/dcim.spec.js` signs in as the administrator, uses Find a home for a Dell PowerEdge R760 in Hall 3 rack 07, promotes that plan to an install work order, approves it, and verifies it. The server creates the asset only at verification. The test then checks the rack elevation, the power path, capacity (PUE 1.05), the audit report, and an alarm after Feeder A fails.

Playwright uses system Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` when that file is present. The base URL is http://127.0.0.1:8766.

## What the numbers mean

PUE is facility kW divided by IT kW. Facility kW is IT kW plus 5% for auxiliaries, so a balanced reading is 1.05. The energy report repeats that figure for the hour, the day, and the month. Power is in W on the API and shown as kW or MW in the page. An empty rack still reserves its 120 kW envelope. A verified server replaces that envelope with the server nameplate, and the difference is stranded power. Feeds A and B are each sized for the full hall.

Future on the floor loads the latest scenario and outlines the racks it changes. Promoting that scenario creates a work order. An operator can submit a work order. An administrator approves and verifies it, and the asset is written only at verification. An open alarm on rack A14 has an ACS serial action. Collectors for the lab, Redfish, SNMP, ACS, Modbus, and BACnet accept posted readings and do not call out to those systems.
