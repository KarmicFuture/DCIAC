# Integrations

The DCIM API is versioned under `/api/v1`. `GET /api/v1/openapi.json` lists assets, models, locations, connections, the power chain, capacity, work orders, alarms, and reports.

## Authentication

`POST /api/v1/session` with `{ "user", "password" }` returns a bearer token, role, and tenant. The demo password for `dsvs.admin`, `dsvs.operator`, and `colo.readonly` is `hall-a14`. Requests may also send `X-Dciac-User` and `X-Dciac-Role`, which the existing tests use. `POST /api/v1/tokens` issues a hashed API token for the signed-in administrator. `GET /api/v1/auth/oidc` reports whether an OIDC or SAML issuer is configured. Set `DCIAC_OIDC_ISSUER` when an identity provider is available. This build does not redirect to one.

A colo session is tenant `colo`. `GET /api/v1/world` with `X-Dciac-Tenant: colo` returns Hall 10 only.

## Webhooks

`POST /api/v1/webhooks` stores `{ "event", "url" }` for `alarm.raised`, `alarm.cleared`, and `workorder.changed`. Deliveries are written to `webhook_delivery`. The server does not call the URL. That keeps a registered address from becoming a request to an internal network.

## Collectors

`POST /api/v1/collect` accepts `{ "source", "samples" }`. The source is `lab`, `redfish`, `snmp`, `acs`, `modbus`, or `bacnet`. Each sample is `{ "deviceId", "name", "value", "unit" }`. A lab post with no samples stores a 24 °C inlet for tray-01. The server does not dial out to those systems.

## Stubs

`POST /api/v1/integrations/servicenow` with `{ "workOrderId" }` returns a fake change number such as `CHG000014` and `"stub": true`. `POST /api/v1/integrations/vcenter` returns a VM mapped to tray-01 in rack A14. `POST /api/v1/integrations/bacnet` returns a CDU supply temperature. None of them open a socket. Discovery still posts what it saw to `POST /api/v1/discovery/run`.

`POST /api/v1/tokens` can ask for a role. The issued role cannot be higher than the caller.
