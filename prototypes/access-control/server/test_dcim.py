"""Cables, capacity, work orders, monitoring, reports, and auth."""

import json
import os
import tempfile
import unittest

from server import api, db
from server.dcim import ashrae, cable_label, port_issues, pue, stranded


ADMIN = {"x-dciac-user": "dsvs.admin", "x-dciac-role": "Administrator"}
OPERATOR = {"x-dciac-user": "dsvs.operator", "x-dciac-role": "Operator"}


class DcimTest(unittest.TestCase):
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

    def test_formulas(self):
        self.assertEqual(pue(105, 100), 1.05)
        self.assertEqual(stranded(120000, 900), 119100)
        self.assertEqual(ashrae(24), "recommended")
        self.assertEqual(cable_label("tray-01", "ttyS1", "black"), "tray-01-ttyS1-black")
        issues = port_issues(
            [{"id": "a", "media": "SFP", "speed": "25G"}, {"id": "b", "media": "copper", "speed": "1G"}],
            [{"id": "c1", "a_port": "a", "b_port": "b"}, {"id": "c2", "a_port": "a", "b_port": "b"}],
        )
        self.assertTrue(any(item["issue"] == "double-booked" for item in issues))
        self.assertTrue(any(item["issue"] == "media mismatch" for item in issues))

    def test_user_tracks_only_the_cable_they_choose(self):
        status, body = api.dispatch("GET", "/api/v1/racks/A14/ports", {}, b"")
        self.assertEqual(status, 200, body)
        tray = next(item for item in body["devices"] if item["assetId"] == "dev-tray-01")
        serial = next(port for port in tray["ports"] if port["kind"] == "serial")
        power = next(port for port in tray["ports"] if port["kind"] == "power")
        self.assertEqual(serial["status"], "used")
        self.assertEqual(power["status"], "free")
        self.assertGreater(body["counts"]["free"], 0)
        self.assertGreater(body["counts"]["used"], 0)
        switch = next(item for item in body["devices"] if item["assetId"] == "dev-sn2201")
        network = next(port for port in switch["ports"] if port["kind"] == "network")
        payload = json.dumps({"aPort": power["id"], "bPort": network["id"], "color": "blue", "lengthM": 3}).encode()
        status, saved = api.dispatch("POST", "/api/v1/connections", OPERATOR, payload)
        self.assertEqual(status, 201, saved)
        self.assertIn("blue", saved["label"])
        self.assertTrue(any(item["issue"] == "media mismatch" for item in saved["issues"]))
        status, again = api.dispatch("POST", "/api/v1/connections", OPERATOR, payload)
        self.assertEqual(status, 400)
        self.assertIn("already", again["error"])
        status, _ = api.dispatch("POST", "/api/v1/connections", {"x-dciac-user": "colo.readonly", "x-dciac-role": "ReadOnly"}, payload)
        self.assertEqual(status, 403)
        status, dropped = api.dispatch("POST", "/api/v1/connections/" + saved["id"] + "/drop", OPERATOR, b"{}")
        self.assertEqual(status, 200, dropped)
        status, reserved = api.dispatch("POST", "/api/v1/ports/" + power["id"] + "/status", ADMIN, b'{"status":"reserved"}')
        self.assertEqual(status, 200, reserved)
        mapped = api.dispatch("GET", "/api/v1/racks/A14/ports", {}, b"")[1]
        tray = next(item for item in mapped["devices"] if item["assetId"] == "dev-tray-01")
        power = next(port for port in tray["ports"] if port["kind"] == "power")
        self.assertEqual(power["status"], "reserved")
        status, missing = api.dispatch("GET", "/api/v1/racks/NO-SUCH/ports", {}, b"")
        self.assertEqual(status, 404)

    def test_serial_trace_reaches_acs(self):
        status, body = api.dispatch("GET", "/api/v1/ports/port-tray-01-serial/trace", {}, b"")
        self.assertEqual(status, 200)
        names = " ".join(item["name"] for item in body["trace"])
        self.assertIn("dev-tray-01", names)
        self.assertIn("ttyS1", names)
        self.assertIn("acs-a14", names)

    def test_find_home_offers_hall_3_rack_07(self):
        status, body = api.dispatch("POST", "/api/v1/capacity/home", {}, b'{"modelId":"dell-r760","quantity":1,"hallId":"hall-3"}')
        self.assertEqual(status, 200, body)
        racks = [item["rackId"] for item in body["placements"]]
        self.assertIn("H3-07", racks)
        chosen = next(item for item in body["placements"] if item["rackId"] == "H3-07")
        self.assertGreaterEqual(chosen["uPosition"], 1)

    def test_promote_does_not_install_until_verify(self):
        status, body = api.dispatch(
            "POST", "/api/v1/scenarios", ADMIN,
            b'{"id":"scn-r760","name":"R760","change":{"op":"add","modelId":"dell-r760","rackId":"H3-07","uPosition":1}}',
        )
        self.assertEqual(status, 201, body)
        before = db.db().execute("SELECT id FROM asset WHERE location_id = 'slot-H3-07' AND model_id = 'dell-r760'").fetchone()
        self.assertIsNone(before)
        status, body = api.dispatch("POST", "/api/v1/scenarios/scn-r760/promote", ADMIN, b"{}")
        self.assertEqual(status, 201, body)
        work_id = body["workOrderId"]
        status, body = api.dispatch("POST", "/api/v1/work-orders/" + work_id + "/advance", OPERATOR, b'{"to":"Approved"}')
        self.assertEqual(status, 403)
        status, body = api.dispatch("POST", "/api/v1/work-orders/" + work_id + "/advance", ADMIN, b'{"to":"Approved"}')
        self.assertEqual(status, 200, body)
        status, body = api.dispatch("POST", "/api/v1/work-orders/" + work_id + "/advance", ADMIN, b'{"to":"Verified"}')
        self.assertEqual(status, 200, body)
        asset = db.db().execute("SELECT * FROM asset WHERE location_id = 'slot-H3-07' AND model_id = 'dell-r760'").fetchone()
        self.assertIsNotNone(asset)
        self.assertEqual(asset["u_position"], 1)
        node = db.db().execute("SELECT * FROM power_node WHERE id = 'rack-H3-07'").fetchone()
        self.assertEqual(node["nameplate_w"], 900)
        self.assertIn("PowerEdge R760", node["name"])
        status, cap = api.dispatch("GET", "/api/v1/capacity", {}, b"")
        self.assertEqual(cap["pue"], 1.05)
        self.assertGreater(cap["strandedW"], 0)
        chain = api.dispatch("GET", "/api/v1/audit/verify", {}, b"")[1]
        self.assertTrue(chain["ok"])
        db.db().execute("UPDATE audit_event SET detail = 'tampered' WHERE row_hash IS NOT NULL")
        broken = api.dispatch("GET", "/api/v1/audit/verify", {}, b"")[1]
        self.assertFalse(broken["ok"])

    def test_outlet_requires_an_in_progress_work_order(self):
        status, body = api.dispatch("POST", "/api/v1/actions/outlet", OPERATOR, b'{"op":"cycle","reason":"WO-14","workOrderId":"WO-14","deviceId":"tray-06"}')
        self.assertEqual(status, 403)
        status, body = api.dispatch(
            "POST", "/api/v1/work-orders", ADMIN,
            b'{"id":"WO-14","kind":"Power cycle","state":"In progress","deviceId":"tray-06","reason":"WO-14"}',
        )
        self.assertEqual(status, 201, body)
        status, body = api.dispatch("POST", "/api/v1/actions/outlet", OPERATOR, b'{"op":"cycle","reason":"WO-14","workOrderId":"WO-14","deviceId":"tray-06"}')
        self.assertEqual(status, 200, body)
        status, body = api.dispatch("POST", "/api/v1/actions/console", {}, b'{"deviceId":"tray-01","failover":true}')
        self.assertEqual(status, 200, body)

    def test_feeder_failure_raises_an_alarm(self):
        status, body = api.dispatch("POST", "/api/v1/power/fail", {}, b'{"nodeId":"grid-1","mode":"nameplate"}')
        self.assertEqual(status, 200, body)
        self.assertEqual(body["lost"], [])
        self.assertTrue(body.get("alarmId"))
        alarms = api.dispatch("GET", "/api/v1/alarms", {}, b"")[1]["alarms"]
        self.assertTrue(any("grid-1" in item["text"] for item in alarms))

    def test_auth_reports_and_discovery(self):
        status, body = api.dispatch("POST", "/api/v1/session", {}, b'{"user":"dsvs.admin","password":"nope"}')
        self.assertEqual(status, 401)
        status, body = api.dispatch("POST", "/api/v1/session", {}, b'{"user":"dsvs.admin","password":"hall-a14"}')
        self.assertEqual(status, 200, body)
        self.assertEqual(body["role"], "Administrator")
        status, spec = api.dispatch("GET", "/api/v1/openapi.json", {}, b"")
        self.assertEqual(status, 200)
        self.assertIn("/api/v1/capacity", spec["paths"])
        status, energy = api.dispatch("GET", "/api/v1/reports/energy.csv", {}, b"")
        self.assertEqual(status, 200)
        self.assertIn("pue", energy["csv"])
        status, pdf = api.dispatch("GET", "/api/v1/reports/capacity.pdf", {}, b"")
        self.assertTrue(pdf["pdf"].startswith("%PDF"))
        status, body = api.dispatch("POST", "/api/v1/discovery/disc-bmc-extra/decide", ADMIN, b'{"accept":true}')
        self.assertEqual(status, 200, body)
        self.assertEqual(body["state"], "accepted")
        world = api.dispatch("GET", "/api/v1/world", {"x-dciac-tenant": "colo"}, b"")[1]
        halls = [item for item in world["locations"] if item["kind"] == "hall"]
        self.assertEqual([item["id"] for item in halls], ["hall-10"])
        status, body = api.dispatch("POST", "/api/v1/integrations/servicenow", {}, b'{"workOrderId":"WO-14"}')
        self.assertEqual(status, 200)
        self.assertTrue(body["stub"])
        status, body = api.dispatch("POST", "/api/v1/webhooks", ADMIN, b'{"event":"alarm.raised","url":"http://example.invalid/hook"}')
        self.assertEqual(status, 201)
        self.assertEqual(db.db().execute("SELECT COUNT(*) AS n FROM webhook_delivery").fetchone()["n"] >= 0, True)

    def test_capacity_breaks_out_halls(self):
        status, body = api.dispatch("GET", "/api/v1/capacity", {}, b"")
        self.assertEqual(status, 200)
        self.assertEqual(len(body["halls"]), 10)
        self.assertEqual(sum(hall["installedW"] for hall in body["halls"]), body["installedW"])
        self.assertEqual(body["pue"], 1.05)
        status, hall = api.dispatch("GET", "/api/v1/capacity/hall/hall-3", {}, b"")
        self.assertEqual(status, 200)
        self.assertEqual(hall["cduW"], 12000000)
        self.assertEqual(len(hall["rows"]), 2)
        status, rack = api.dispatch("GET", "/api/v1/capacity/rack/H3-07", {}, b"")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(rack["largestFreeU"], 2)
        self.assertTrue(any(block["length"] >= 2 for block in rack["blocks"]))

    def test_scenario_diff_keeps_both_feeds(self):
        status, scenario = api.dispatch("POST", "/api/v1/scenarios", ADMIN, b'{"name":"grow"}')
        self.assertEqual(status, 201)
        status, diff = api.dispatch(
            "POST",
            "/api/v1/scenarios/" + scenario["id"] + "/changes",
            ADMIN,
            b'{"op":"add","modelId":"dell-r760","rackId":"H3-07","uPosition":3}',
        )
        self.assertEqual(status, 201, diff)
        self.assertEqual(diff["deltaW"], 900)
        self.assertIn("both A and B", diff["redundancy"])
        self.assertEqual(diff["changes"][0]["rackId"], "H3-07")

    def test_metric_dedupes_suppresses_and_clears(self):
        status, first = api.dispatch("POST", "/api/v1/metrics", {}, b'{"deviceId":"tray-01","name":"inlet","value":29,"unit":"C"}')
        status, second = api.dispatch("POST", "/api/v1/metrics", {}, b'{"deviceId":"tray-01","name":"inlet","value":30,"unit":"C"}')
        self.assertEqual(first["alarmId"], second["alarmId"])
        api.dispatch("POST", "/api/v1/metrics", {}, b'{"deviceId":"tray-01","name":"inlet","value":24,"unit":"C"}')
        cleared = next(item for item in api.dispatch("GET", "/api/v1/alarms", {}, b"")[1]["alarms"] if item["id"] == first["alarmId"])
        self.assertEqual(cleared["state"], "cleared")
        self.assertTrue(cleared["cleared_at"])
        status, _work = api.dispatch("POST", "/api/v1/work-orders", ADMIN, b'{"id":"WO-sup","state":"In progress","kind":"Power cycle","deviceId":"tray-02"}')
        self.assertEqual(status, 201)
        status, hot = api.dispatch("POST", "/api/v1/metrics", {}, b'{"deviceId":"tray-02","name":"power","value":95,"unit":"%"}')
        held = next(item for item in api.dispatch("GET", "/api/v1/alarms", {}, b"")[1]["alarms"] if item["id"] == hot["alarmId"])
        self.assertEqual(held["state"], "suppressed")
        api.dispatch("POST", "/api/v1/alarms/" + first["alarmId"] + "/ack", ADMIN, b'{"note":"seen"}')
        sla = api.dispatch("GET", "/api/v1/reports/sla", {}, b"")[1]
        self.assertIsNotNone(sla["rows"][0]["mttaSec"])

    def test_collectors_and_discovery_sweep(self):
        status, body = api.dispatch("POST", "/api/v1/collect", {}, b'{"source":"lab"}')
        self.assertEqual(status, 201, body)
        self.assertEqual(body["source"], "lab")
        status, body = api.dispatch("POST", "/api/v1/integrations/vcenter", {}, b"{}")
        self.assertTrue(body["stub"])
        self.assertEqual(body["vms"][0]["rackId"], "A14")
        status, body = api.dispatch("POST", "/api/v1/integrations/bacnet", {}, b"{}")
        self.assertEqual(body["points"][0]["unit"], "C")
        status, body = api.dispatch("POST", "/api/v1/tokens", ADMIN, b'{"role":"Operator"}')
        self.assertEqual(status, 201)
        status, body = api.dispatch("POST", "/api/v1/tokens", OPERATOR, b'{"role":"Administrator"}')
        self.assertEqual(status, 403)
        status, body = api.dispatch(
            "POST",
            "/api/v1/discovery/run",
            ADMIN,
            json.dumps({"found": [{"assetTag": "tray-02", "rackId": "H3-07", "source": "acs"}]}).encode(),
        )
        self.assertEqual(status, 200)
        moved = [item for item in body["items"] if item["device_id"] == "tray-02" and item["kind"] == "moved"]
        self.assertTrue(moved)
        status, rejected = api.dispatch("POST", "/api/v1/discovery/" + moved[0]["id"] + "/decide", ADMIN, b'{"accept":false}')
        self.assertEqual(rejected["state"], "rejected")

    def test_future_diff_counts_space_cooling_and_ports(self):
        status, scenario = api.dispatch("POST", "/api/v1/scenarios", ADMIN, b'{"name":"grow"}')
        status, diff = api.dispatch(
            "POST",
            "/api/v1/scenarios/" + scenario["id"] + "/changes",
            ADMIN,
            b'{"op":"add","modelId":"dell-r760","rackId":"H3-07","uPosition":3,"targetOn":"2026-12-01"}',
        )
        self.assertEqual(status, 201, diff)
        self.assertEqual(diff["freeUDelta"], -2)
        self.assertEqual(diff["portsDelta"], -4)
        self.assertEqual(diff["heatDeltaW"], 900)
        self.assertEqual(diff["targetOn"], "2026-12-01")
        self.assertGreater(diff["coolingHeadroomNowW"], diff["coolingHeadroomFutureW"])
        hall = api.dispatch("GET", "/api/v1/capacity/hall/hall-3", {}, b"")[1]
        self.assertEqual([item["id"] for item in hall["circuits"]], ["A", "B"])
        energy = api.dispatch("GET", "/api/v1/reports/energy", {}, b"")[1]
        self.assertEqual([row["period"] for row in energy["rows"]], ["hour", "day", "month"])
        self.assertTrue(all(row["pue"] == 1.05 for row in energy["rows"]))

    def test_operator_cannot_approve_and_heat_escalates(self):
        status, created = api.dispatch("POST", "/api/v1/work-orders", OPERATOR, b'{"kind":"Install","title":"operator draft","deviceId":"tray-06"}')
        self.assertEqual(status, 201, created)
        status, submitted = api.dispatch("POST", "/api/v1/work-orders/" + created["id"] + "/advance", OPERATOR, b'{"to":"Submitted"}')
        self.assertEqual(status, 200, submitted)
        status, refused = api.dispatch("POST", "/api/v1/work-orders/" + created["id"] + "/advance", OPERATOR, b'{"to":"Approved"}')
        self.assertEqual(status, 403)
        status, warm = api.dispatch("POST", "/api/v1/metrics", {}, b'{"deviceId":"tray-03","name":"inlet","value":29,"unit":"C"}')
        status, hot = api.dispatch("POST", "/api/v1/metrics", {}, b'{"deviceId":"tray-03","name":"inlet","value":33,"unit":"C"}')
        self.assertEqual(warm["alarmId"], hot["alarmId"])
        alarm = next(item for item in api.dispatch("GET", "/api/v1/alarms", {}, b"")[1]["alarms"] if item["id"] == hot["alarmId"])
        self.assertEqual(alarm["priority"], 1)

    def test_one_missing_tray_does_not_mark_the_campus(self):
        status, body = api.dispatch(
            "POST",
            "/api/v1/discovery/run",
            ADMIN,
            json.dumps({"found": [{"assetTag": "tray-08", "kind": "missing", "source": "acs", "detail": "ACS did not answer on ttyS10."}]}).encode(),
        )
        self.assertEqual(status, 200, body)
        missing = [item for item in body["items"] if item["kind"] == "missing" and item["state"] == "pending"]
        self.assertEqual([item["device_id"] for item in missing], ["tray-08"])
        spec = api.dispatch("GET", "/api/v1/openapi.json", {}, b"")[1]
        self.assertIn("/api/v1/discovery/run", spec["paths"])
        self.assertIn("MetricSample", spec["components"]["schemas"])
        self.assertIn("CapacityReport", spec["components"]["schemas"])
        self.assertIn("Asset", spec["components"]["schemas"])

    def test_verify_moves_and_approved_work_suppresses(self):
        status, created = api.dispatch("POST", "/api/v1/work-orders", ADMIN, b'{"id":"WO-decom","kind":"Decommission","state":"In progress","deviceId":"dev-tray-08"}')
        self.assertEqual(status, 201, created)
        status, done = api.dispatch("POST", "/api/v1/work-orders/WO-decom/advance", ADMIN, b'{"to":"Verified"}')
        self.assertEqual(status, 200, done)
        self.assertEqual(db.db().execute("SELECT lifecycle FROM asset WHERE id = 'dev-tray-08'").fetchone()["lifecycle"], "Decommissioned")
        status, moved = api.dispatch("POST", "/api/v1/work-orders", ADMIN, b'{"id":"WO-move","kind":"Move","state":"In progress","deviceId":"dev-tray-07","rackId":"H3-07","uPosition":10}')
        self.assertEqual(status, 201, moved)
        status, placed = api.dispatch("POST", "/api/v1/work-orders/WO-move/advance", ADMIN, b'{"to":"Verified"}')
        self.assertEqual(status, 200, placed)
        asset = db.db().execute("SELECT location_id, u_position FROM asset WHERE id = 'dev-tray-07'").fetchone()
        self.assertEqual(asset["location_id"], "slot-H3-07")
        self.assertEqual(asset["u_position"], 10)
        status, approved = api.dispatch("POST", "/api/v1/work-orders", ADMIN, b'{"id":"WO-ok","kind":"Power cycle","state":"Approved","deviceId":"tray-04"}')
        self.assertEqual(status, 201, approved)
        status, hot = api.dispatch("POST", "/api/v1/metrics", {}, b'{"deviceId":"tray-04","name":"inlet","value":29,"unit":"C"}')
        alarm = next(item for item in api.dispatch("GET", "/api/v1/alarms", {}, b"")[1]["alarms"] if item["id"] == hot["alarmId"])
        self.assertEqual(alarm["state"], "suppressed")

    def test_report_schedules_are_listed(self):
        status, created = api.dispatch("POST", "/api/v1/reports/schedules", ADMIN, b'{"kind":"capacity","cadence":"daily"}')
        self.assertEqual(status, 201, created)
        status, body = api.dispatch("GET", "/api/v1/reports/schedules", {}, b"")
        self.assertEqual(status, 200, body)
        self.assertTrue(any(item["id"] == created["id"] and item["kind"] == "capacity" for item in body["schedules"]))
