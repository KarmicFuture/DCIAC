"""Service catalog: which microservice owns each DCIAC API route and table.

This file is the single source of truth. The gateway routes with it, each
service refuses routes it does not own, the per-service OpenAPI documents are
built from it, and the tests check that every route the monolith answers has
exactly one owner.
"""

import re

PREFIX = "/api/v1"
SEG = r"[^/]+"

# name -> description, owned routes (method, path template), owned tables.
# Path templates use {name} for one path segment, or {name:path} for the rest.
SERVICES = {
    "identity": {
        "summary": "Sign-in, bearer sessions, API tokens, and SSO status.",
        "routes": [
            ("POST", "/session", "Sign in with user and password; returns a bearer token, role, and tenant"),
            ("GET", "/auth/oidc", "Whether an OIDC or SAML issuer is configured"),
            ("POST", "/tokens", "Issue a hashed API token no higher than the caller's role"),
        ],
        "tables": ["app_user", "session", "api_token"],
    },
    "inventory": {
        "summary": "Sites, halls, racks, device models, assets, placement, moves, and discovery.",
        "routes": [
            ("GET", "/world", "Whole site model (tenant-scoped with X-Dciac-Tenant)"),
            ("GET", "/assets", "All assets"),
            ("POST", "/assets", "Create an asset (Administrator)"),
            ("PATCH", "/assets/{id}", "Change an asset (Administrator)"),
            ("GET", "/locations", "Location tree"),
            ("GET", "/models", "Device model library"),
            ("POST", "/models", "Add a device model (Administrator)"),
            ("POST", "/models/import", "Import device models (Administrator)"),
            ("POST", "/models/{id}/clone", "Clone a device model (Administrator)"),
            ("PATCH", "/models/{id}", "Change a device model (Administrator)"),
            ("POST", "/placements", "Place a model in a rack (Administrator)"),
            ("POST", "/moves", "Move a mounted device (Administrator)"),
            ("GET", "/racks/{id}/elevation", "Rack elevation"),
            ("POST", "/discovery/run", "Compare a discovery sweep with the repository"),
            ("POST", "/discovery/{id}/decide", "Accept or reject a discovery difference"),
            ("POST", "/discovery/audit", "Record a barcode or RFID audit scan"),
            ("POST", "/integrations/vcenter", "vCenter stub: VM to rack"),
        ],
        "tables": ["tenant", "model", "location", "asset", "discovery_item"],
    },
    "connectivity": {
        "summary": "Ports, cables, and path tracing.",
        "routes": [
            ("GET", "/racks/{id}/ports", "Ports in a rack"),
            ("GET", "/ports", "All ports with issues"),
            ("GET", "/ports/{id}/trace", "Trace a port end to end"),
            ("POST", "/ports/{id}/status", "Set a port's status"),
            ("GET", "/connections", "All cables"),
            ("POST", "/connections", "Track a cable"),
            ("POST", "/connections/import", "Import cables from CSV"),
            ("POST", "/connections/{id}/drop", "Remove a cable"),
        ],
        "tables": ["port", "patch_panel", "connection"],
    },
    "power": {
        "summary": "Power chain and single-point failure analysis.",
        "routes": [
            ("GET", "/power/nodes/{id:path}", "Power path for a device or node"),
            ("POST", "/power/fail", "Simulate one power node failing"),
        ],
        "tables": ["power_node", "power_edge"],
    },
    "control": {
        "summary": "Outlet power and serial console actions, gated by work orders and reasons.",
        "routes": [
            ("POST", "/actions/outlet", "Switch, cycle, or lock an outlet (reason and covering work order required)"),
            ("POST", "/actions/console", "Open a serial console session (reason required)"),
        ],
        "tables": [],
    },
    "capacity": {
        "summary": "Power and space capacity, find-a-home, and future scenarios.",
        "routes": [
            ("GET", "/capacity", "Site capacity report"),
            ("GET", "/capacity/hall/{id}", "Hall capacity"),
            ("GET", "/capacity/rack/{id}", "Rack capacity"),
            ("POST", "/capacity/home", "Rank racks that can take a model"),
            ("GET", "/scenarios", "Future scenarios"),
            ("POST", "/scenarios", "Create a scenario"),
            ("GET", "/scenarios/{id}/diff", "Now versus future"),
            ("POST", "/scenarios/{id}/changes", "Add a change to a scenario"),
            ("POST", "/scenarios/{id}/promote", "Promote a scenario to a work order"),
        ],
        "tables": ["scenario", "scenario_change"],
    },
    "workorders": {
        "summary": "Work orders and their approval workflow.",
        "routes": [
            ("GET", "/work-orders", "All work orders"),
            ("POST", "/work-orders", "Open a work order"),
            ("POST", "/work-orders/{id}/advance", "Submit, approve, start, or verify a work order"),
            ("POST", "/integrations/servicenow", "ServiceNow stub: change number for a work order"),
        ],
        "tables": ["work_order", "work_task"],
    },
    "monitoring": {
        "summary": "Telemetry ingest, collectors, and alarms.",
        "routes": [
            ("POST", "/metrics", "Post one metric reading"),
            ("GET", "/metrics/{id}", "Readings for a device"),
            ("POST", "/collect", "Normalize collector samples (lab, Redfish, SNMP, ACS, Modbus, BACnet)"),
            ("GET", "/alarms", "Alarms"),
            ("POST", "/alarms/{id}/ack", "Acknowledge an alarm"),
            ("POST", "/integrations/bacnet", "BACnet stub: CDU supply temperature"),
        ],
        "tables": ["metric", "alarm"],
    },
    "reporting": {
        "summary": "Audit log, reports, report schedules, and webhooks.",
        "routes": [
            ("GET", "/audit", "Latest audit events"),
            ("GET", "/audit/verify", "Verify the audit hash chain"),
            ("GET", "/reports/schedules", "Report schedules"),
            ("POST", "/reports/schedules", "Add a report schedule (Administrator)"),
            ("GET", "/reports/{kind}", "A report as JSON, or .csv / .pdf"),
            ("POST", "/webhooks", "Register a webhook (stored, never called)"),
            ("GET", "/webhooks/deliveries", "Webhook deliveries"),
        ],
        "tables": ["audit_event", "report_schedule", "webhook", "webhook_delivery"],
    },
}

# Served by the gateway itself: the merged OpenAPI document.
GATEWAY_ROUTES = [("GET", "/openapi.json", "Merged OpenAPI document for every service")]


def _compile(template):
    pattern = re.escape(PREFIX + template)
    pattern = re.sub(r"\\\{[a-z]+:path\\\}", ".+", pattern)
    pattern = re.sub(r"\\\{[a-z]+\\\}", SEG, pattern)
    return re.compile("^" + pattern + "$")


def _specificity(template):
    # Literal routes win over templated ones: /reports/schedules before /reports/{kind}.
    return (template.count("{"), -len(template))


_TABLE = sorted(
    [(method, template, name, _compile(template)) for name, svc in SERVICES.items() for method, template, _ in svc["routes"]],
    key=lambda row: _specificity(row[1]),
)


def strip_mount(path):
    """The site is also published under /DCIAC (GitHub Pages). Drop that prefix."""
    if path == "/DCIAC" or path.startswith("/DCIAC/"):
        return path[len("/DCIAC"):] or "/"
    return path


def owner(method, path):
    """Return the service name that owns method + path, or None."""
    path = strip_mount(path.split("?", 1)[0])
    for route_method, _, name, regex in _TABLE:
        if route_method == method and regex.match(path):
            return name
    return None


def _schemas():
    # Keep the monolith's data shapes (Asset, Alarm, WorkOrder, ...) in the contract.
    try:
        from server.dcim import openapi as monolith_openapi
        return monolith_openapi()["components"]["schemas"]
    except Exception:  # pragma: no cover - only if the domain package is missing
        return {}


def openapi(names=None):
    """OpenAPI 3 document for the named services (all when names is None)."""
    paths = {}
    tags = []
    for name, svc in SERVICES.items():
        if names is not None and name not in names:
            continue
        tags.append({"name": name, "description": svc["summary"]})
        for method, template, summary in svc["routes"]:
            key = PREFIX + template.replace(":path}", "}")
            op = {
                "tags": [name],
                "summary": summary,
                "operationId": name + "_" + method.lower() + re.sub(r"[^a-zA-Z0-9]+", "_", template).rstrip("_"),
                "responses": {
                    "200": {"description": "OK", "content": {"application/json": {}}},
                    "4XX": {"description": "Refused; body is {\"error\": \"...\"}", "content": {"application/json": {}}},
                },
            }
            params = re.findall(r"\{([a-z]+)(?::path)?\}", template)
            if params:
                op["parameters"] = [{"name": p, "in": "path", "required": True, "schema": {"type": "string"}} for p in params]
            if method in ("POST", "PATCH"):
                op["requestBody"] = {"required": False, "content": {"application/json": {"schema": {"type": "object"}}}}
            paths.setdefault(key, {})[method.lower()] = op
    title = "DCIAC " + (names[0] if names and len(names) == 1 else "platform") + " API"
    return {
        "openapi": "3.0.3",
        "info": {"title": title, "version": "1.0.0"},
        "tags": tags,
        "components": {
            "schemas": _schemas(),
            "securitySchemes": {
                "bearer": {"type": "http", "scheme": "bearer"},
                "demoUser": {"type": "apiKey", "in": "header", "name": "X-Dciac-User"},
                "demoRole": {"type": "apiKey", "in": "header", "name": "X-Dciac-Role"},
            }
        },
        "security": [{"bearer": []}, {"demoUser": [], "demoRole": []}],
        "paths": paths,
    }
