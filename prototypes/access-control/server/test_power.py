import os
import tempfile
import unittest

from server import api, db
from server.power import analyze, upward


def node(node_id, role, side, capacity, nameplate=0, derated=0):
    return {
        "id": node_id,
        "name": node_id,
        "kind": role,
        "side": side,
        "role": role,
        "capacityW": capacity,
        "nameplateW": nameplate,
        "deratedW": derated,
        "deviceId": "",
        "rackId": "",
    }


def edge(edge_id, upstream, downstream):
    return {"id": edge_id, "upstreamId": upstream, "downstreamId": downstream, "capacityW": 1000, "capacityA": 10}


class PowerMathTest(unittest.TestCase):
    def setUp(self):
        self.nodes = [
            node("fa", "source", "A", 1000),
            node("fb", "source", "B", 400),
            node("ma", "distribution", "A", 400),
            node("mb", "distribution", "B", 400),
            node("bus", "distribution", "both", 1000),
            node("rack", "load", "both", 600, 600, 480),
            node("only", "load", "A", 100, 100, 80),
        ]
        self.edges = [
            edge("1", "fa", "ma"),
            edge("2", "fb", "mb"),
            edge("3", "ma", "bus"),
            edge("4", "mb", "bus"),
            edge("5", "bus", "rack"),
            edge("6", "ma", "only"),
        ]

    def test_split_and_single_failure(self):
        normal = analyze(self.nodes, self.edges)
        self.assertEqual(normal["lost"], [])
        self.assertEqual(normal["carried"]["ma"], 400)
        self.assertEqual(normal["carried"]["mb"], 300)
        self.assertTrue(any(item["id"] == "ma" and item["level"] == "critical" for item in normal["over"]))
        failed = analyze(self.nodes, self.edges, "fa")
        lost = {item["id"] for item in failed["lost"]}
        self.assertEqual(lost, {"only"})
        self.assertNotIn("rack", lost)
        self.assertEqual(failed["carried"]["mb"], 600)
        self.assertTrue(any(item["id"] == "mb" and item["percent"] == 150 for item in failed["over"]))
        self.assertFalse(any(item["id"] == "fb" and item["percent"] < 80 for item in failed["over"]))

    def test_eighty_percent_and_derated(self):
        nodes = [
            node("fa", "source", "A", 100),
            node("load", "load", "A", 80, 80, 50),
        ]
        edges = [edge("1", "fa", "load")]
        report = analyze(nodes, edges)
        self.assertEqual(report["over"][0]["level"], "warning")
        self.assertEqual(report["over"][0]["percent"], 80)
        under = analyze([node("fa", "source", "A", 100), node("load", "load", "A", 79, 79, 79)], edges)
        self.assertEqual(under["over"], [])
        derated = analyze(nodes, edges, mode="derated")
        self.assertEqual(derated["carried"]["fa"], 50)
        self.assertEqual(derated["over"], [])

    def test_path_follows_the_matching_side(self):
        hops = upward("rack", self.nodes, self.edges, "B")
        self.assertEqual([item["node"]["id"] for item in hops], ["fb", "mb", "bus", "rack"])


class PowerApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DCIAC_DB"] = os.path.join(self.tmp.name, "test.sqlite")
        db._conn = None
        db.connect()

    def tearDown(self):
        if db._conn:
            db._conn.close()
            db._conn = None
        self.tmp.cleanup()

    def test_campus_failure_and_device_path(self):
        status, body = api.dispatch("GET", "/api/v1/power/nodes/tray-01", {}, b"")
        self.assertEqual(status, 200, body)
        sides = {item["side"]: [hop["node"]["id"] for hop in item["hops"]] for item in body["paths"]}
        self.assertEqual(sides["A"][0], "grid-1")
        self.assertEqual(sides["A"][-1], "psu-tray-01-a")
        self.assertIn("pdu-A14-a", sides["A"])
        self.assertEqual(sides["B"][0], "grid-2")
        status, body = api.dispatch("POST", "/api/v1/power/fail", {}, b'{"nodeId":"grid-1","mode":"nameplate"}')
        self.assertEqual(status, 200, body)
        self.assertEqual(body["lost"], [])
        self.assertEqual(body["over"], [])
        status, body = api.dispatch("POST", "/api/v1/power/fail", {}, b'{"nodeId":"bus-a","mode":"nameplate"}')
        lost = {item["id"] for item in body["lost"]}
        self.assertIn("psu-tray-01-a", lost)
        self.assertIn("rack-A01", lost)
        self.assertNotIn("rack-H2-01", lost)


if __name__ == "__main__":
    unittest.main()
