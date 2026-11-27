"""Contract, safety, and integration tests for the DCIAC microservices.

    python3 -m unittest services.test_services

The stack tests start migrate, every service, and the gateway as real processes
on a throwaway copy of the database, then talk to them over HTTP.
"""

import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, APP)

import catalog  # noqa: E402

ADMIN = {"X-Dciac-User": "dsvs.admin", "X-Dciac-Role": "Administrator"}
OPERATOR = {"X-Dciac-User": "dsvs.operator", "X-Dciac-Role": "Operator"}
READONLY = {"X-Dciac-User": "colo.readonly", "X-Dciac-Role": "ReadOnly"}


def monolith_routes():
    """Every (method, sample path) the monolith's dispatcher recognises."""
    found = set()
    for name in ("api.py", "dcim.py"):
        with open(os.path.join(APP, "server", name)) as handle:
            text = handle.read()
        for method, rest in re.findall(r'method == "([A-Z]+)" and (path[^:]+):', text):
            exact = re.search(r'path == "([^"]+)"', rest)
            if exact:
                found.add((method, exact.group(1)))
                continue
            start = re.search(r'path\.startswith\("([^"]+)"\)', rest)
            end = re.search(r'path\.endswith\("([^"]+)"\)', rest)
            if start:
                found.add((method, start.group(1) + "sample-id" + (end.group(1) if end else "")))
    return found


def free_port_block(count):
    """First port of `count` consecutive free ports on 127.0.0.1."""
    import socket
    import random
    for _ in range(200):
        start = random.randint(20000, 60000)
        socks = []
        try:
            for port in range(start, start + count):
                sock = socket.socket()
                sock.bind(("127.0.0.1", port))
                socks.append(sock)
            return start
        except OSError:
            continue
        finally:
            for sock in socks:
                sock.close()
    raise RuntimeError("no free ports")


class CatalogTest(unittest.TestCase):
    def test_every_monolith_route_has_exactly_one_owner(self):
        routes = monolith_routes()
        self.assertGreater(len(routes), 55)
        for method, path in routes:
            if path == "/api/v1/openapi.json":
                continue  # the gateway answers this one itself
            owners = [name for name in catalog.SERVICES if any(
                m == method and catalog._compile(t).match(path) for m, t, _ in catalog.SERVICES[name]["routes"])]
            # More than one template may match (literal and {kind}); the owner must still be one service.
            self.assertTrue(owners, "%s %s has no owner" % (method, path))
            self.assertEqual(len(set(owners)), 1, "%s %s is owned by %s" % (method, path, owners))
            self.assertEqual(catalog.owner(method, path), owners[0])

    def test_catalog_has_no_routes_the_monolith_lacks(self):
        routes = monolith_routes()
        for name, svc in catalog.SERVICES.items():
            for method, template, _ in svc["routes"]:
                regex = catalog._compile(template)
                self.assertTrue(any(m == method and regex.match(p) for m, p in routes), "%s %s (%s) is not in the monolith" % (method, template, name))

    def test_literal_routes_win_over_templates(self):
        self.assertEqual(catalog.owner("GET", "/api/v1/reports/schedules"), "reporting")
        self.assertEqual(catalog.owner("GET", "/api/v1/racks/A14/ports"), "connectivity")
        self.assertEqual(catalog.owner("GET", "/api/v1/racks/A14/elevation"), "inventory")
        self.assertEqual(catalog.owner("POST", "/api/v1/models/import"), "inventory")
        self.assertEqual(catalog.owner("POST", "/api/v1/connections/import"), "connectivity")
        self.assertEqual(catalog.owner("GET", "/DCIAC/api/v1/alarms"), "monitoring")
        self.assertIsNone(catalog.owner("DELETE", "/api/v1/assets/cab-A14"))
        self.assertIsNone(catalog.owner("GET", "/api/v1/nothing"))

    def test_every_table_has_exactly_one_owning_service(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        copy = os.path.join(tmp.name, "t.sqlite")
        shutil.copyfile(os.path.join(APP, "data", "unubtanium.sqlite"), copy)
        conn = sqlite3.connect(copy)
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")} - {"sqlite_sequence"}
        conn.close()
        owned = [table for svc in catalog.SERVICES.values() for table in svc["tables"]]
        self.assertEqual(len(owned), len(set(owned)), "a table is claimed twice")
        self.assertEqual(set(owned), tables)

    def test_openapi_per_service_and_merged(self):
        merged = catalog.openapi()
        total = sum(len(svc["routes"]) for svc in catalog.SERVICES.values())
        self.assertEqual(sum(len(ops) for ops in merged["paths"].values()), total)
        power = catalog.openapi(["power"])
        self.assertEqual(set(power["paths"]), {"/api/v1/power/nodes/{id}", "/api/v1/power/fail"})
        self.assertIn("Asset", merged["components"]["schemas"])
        self.assertIn("MetricSample", merged["components"]["schemas"])
        ids = [op["operationId"] for ops in merged["paths"].values() for op in ops.values()]
        self.assertEqual(len(ids), len(set(ids)))


class ServiceIsolationTest(unittest.TestCase):
    """A service refuses routes it does not own, even when called directly."""

    def setUp(self):
        from server import db
        self.db = db
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DCIAC_DB"] = os.path.join(self.tmp.name, "t.sqlite")
        db._conn = None
        import service
        self.service = service
        service.open_database()

    def tearDown(self):
        if self.db._conn is not None:
            self.db._conn.close()
            self.db._conn = None
        os.environ.pop("DCIAC_DB", None)
        self.tmp.cleanup()

    def test_foreign_routes_are_404(self):
        status, body = self.service.handle("power", "GET", "/api/v1/world", {}, b"", "127.0.0.1")
        self.assertEqual(status, 404)
        self.assertEqual(body["service"], "power")
        status, _ = self.service.handle("monitoring", "POST", "/api/v1/actions/outlet", OPERATOR, b'{"reason":"x","maintenance":true}', "127.0.0.1")
        self.assertEqual(status, 404)
        self.assertEqual(self.db.audit_log(), [])

    def test_own_route_answers_like_the_monolith(self):
        from server.api import dispatch
        direct = self.service.handle("capacity", "GET", "/api/v1/capacity", {}, b"", "127.0.0.1")
        self.assertEqual(direct, dispatch("GET", "/api/v1/capacity", {}, b""))

    def test_failed_handler_rolls_back(self):
        from server import api
        real = api.power_fail

        def writes_then_fails(body):
            self.db.audit("dsvs.admin", "Administrator", "power alarm", "bus-a", None, None, "half done")
            raise RuntimeError("handler failed after writing")

        api.power_fail = writes_then_fails
        self.addCleanup(setattr, api, "power_fail", real)
        before = self.db.db().execute("SELECT COUNT(*) FROM audit_event").fetchone()[0]
        status, body = self.service.handle("power", "POST", "/api/v1/power/fail", ADMIN, b'{"nodeId":"bus-a"}', "127.0.0.1")
        self.assertEqual(status, 500)
        self.assertIn("Nothing was changed", body["error"])
        self.assertFalse(self.db.db().in_transaction)
        self.assertEqual(self.db.db().execute("SELECT COUNT(*) FROM audit_event").fetchone()[0], before)

    def test_busy_database_refuses_without_changing_anything(self):
        self.db.db().execute("PRAGMA busy_timeout = 200")
        holder = sqlite3.connect(os.environ["DCIAC_DB"])
        holder.execute("BEGIN IMMEDIATE")
        try:
            status, body = self.service.handle("control", "POST", "/api/v1/actions/outlet", OPERATOR,
                                               b'{"op":"cycle","reason":"busy test","deviceId":"tray-03","maintenance":true}', "127.0.0.1")
        finally:
            holder.rollback()
            holder.close()
        self.assertEqual(status, 503)
        self.assertIn("Nothing was changed", body["error"])
        self.assertFalse(any(row["detail"] == "busy test" for row in self.db.audit_log()))

    def test_forwarded_for_needs_the_gateway_secret(self):
        old = self.service.SECRET
        self.addCleanup(setattr, self.service, "SECRET", old)
        self.service.SECRET = "s3cret"
        self.assertEqual(self.service.client_ip({"X-Forwarded-For": "10.9.9.9"}, "172.18.0.5"), "172.18.0.5")
        self.assertEqual(self.service.client_ip({"x-forwarded-for": "10.9.9.9", "x-dciac-gateway": "wrong"}, "172.18.0.5"), "172.18.0.5")
        self.assertEqual(self.service.client_ip({"X-Forwarded-For": "10.1.2.3", "X-Dciac-Gateway": "s3cret"}, "172.18.0.5"), "10.1.2.3")
        self.service.SECRET = ""
        self.assertEqual(self.service.client_ip({"X-Forwarded-For": "10.1.2.3", "X-Dciac-Gateway": ""}, "172.18.0.5"), "172.18.0.5")


class StackTest(unittest.TestCase):
    """Real processes: migrate, nine services, and the gateway."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dbpath = os.path.join(cls.tmp.name, "stack.sqlite")
        shutil.copyfile(os.path.join(APP, "data", "unubtanium.sqlite"), cls.dbpath)
        base = free_port_block(len(catalog.SERVICES) + 1)
        cls.gateway_port = base + len(catalog.SERVICES)
        cls.secret = "test-secret-" + str(os.getpid())
        env = {"DCIAC_DB": cls.dbpath, "DCIAC_PORT_BASE": str(base), "DCIAC_GATEWAY_PORT": str(cls.gateway_port),
               "DCIAC_GATEWAY_SECRET": cls.secret}
        os.environ["DCIAC_PORT_BASE"] = str(base)
        import importlib
        import gateway
        importlib.reload(gateway)
        import run_local
        importlib.reload(run_local)
        cls.ports = dict(gateway.LOCAL_PORTS)
        cls.run_local = run_local
        cls.procs = run_local.start(env, gateway_port=cls.gateway_port)

    @classmethod
    def tearDownClass(cls):
        cls.run_local.stop(cls.procs)
        os.environ.pop("DCIAC_PORT_BASE", None)
        cls.tmp.cleanup()

    def call(self, method, path, body=None, headers=None, port=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request("http://127.0.0.1:%d%s" % (port or self.gateway_port, path), data=data, method=method)
        for key, value in (headers or {}).items():
            req.add_header(key, value)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=20) as reply:
                return reply.status, json.loads(reply.read() or b"null"), dict(reply.headers)
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read() or b"null"), dict(err.headers)

    def test_gateway_routes_each_call_to_its_owner(self):
        for method, path in [("GET", "/api/v1/world"), ("GET", "/api/v1/capacity"), ("GET", "/api/v1/alarms"),
                             ("GET", "/api/v1/work-orders"), ("GET", "/api/v1/connections"), ("GET", "/api/v1/audit"),
                             ("GET", "/api/v1/power/nodes/tray-01"), ("GET", "/api/v1/auth/oidc")]:
            status, _, headers = self.call(method, path)
            self.assertEqual(status, 200, path)
            self.assertEqual(headers.get("X-Dciac-Service"), catalog.owner(method, path), path)

    def test_unknown_route_and_merged_openapi(self):
        status, body, _ = self.call("GET", "/api/v1/nope")
        self.assertEqual((status, body["error"]), (404, "No such API route."))
        status, spec, _ = self.call("GET", "/api/v1/openapi.json")
        self.assertEqual(status, 200)
        self.assertIn("/api/v1/actions/outlet", spec["paths"])
        status, spec, _ = self.call("GET", "/openapi.json", port=self.ports["control"])
        self.assertEqual(set(spec["paths"]), {"/api/v1/actions/outlet", "/api/v1/actions/console"})

    def test_role_permissions_survive_the_split(self):
        status, body, _ = self.call("POST", "/api/v1/assets", {})
        self.assertEqual(status, 401)
        status, body, _ = self.call("PATCH", "/api/v1/assets/cab-A14", {"assetTag": "A14-X"}, OPERATOR)
        self.assertEqual(status, 403)
        status, body, _ = self.call("POST", "/api/v1/actions/outlet", {"op": "cycle", "reason": "test", "maintenance": True}, READONLY)
        self.assertEqual(status, 403)
        status, body, _ = self.call("POST", "/api/v1/actions/outlet", {"op": "cycle", "reason": "WO-99", "workOrderId": "WO-99", "deviceId": "tray-06"}, OPERATOR)
        self.assertEqual(status, 403)
        self.assertIn("work order", body["error"])
        status, body, _ = self.call("POST", "/api/v1/actions/outlet", {"op": "cycle", "deviceId": "tray-06", "maintenance": True}, OPERATOR)
        self.assertEqual((status, body["error"]), (403, "A reason is required."))

    def test_bearer_session_from_identity_works_on_other_services(self):
        status, session, _ = self.call("POST", "/api/v1/session", {"user": "dsvs.admin", "password": "hall-a14"})
        self.assertEqual(status, 200)
        status, body, _ = self.call("POST", "/api/v1/reports/schedules", {"kind": "inventory", "cadence": "daily"}, {"Authorization": "Bearer " + session["token"]})
        self.assertEqual(status, 201, body)
        status, _, _ = self.call("POST", "/api/v1/session", {"user": "dsvs.admin", "password": "wrong"})
        self.assertEqual(status, 401)

    def test_concurrent_writes_across_services_keep_one_audit_chain(self):
        before = self._audit_rows()
        errors = []

        def guarded(fn):
            def run(i):
                try:
                    fn(i)
                except Exception as exc:  # a reset or timeout must fail the test, not vanish in a thread
                    errors.append((fn.__name__, "exception", repr(exc)))
            return run

        def outlet(i):
            user = {"X-Dciac-User": "load.op%d" % i, "X-Dciac-Role": "Operator"}
            status, body, _ = self.call("POST", "/api/v1/actions/outlet", {"op": "cycle", "reason": "load test %d" % i, "deviceId": "tray-0%d" % (1 + i % 8), "maintenance": True}, user)
            if status != 200:
                errors.append(("outlet", status, body))

        def patch(i):
            status, body, _ = self.call("PATCH", "/api/v1/assets/cab-A14", {"warrantyEnd": "2030-01-%02d" % (1 + i)}, ADMIN)
            if status != 200:
                errors.append(("patch", status, body))

        threads = [threading.Thread(target=guarded(fn), args=(i,)) for i in range(12) for fn in (outlet, patch)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(errors, [])
        status, chain, _ = self.call("GET", "/api/v1/audit/verify")
        self.assertEqual(status, 200)
        self.assertTrue(chain["ok"], chain)
        self.assertEqual(self._audit_rows(), before + 24)

    def test_spoofed_forwarded_for_never_reaches_the_audit_log(self):
        cases = [
            ("spoof upper", self.gateway_port, {"X-Forwarded-For": "10.6.6.6"}),
            ("spoof lower", self.gateway_port, {"x-forwarded-for": "10.6.6.7", "x-dciac-gateway": "guess"}),
            ("spoof direct", self.ports["control"], {"X-Forwarded-For": "10.6.6.8", "X-Dciac-Gateway": "guess"}),
            # With the real secret the service does take the forwarded address: the plumbing works.
            ("spoof trusted", self.ports["control"], {"X-Forwarded-For": "10.7.7.7", "X-Dciac-Gateway": self.secret}),
        ]
        for detail, port, extra in cases:
            status, body, _ = self.call("POST", "/api/v1/actions/outlet", {"op": "lock", "reason": detail, "deviceId": "tray-02", "maintenance": True},
                                        dict(OPERATOR, **extra), port=port)
            self.assertEqual(status, 200, body)
        conn = sqlite3.connect(self.dbpath)
        rows = dict(conn.execute("SELECT detail, source_ip FROM audit_event WHERE detail LIKE 'spoof %'").fetchall())
        conn.close()
        self.assertEqual(rows, {"spoof upper": "127.0.0.1", "spoof lower": "127.0.0.1", "spoof direct": "127.0.0.1", "spoof trusted": "10.7.7.7"})

    def test_answers_match_the_monolith(self):
        """Same status and body through gateway and service as from server.api.dispatch."""
        from server import api, db
        # Compare against a snapshot of the stack's own database as it is right now,
        # so earlier tests' writes can't make the two differ.
        copy = os.path.join(self.tmp.name, "mono.sqlite")
        if os.path.exists(copy):
            os.remove(copy)
        source, target = sqlite3.connect(self.dbpath), sqlite3.connect(copy)
        source.backup(target)
        source.close()
        target.close()
        old = os.environ.get("DCIAC_DB")
        os.environ["DCIAC_DB"] = copy
        db._conn = None
        db.connect()
        try:
            cases = [
                ("GET", "/api/v1/world", {"X-Dciac-Tenant": "colo"}),
                ("GET", "/DCIAC/api/v1/locations", {}),
                ("GET", "/api/v1/models", {}),
                ("GET", "/api/v1/racks/A14/elevation", {}),
                ("GET", "/api/v1/racks/NOPE/elevation", {}),
                ("GET", "/api/v1/power/nodes/tray-01", {}),
                ("GET", "/api/v1/power/nodes/no-such-node", {}),
                ("GET", "/api/v1/capacity/hall/hall-3", {}),
                ("GET", "/api/v1/ports/a14-tray-01-eth0/trace", {}),
                ("GET", "/api/v1/reports/inventory.csv", {}),
                ("GET", "/api/v1/reports/nope", {}),
                ("GET", "/api/v1/audit/verify", {}),
                ("GET", "/api/v1/auth/oidc", {}),
                ("PATCH", "/api/v1/assets/cab-A14", READONLY),
            ]
            for method, path, headers in cases:
                lowered = {k.lower(): v for k, v in headers.items()}
                want = api.dispatch(method, path, lowered, b'{"assetTag":"X"}' if method == "PATCH" else b"")
                status, body, _ = self.call(method, path, {"assetTag": "X"} if method == "PATCH" else None, headers)
                self.assertEqual(status, want[0], path)
                if path != "/api/v1/audit/verify":
                    self.assertEqual(body, json.loads(json.dumps(want[1])), path)
        finally:
            db._conn.close()
            db._conn = None
            if old is None:
                os.environ.pop("DCIAC_DB", None)
            else:
                os.environ["DCIAC_DB"] = old

    def test_encoded_paths_are_decoded_once_and_never_crash(self):
        for path in ("/api/v1/power/nodes/foo%20bar", "/api/v1/power/nodes/%C3%A9", "/api/v1/power/nodes/tray%252D01"):
            status, body, _ = self.call("GET", path)
            self.assertEqual(status, 404, path)
        status, body, _ = self.call("GET", "/api/v1/power/nodes/tray%2D01")
        self.assertEqual((status, body["id"]), (200, "tray-01"))

    def test_outlet_work_order_gate_and_rate_limit_through_the_gateway(self):
        order = {"id": "WO-77", "kind": "Power cycle", "state": "In progress", "deviceId": "tray-07", "reason": "WO-77"}
        status, body, _ = self.call("POST", "/api/v1/work-orders", order, ADMIN)
        self.assertEqual(status, 201, body)
        action = {"op": "cycle", "reason": "WO-77", "workOrderId": "WO-77", "deviceId": "tray-07"}
        status, body, _ = self.call("POST", "/api/v1/actions/outlet", action, OPERATOR)
        self.assertEqual(status, 200, body)
        status, body, _ = self.call("POST", "/api/v1/actions/outlet", dict(action, deviceId="tray-01"), OPERATOR)
        self.assertEqual(status, 403, "the work order covers tray-07 only")
        limiter = {"X-Dciac-User": "rate.op", "X-Dciac-Role": "Operator"}
        statuses = [self.call("POST", "/api/v1/actions/console", {"reason": "rate test", "deviceId": "tray-01", "maintenance": True}, limiter)[0] for _ in range(61)]
        self.assertEqual(statuses[:60], [200] * 60)
        self.assertEqual(statuses[60], 403)

    def test_leak_interlock_is_enforced_by_control(self):
        reading = lambda v: {"source": "lab", "samples": [{"deviceId": "di-1", "name": "leak", "value": v, "unit": "state"}]}
        action = {"op": "cycle", "outlet": 2, "deviceId": "tray-02", "reason": "leak test", "maintenance": True}
        self.assertEqual(self.call("POST", "/api/v1/collect", reading(1), OPERATOR)[0], 201)
        status, body, _ = self.call("POST", "/api/v1/actions/outlet", action, OPERATOR)
        self.assertEqual((status, body.get("interlock")), (409, "DI-1"), body)
        self.assertEqual(self.call("POST", "/api/v1/actions/outlet", dict(action, op="off"), OPERATOR)[0], 200)
        self.assertEqual(self.call("POST", "/api/v1/collect", reading(0), OPERATOR)[0], 201)
        self.assertEqual(self.call("POST", "/api/v1/actions/outlet", action, OPERATOR)[0], 200)

    def test_web_app_is_served_at_both_roots(self):
        for path in ("/", "/DCIAC/", "/DCIAC/index.html"):
            with urllib.request.urlopen("http://127.0.0.1:%d%s" % (self.gateway_port, path), timeout=10) as reply:
                self.assertIn(b"<html", reply.read().lower(), path)

    def test_down_service_returns_503_and_others_keep_working(self):
        import subprocess
        proc = next(p for p in self.procs if getattr(p, "dciac_name", "") == "monitoring" and p.poll() is None)
        proc.terminate()
        proc.wait(timeout=5)
        try:
            status, body, _ = self.call("GET", "/api/v1/alarms")
            self.assertEqual(status, 503)
            self.assertEqual(body["service"], "monitoring")
            status, _, _ = self.call("GET", "/api/v1/capacity")
            self.assertEqual(status, 200)
        finally:
            env = dict(os.environ, DCIAC_DB=self.dbpath, DCIAC_SERVICE="monitoring", DCIAC_HOST="127.0.0.1", DCIAC_PORT=str(self.ports["monitoring"]))
            restarted = subprocess.Popen([sys.executable, os.path.join(HERE, "service.py")], env=env)
            restarted.dciac_name = "monitoring"
            self.procs.append(restarted)
            self.assertTrue(self.run_local.wait("http://127.0.0.1:%d/readyz" % self.ports["monitoring"]))

    def _audit_rows(self):
        conn = sqlite3.connect(self.dbpath)
        count = conn.execute("SELECT COUNT(*) FROM audit_event").fetchone()[0]
        conn.close()
        return count


if __name__ == "__main__":
    unittest.main()
