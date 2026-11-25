# DCIAC platform roadmap

The goal is DCIAC as independent services with stable APIs that another platform can host. The daily improvement task delivers it one tested pull request at a time. Every slice must keep the full Python suite, the full Playwright suite (run against both `serve.py` and the services), and the UX guard green.

## Phase 1: backend as services (this pull request)

- [x] Nine services plus a gateway, from one catalog of routes and tables
- [x] Docker Compose stack, with a migrate job, health and readiness checks, and an internal network
- [x] Per-service and merged OpenAPI documents
- [x] Contract and safety tests through the gateway:
  - parity with the monolith
  - roles
  - the outlet work-order gate
  - the rate limit
  - the audit chain under concurrent writes
  - header spoofing
  - a service going down
- [x] UX guard: every main view at 1440 px and 390 px keeps its heading above the fold and doesn't scroll sideways, with no console errors and no API 5xx answers

## Phase 2: harden the boundaries (weeks 1–2)

One item per daily run, in order:

1. **Interlocks on the server.** Move the DI-1 leak interlock and the outlet policy (`leak.ts`, `outlet-policy.ts`) into `control`, so `/actions/outlet` refuses a power action that the web app would refuse. Until this ships, no other platform gets power control through the API. The web app keeps its own checks and confirmation dialog too.
2. **CI.** A GitHub Actions workflow that:
   - builds both images
   - runs `docker compose up`
   - runs `services.test_services` and the Playwright suite against the gateway
3. **Gateway authentication.** The gateway checks bearer tokens with `identity` and stamps the user and role on the request. The web app signs in through `/api/v1/session`. Then `DCIAC_DEMO_HEADERS=0` becomes the default.
4. **Audit as an API.** Services post audit events to `reporting` instead of writing the `audit_event` table themselves. The hash chain stays in one place.
5. **Events for cross-service writes.** These go through an outbox table:
   - `power` raises alarms through `monitoring`
   - `workorders` changes assets through `inventory` at verify
   - `capacity` opens work orders through `workorders`
6. **Rate limiter in the database,** so `control` can run more than one replica.
7. **Idempotency keys** on `/actions/outlet` and `/actions/console`, so a retried request is never a second power cycle.

## Phase 3: Kubernetes (weeks 2–4)

1. Kubernetes manifests: a Deployment, Service, and probes per service, plus an Ingress to the gateway and a NetworkPolicy that lets only the gateway reach the services.
2. A Helm chart that sets the image tag, secrets, replicas, and storage class.
3. Postgres in place of SQLite, one schema per service, with a migration job per service.
4. Scaling the read-heavy services (`inventory`, `capacity`, `monitoring`) to more than one replica, with load tests.
5. Observability: structured logs with a request ID that the gateway passes on, Prometheus metrics, and tracing.

## Phase 4: move browser logic into services (weeks 4–8)

About 6,000 lines of domain logic run in the browser today. Each move keeps the screen identical, and the UX guard and the existing specs prove it.

1. The web app reads the interlock state from `control` (which phase 2 already moved to the server) instead of computing it twice.
2. **Events and the alarm timeline** (`events.ts`) move into `monitoring`.
3. **Sessions and failover** (`sessions.ts`, `failover.ts`, `single-master.ts`) move into a new `console` service.
4. **Ask** (`ask.ts`) moves into a new `assistant` service, behind the same confirm gates.
5. **The build plan and the heat path** (`buildplan.ts`, `heat-path.ts`) move into `capacity`.

## Regression and UX gates

These apply every day, for every slice:

- The full Python suite, plus `services.test_services`.
- The full Playwright suite against `serve.py` and against the services.
- `e2e/ux-guard.spec.js` at desktop and iPhone widths. A layout regression fails the run just like a broken feature.
- The guard grows with the product: when a view is added, it goes on the guard's list.
