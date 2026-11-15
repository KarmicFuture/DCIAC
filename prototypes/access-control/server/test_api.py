"""Role checks, audit, and the seeded campus."""

import json
import os
import tempfile
import unittest

from server import api, db


class RepositoryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DCIAC_DB"] = os.path.join(self.tmp.name, "test.sqlite")
        db._conn = None
        db.connect()

    def tearDown(self):
        if db._conn is not None:
            db._conn.close()
            db._conn = None
        self.tmp.cleanup()
        os.environ.pop("DCIAC_DB", None)

    def test_seed_matches_the_campus(self):
        world = db.world()
        halls = [item for item in world["locations"] if item["kind"] == "hall"]
        racks = [item for item in world["locations"] if item["kind"] == "rack"]
        cabinets = [item for item in world["assets"] if item["modelId"] == "cabinet-42u"]
        self.assertEqual(len(halls), 10)
        self.assertEqual(len(racks), 200)
        self.assertEqual(len(cabinets), 200)
        self.assertEqual(world["plant"]["itMw"], 24)
        self.assertEqual(world["plant"]["halls"], 10)
        self.assertEqual(world["plant"]["racksPerHall"], 20)
        self.assertEqual(world["plant"]["feeders"], 2)
        self.assertEqual(world["plant"]["coolMw"], 30)
        a14 = next(item for item in cabinets if item["custom"]["rackId"] == "A14")
        self.assertEqual(a14["custom"]["servers"], ["tray-01", "tray-02", "tray-03", "tray-04", "tray-05", "tray-06", "tray-07", "tray-08", "sn2201", "pshelf"])
        self.assertEqual(a14["lifecycle"], "In service")

    def test_readonly_and_operator_cannot_edit_assets(self):
        status, body = api.dispatch("PATCH", "/api/v1/assets/cab-A14", {"x-dciac-user": "colo.readonly", "x-dciac-role": "ReadOnly"}, b'{"lifecycle":"Planned"}')
        self.assertEqual(status, 403)
        self.assertIn("Read only", body["error"])
        status, body = api.dispatch("PATCH", "/api/v1/assets/cab-A14", {"x-dciac-user": "dsvs.operator", "x-dciac-role": "Operator"}, b'{"assetTag":"A14-X"}')
        self.assertEqual(status, 403)
        self.assertIn("Operator", body["error"])
        self.assertEqual(db.asset_by_id("cab-A14")["assetTag"], "A14")
        self.assertEqual(db.audit_log(), [])

    def test_administrator_change_is_audited(self):
        status, _ = api.dispatch("POST", "/api/v1/assets", {}, b"{}")
        self.assertEqual(status, 401)
        status, body = api.dispatch(
            "PATCH",
            "/api/v1/assets/cab-A01",
            {"x-dciac-user": "dsvs.admin", "x-dciac-role": "Administrator"},
            b'{"lifecycle":"Planned","serial":"SN-NEW"}',
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["lifecycle"], "Planned")
        self.assertEqual(body["serial"], "SN-NEW")
        log = db.audit_log()
        self.assertEqual(log[0]["user"], "dsvs.admin")
        self.assertEqual(log[0]["action"], "asset update")
        self.assertEqual(log[0]["assetId"], "cab-A01")
        status, body = api.dispatch(
            "POST",
            "/api/v1/assets",
            {"x-dciac-user": "dsvs.admin", "x-dciac-role": "Administrator"},
            b'{"id":"ups-1","assetTag":"UPS-1","serial":"SN-UPS-1","modelId":"ups","locationId":"yard","lifecycle":"Received"}',
        )
        self.assertEqual(status, 201)
        self.assertEqual(body["lifecycle"], "Received")
        self.assertEqual(db.asset_by_id("ups-1")["locationId"], "yard")

    def test_library_place_checks_fit_and_roles(self):
        models = {item["id"]: item for item in db.models()}
        self.assertIn("dell-r760", models)
        self.assertGreater(models["cabinet-42u"]["usedBy"], 0)
        admin = {"x-dciac-user": "dsvs.admin", "x-dciac-role": "Administrator"}
        status, body = api.dispatch("POST", "/api/v1/placements", {"x-dciac-user": "dsvs.operator", "x-dciac-role": "Operator"}, b'{"modelId":"dell-r760","locationId":"A01"}')
        self.assertEqual(status, 403)
        status, body = api.dispatch("POST", "/api/v1/placements", admin, b'{"modelId":"dell-r760","locationId":"A14"}')
        self.assertEqual(status, 201, body)
        self.assertEqual(body["uPosition"], 1)
        self.assertEqual(body["asset"]["modelId"], "dell-r760")
        status, body = api.dispatch("POST", "/api/v1/models", admin, b'{"id":"too-deep","manufacturer":"Dell","model":"Deep","category":"Server","place":"rack","uHeight":1,"depthMm":4000,"weightKg":10,"nameplateW":100}')
        self.assertEqual(status, 201)
        status, body = api.dispatch("POST", "/api/v1/placements", admin, b'{"modelId":"too-deep","locationId":"A01"}')
        self.assertEqual(status, 409)
        self.assertIn("depth", body["error"].lower())
        status, body = api.dispatch("POST", "/api/v1/models/dell-r760/clone", admin, b"{}")
        self.assertEqual(status, 201)
        self.assertEqual(body["id"], "dell-r760-copy")
        self.assertEqual(db.audit_log()[0]["action"], "model clone")
        csv = "id,manufacturer,model,category,place,uHeight,nameplateW\ncsv-1,Dell,CSV One,Server,rack,1,400\n"
        status, body = api.dispatch("POST", "/api/v1/models/import", admin, json.dumps({"csv": csv}).encode())
        self.assertEqual(status, 200, body)
        self.assertIn("csv-1", body["imported"])


if __name__ == "__main__":
    unittest.main()
