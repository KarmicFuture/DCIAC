"""Service check matrix: 879 generated checks over every route in the catalog.

    python3 -m unittest services.test_matrix

Together with services/test_services.py (21 checks) that is 900 service checks.
Each check is its own test, named after what it proves, so a failure points at
one route, one service, or one role.

- isolation_*   58 routes x 9 services: a service answers only the routes it owns.
- routing_*     58 routes: the gateway sends each route to its owner.
- parity_*      58 routes x 4 identities: same status (and same refusal text) through
                the gateway as from the monolith's dispatcher, in lockstep on twin databases.
- contract_*    58 routes: documented in its owner's OpenAPI and in no other service's.
- health_*      9 services: healthz, readyz, and an OpenAPI that lists exactly its routes.
"""

import json
import os
import re
import shutil
import sys
import tempfile
import unittest
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, APP)

import catalog  # noqa: E402

SEED = os.path.join(APP, "data", "unubtanium.sqlite")

# Real ids from the seed, so owned calls run real handler code, not just a 404.
SAMPLE = {
    "/assets/": "cab-A14", "/models/": "busway", "/racks/": "A14", "/discovery/": "disc-bmc-extra",
    "/ports/": "port-acs-ttyS1", "/connections/": "cab-pp-ttyS1", "/power/nodes/": "tray-01",
    "/capacity/hall/": "pod-a", "/capacity/rack/": "A14", "/scenarios/": "scn-0650bf",
    "/work-orders/": "WO-14", "/metrics/": "tray-01", "/alarms/": "alm-2b5010e6", "/reports/": "inventory",
}

IDENTITIES = {
    "anonymous": {},
    "readonly": {"x-dciac-user": "colo.readonly", "x-dciac-role": "ReadOnly"},
    "operator": {"x-dciac-user": "matrix.operator", "x-dciac-role": "Operator"},
    "admin": {"x-dciac-user": "matrix.admin", "x-dciac-role": "Administrator"},
}


def sample_path(template):
    """Fill each {param} with a real id chosen by the path segment in front of it."""
    path = template
    for prefix, value in SAMPLE.items():
        path = re.sub(re.escape(prefix) + r"\{[a-z]+(?::path)?\}", prefix + value, path)
    assert "{" not in path, template
    return catalog.PREFIX + path


ROUTES = [(name, method, template, sample_path(template))
          for name, svc in catalog.SERVICES.items() for method, template, _ in svc["routes"]]


def slug(text):
    return "".join(ch if ch.isalnum() else "_" for ch in text).strip("_").lower()


def body_for(method):
    return b"{}" if method in ("POST", "PATCH") else b""


# ---------------------------------------------------------------- isolation

class IsolationMatrix(unittest.TestCase):
    """In-process: service.handle refuses every route it does not own."""

    @classmethod
    def setUpClass(cls):
        from server import db
        cls.db = db
        cls.tmp = tempfile.TemporaryDirectory()
        cls.old = os.environ.get("DCIAC_DB")
        os.environ["DCIAC_DB"] = os.path.join(cls.tmp.name, "iso.sqlite")
        shutil.copyfile(SEED, os.environ["DCIAC_DB"])
        db._conn = None
        import service
        cls.service = service
        service.open_database()

    @classmethod
    def tearDownClass(cls):
        if cls.db._conn is not None:
            cls.db._conn.close()
            cls.db._conn = None
        if cls.old is None:
            os.environ.pop("DCIAC_DB", None)
        else:
            os.environ["DCIAC_DB"] = cls.old
        cls.tmp.cleanup()


def _isolation(service_name, owner, method, path):
    def test(self):
        status, body = self.service.handle(service_name, method, path, {}, body_for(method), "127.0.0.1")
        refused = status == 404 and isinstance(body, dict) and body.get("service") == service_name
        if service_name == owner:
            self.assertFalse(refused, "%s refused its own route %s %s" % (service_name, method, path))
        else:
            self.assertTrue(refused, "%s answered %s %s, owned by %s (status %s)" % (service_name, method, path, owner, status))
    return test


for _owner, _method, _template, _path in ROUTES:
    for _service in catalog.SERVICES:
        setattr(IsolationMatrix, "test_isolation_%s_%s_%s_on_%s" % (_owner, _method.lower(), slug(_template), _service),
                _isolation(_service, _owner, _method, _path))


# ---------------------------------------------------------------- contract

class ContractMatrix(unittest.TestCase):
    """Each route is documented by its owner's OpenAPI and by no other service's."""

    specs = {name: catalog.openapi([name]) for name in catalog.SERVICES}


def _contract(owner, method, template):
    key = catalog.PREFIX + template.replace(":path}", "}")

    def test(self):
        holders = [name for name, spec in self.specs.items() if method.lower() in spec["paths"].get(key, {})]
        self.assertEqual(holders, [owner], "%s %s documented by %s" % (method, key, holders))
        op = self.specs[owner]["paths"][key][method.lower()]
        self.assertTrue(op["summary"])
        self.assertEqual(op["tags"], [owner])
    return test


for _owner, _method, _template, _path in ROUTES:
    setattr(ContractMatrix, "test_contract_%s_%s_%s" % (_owner, _method.lower(), slug(_template)), _contract(_owner, _method, _template))


# ---------------------------------------------------------------- stack: routing, parity, health

class StackMatrix(unittest.TestCase):
    """Real processes on one twin database; the monolith runs in-process on the other."""

    @classmethod
    def setUpClass(cls):
        from test_services import free_port_block
        from server import db
        cls.db = db
        cls.tmp = tempfile.TemporaryDirectory()
        cls.stack_db = os.path.join(cls.tmp.name, "stack.sqlite")
        cls.mono_db = os.path.join(cls.tmp.name, "mono.sqlite")
        shutil.copyfile(SEED, cls.stack_db)
        shutil.copyfile(SEED, cls.mono_db)
        base = free_port_block(len(catalog.SERVICES) + 1)
        cls.gateway_port = base + len(catalog.SERVICES)
        os.environ["DCIAC_PORT_BASE"] = str(base)
        import importlib
        import gateway
        importlib.reload(gateway)
        import run_local
        importlib.reload(run_local)
        cls.ports = dict(gateway.LOCAL_PORTS)
        cls.run_local = run_local
        cls.procs = run_local.start({"DCIAC_DB": cls.stack_db, "DCIAC_PORT_BASE": str(base),
                                     "DCIAC_GATEWAY_PORT": str(cls.gateway_port)}, gateway_port=cls.gateway_port)
        # Migrate the twin exactly as the stack's migrate job did.
        cls.old = os.environ.get("DCIAC_DB")
        os.environ["DCIAC_DB"] = cls.mono_db
        db._conn = None
        db.connect()

    @classmethod
    def tearDownClass(cls):
        cls.run_local.stop(cls.procs)
        os.environ.pop("DCIAC_PORT_BASE", None)
        if cls.db._conn is not None:
            cls.db._conn.close()
            cls.db._conn = None
        if cls.old is None:
            os.environ.pop("DCIAC_DB", None)
        else:
            os.environ["DCIAC_DB"] = cls.old
        cls.tmp.cleanup()

    def call(self, method, path, raw=b"", headers=None, port=None):
        req = urllib.request.Request("http://127.0.0.1:%d%s" % (port or self.gateway_port, path), data=raw or None, method=method)
        for key, value in (headers or {}).items():
            req.add_header(key, value)
        if raw:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=30) as reply:
                return reply.status, json.loads(reply.read() or b"null"), dict(reply.headers)
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read() or b"null"), dict(err.headers)

    def both(self, method, path, headers):
        """Same request to the monolith and the gateway, in the same order, so the twins stay in step."""
        from server.api import dispatch
        want_status, want_body = dispatch(method, path, dict(headers), body_for(method))
        status, body, reply_headers = self.call(method, path, body_for(method), headers)
        return (want_status, json.loads(json.dumps(want_body))), (status, body, reply_headers)


def _routing(owner, method, path):
    def test(self):
        _, (status, body, headers) = self.both(method, path, {})
        self.assertNotIn(status, (502, 503, 504), body)
        self.assertNotEqual(body, {"error": "No such API route."})
        self.assertEqual(headers.get("X-Dciac-Service"), owner)
    return test


def _parity(method, path, who):
    def test(self):
        (want_status, want_body), (status, body, _) = self.both(method, path, IDENTITIES[who])
        self.assertEqual(status, want_status, "%s %s as %s: %s vs monolith %s" % (method, path, who, body, want_body))
        if status >= 400:
            # Refusals are deterministic: the same words must reach the caller.
            self.assertEqual(body.get("error"), want_body.get("error"))
    return test


def _health(name):
    def test(self):
        port = self.ports[name]
        status, body, _ = self.call("GET", "/healthz", port=port)
        self.assertEqual((status, body), (200, {"service": name, "ok": True}))
        status, body, _ = self.call("GET", "/readyz", port=port)
        self.assertEqual((status, body.get("ready")), (200, True))
        status, spec, _ = self.call("GET", "/openapi.json", port=port)
        documented = {(m.upper(), p) for p, ops in spec["paths"].items() for m in ops}
        owned = {(m, catalog.PREFIX + t.replace(":path}", "}")) for m, t, _ in catalog.SERVICES[name]["routes"]}
        self.assertEqual(documented, owned)
    return test


for _owner, _method, _template, _path in ROUTES:
    setattr(StackMatrix, "test_routing_%s_%s_%s" % (_owner, _method.lower(), slug(_template)), _routing(_owner, _method, _path))
    for _who in IDENTITIES:
        setattr(StackMatrix, "test_parity_%s_%s_%s_as_%s" % (_owner, _method.lower(), slug(_template), _who), _parity(_method, _path, _who))
for _name in catalog.SERVICES:
    setattr(StackMatrix, "test_health_%s" % _name, _health(_name))


if __name__ == "__main__":
    unittest.main()
