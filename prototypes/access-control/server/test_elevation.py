import os
import tempfile
import unittest

from server import api, db
from server.elevation import budget, check_move


RACK = {"uHeight": 42, "depthMm": 1200, "weightLimitKg": 1500, "budgetW": 120000}


def gear(asset_id, tag, u, height, **extra):
    item = {
        "id": asset_id,
        "assetTag": tag,
        "model": tag,
        "category": "Server",
        "uPosition": u,
        "uHeight": height,
        "face": "front",
        "width": "full",
        "side": "",
        "weightKg": 10,
        "nameplateW": 500,
        "typicalW": 300,
        "deratedW": 400,
        "powerPorts": 2,
        "netPorts": 2,
        "depthMm": 800,
    }
    item.update(extra)
    return item


class ElevationMathTest(unittest.TestCase):
    def test_budget_counts_unique_u_and_ports(self):
        mounts = [
            gear("a", "srv", 40, 2, category="GPU tray", nameplateW=12000, typicalW=8000, deratedW=10000, powerPorts=1, netPorts=1),
            gear("b", "sw", 22, 1, category="Switch", nameplateW=400, powerPorts=2, netPorts=16),
            gear("c", "pdu", None, 0, category="PDU", powerPorts=24, netPorts=2, nameplateW=0, typicalW=0, deratedW=0),
        ]
        numbers = budget(mounts, RACK)
        self.assertEqual(numbers["usedU"], 3)
        self.assertEqual(numbers["freeU"], 39)
        self.assertEqual(numbers["nameplateW"], 12400)
        self.assertEqual(numbers["powerPortsTotal"], 24)
        self.assertEqual(numbers["powerPortsUsed"], 3)
        self.assertEqual(numbers["powerPortsFree"], 21)
        self.assertEqual(numbers["netPortsTotal"], 16)
        self.assertEqual(numbers["netPortsUsed"], 1)
        self.assertEqual(numbers["netPortsFree"], 15)

    def test_same_face_overlaps_and_rear_does_not(self):
        shelf = gear("shelf", "pshelf", 6, 4, category="PowerShelf", uHeight=4)
        tray = gear("tray", "tray", 8, 2)
        self.assertIn("pshelf", check_move(tray, [shelf], RACK))
        tray["face"] = "rear"
        self.assertEqual(check_move(tray, [shelf], RACK), "")
        left = gear("l", "left", 10, 1, width="half", side="left")
        right = gear("r", "right", 10, 1, width="half", side="right")
        self.assertEqual(check_move(right, [left], RACK), "")

    def test_weight_and_top_of_rack(self):
        heavy = gear("h", "heavy", 1, 1, weightKg=1600)
        self.assertIn("weight", check_move(heavy, [], RACK).lower())
        tall = gear("t", "tall", 42, 2)
        self.assertIn("does not fit", check_move(tall, [], RACK))


class ElevationApiTest(unittest.TestCase):
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

    def test_elevation_and_move(self):
        admin = {"x-dciac-user": "dsvs.admin", "x-dciac-role": "Administrator"}
        status, body = api.dispatch("GET", "/api/v1/racks/A14/elevation", {}, b"")
        self.assertEqual(status, 200, body)
        self.assertEqual(body["rackId"], "A14")
        tags = {item["assetTag"] for item in body["mounts"]}
        self.assertIn("tray-01", tags)
        self.assertIn("rPDU-A", tags)
        self.assertGreater(body["budget"]["budgetW"], 0)
        self.assertEqual(body["budget"]["usedU"], 21)

        status, body = api.dispatch("POST", "/api/v1/moves", {"x-dciac-user": "dsvs.operator", "x-dciac-role": "Operator"}, b'{"assetId":"dev-tray-01","rackId":"A14","uPosition":10,"face":"front"}')
        self.assertEqual(status, 403)

        status, body = api.dispatch("POST", "/api/v1/moves", admin, b'{"assetId":"dev-tray-01","rackId":"A14","uPosition":8,"face":"front"}')
        self.assertEqual(status, 409, body)
        self.assertIn("Overlaps", body["error"])

        status, body = api.dispatch("POST", "/api/v1/moves", admin, b'{"assetId":"dev-tray-01","rackId":"A01","uPosition":10,"face":"front"}')
        self.assertEqual(status, 201, body)
        self.assertEqual(body["asset"]["locationId"], "slot-A01")
        self.assertEqual(body["asset"]["uPosition"], 10)
        self.assertEqual(db.audit_log()[0]["action"], "asset move")

        status, body = api.dispatch("GET", "/api/v1/racks/A01/elevation", {}, b"")
        self.assertEqual(status, 200)
        self.assertTrue(any(item["assetTag"] == "tray-01" and item["uPosition"] == 10 for item in body["mounts"]))


if __name__ == "__main__":
    unittest.main()
