# DCIAC microservices

The DCIAC backend is split into nine services behind one gateway. Any platform can run it as containers and call it over HTTP. The web app, the API paths, and the data are unchanged. The same Playwright suite passes against this stack and against `serve.py`.

```
                 browser / other platform
                           │  HTTP  (TLS ends at your load balancer or ingress)
                    ┌──────▼──────┐
                    │   gateway   │  serves the web app, routes /api/v1/* by catalog.py
                    └──────┬──────┘
   ┌────────┬──────────┬───┴────┬───────┬─────────┬──────────┬───────────┬──────────┐
identity inventory connectivity power control capacity workorders monitoring reporting
   └────────┴──────────┴────────┴───┬───┴─────────┴──────────┴───────────┴──────────┘
                              shared SQLite volume (phase 1)
```

## Run it

With Docker:

```bash
cd prototypes/access-control
echo "DCIAC_GATEWAY_SECRET=$(openssl rand -hex 24)" > services/.env   # required; never committed or copied into images
docker compose -f services/docker-compose.yml up --build
```

Open http://127.0.0.1:8766/. Only the gateway is published to the host. The services sit on an internal network.

Without Docker, for development and tests:

```bash
npm run build
python3 services/run_local.py        # gateway on :8766, services on :8801-8809
```

Run the browser suite against the services: start `run_local.py` first, then `npx playwright test`. Playwright reuses whatever is answering on port 8766. Stop `run_local.py` to test `serve.py` again.

Tests:

```bash
python3 -m unittest services.test_services services.test_matrix   # 900 service checks
npx playwright test e2e/usability.spec.js                          # 450 usability tests
```

## Service catalog

`catalog.py` is the source of truth. The gateway routes with it. Each service refuses any route it doesn't own. The OpenAPI documents are built from it.

| Service | Local port | Owns | Routes | Tables |
|---|---|---|---|---|
| `identity` | 8801 | Sign-in, bearer sessions, API tokens, SSO status | 3 | app_user, session, api_token |
| `inventory` | 8802 | Sites, halls, racks, models, assets, placement, moves, discovery | 17 | tenant, model, location, asset, discovery_item |
| `connectivity` | 8803 | Ports, cables, path tracing | 8 | port, patch_panel, connection |
| `power` | 8804 | Power chain, single-point failure analysis | 2 | power_node, power_edge |
| `control` | 8805 | Outlet power and serial console actions (reason and work order gated) | 2 | none |
| `capacity` | 8806 | Power and space capacity, find-a-home, future scenarios | 9 | scenario, scenario_change |
| `workorders` | 8807 | Work orders and approvals | 4 | work_order, work_task |
| `monitoring` | 8808 | Telemetry ingest, collectors, alarms | 6 | metric, alarm |
| `reporting` | 8809 | Audit log, reports, schedules, webhooks | 7 | audit_event, report_schedule, webhook, webhook_delivery |

Every service answers:

- `GET /healthz`: the process is up.
- `GET /readyz`: the database answers.
- `GET /openapi.json`: that service's own contract.

The gateway answers `GET /api/v1/openapi.json` with the merged contract for all nine services.

## Architecture decisions

**ADR-1: Strangler split, not a rewrite.** The services run the existing, tested domain code in `server/`. Each process exposes only the routes it owns. This turns one deployable into nine without changing behaviour. The full Python and Playwright suites prove it. Rewriting the domain code would have thrown that safety net away.

**ADR-2: Shared database in phase 1, ownership declared now.** Every table has exactly one owning service, and a test enforces it. All services still open the same SQLite file on one volume. SQLite's WAL mode works across containers only on one host with a local volume, never on NFS or across hosts. Phase 2 gives each service its own store.

**ADR-3: One write lock per request.** Every write runs inside `BEGIN IMMEDIATE`. That takes SQLite's write lock across processes before the audit log reads its last hash, so the tamper-evident chain cannot fork. A test sends 24 concurrent writes to two services and checks the chain. With the lock removed, that test fails. Reads use a plain transaction. A request that can't get the lock in time gets 503 "Nothing was changed".

**ADR-4: The gateway is the only door.**
- The gateway strips any client-sent `X-Forwarded-For`, whatever its letter case, and sets the client address itself.
- Services trust that header only when it carries `DCIAC_GATEWAY_SECRET`.
- A timed-out write is reported as "outcome unknown, check Audit". A user who reads that won't power-cycle a device twice by retrying blindly.

**ADR-5: Server-side safety rules unchanged.** These checks run in the same code paths as before, and tests cover them through the gateway:
- role checks
- the outlet work-order gate and reason requirement
- the 60-per-minute action limit
- the audit log
- the DI-1 leak interlock: while DI-1's latest reading is 1, `control` answers 409 to anything but shedding Outlet 1 or Outlet 2, and to whole-PDU control

The outlet policy (RM1048 ownership while a BMC is up, unbound outlets) and the power-control confirmation dialog still run only in the web app (see Known limits).

## Known limits (to remove in the roadmap)

| Risk | Today | Fix |
|---|---|---|
| **Outlet policy is browser-only** | The DI-1 leak interlock now runs in `control` too. The rest of the outlet policy (RM1048 owns Control while a BMC is up, unbound outlets need a maintenance window) and the power-control confirmations still run only in the web app (`src/domain/outlet-policy.ts`). | Roadmap phase 2, item 1 (second half): move the outlet policy into `control` before any other platform gets power control |
| Demo identity headers | The web app sends `X-Dciac-User` and `X-Dciac-Role`, and services trust them, as `serve.py` always did. Anyone who can reach the gateway can claim Administrator. Keep the gateway on a private network until this is fixed. | Gateway verifies bearer tokens and stamps identity, then set `DCIAC_DEMO_HEADERS=0` |
| Cross-service writes | `power` writes alarms, `workorders` writes assets at verify, `capacity` creates work orders, and every service appends to the audit log | Events (outbox) or API calls; the audit log becomes an append-only API |
| Rate limit in memory | `control` must run as one replica | Move the limiter into the database or Redis |
| One host | SQLite on a local volume | Postgres, one schema per service |

See [ROADMAP.md](ROADMAP.md) for the plan.
