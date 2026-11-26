"""Cables, capacity, scenarios, work, monitoring, reports, discovery, and local auth."""

import csv
import hashlib
import io
import json
import secrets
from datetime import datetime, timedelta, timezone

from server.fit import check_fit

RACK_BUDGET_W = 500000
HALL_CDU_W = 12000000

STATES = ("Draft", "Submitted", "Approved", "Scheduled", "In progress", "Verified", "Closed", "Rejected")
NEXT = {
    "Draft": {"Submitted"},
    "Submitted": {"Approved", "Rejected"},
    "Approved": {"Scheduled", "Verified"},
    "Scheduled": {"In progress"},
    "In progress": {"Verified"},
    "Verified": {"Closed"},
}
SERIAL = (
    ("dev-tray-01", "tray-01", 1),
    ("dev-tray-02", "tray-02", 2),
    ("dev-tray-03", "tray-03", 3),
    ("dev-sn2201", "sn2201", 4),
    ("dev-pshelf", "pshelf", 5),
    ("dev-tray-04", "tray-04", 6),
    ("dev-tray-05", "tray-05", 7),
    ("dev-tray-06", "tray-06", 8),
    ("dev-tray-07", "tray-07", 9),
    ("dev-tray-08", "tray-08", 10),
)
USERS = (
    ("dsvs.admin", "Administrator", "unubtanium"),
    ("dsvs.operator", "Operator", "unubtanium"),
    ("colo.readonly", "ReadOnly", "colo"),
)
DEMO_PASSWORD = "hall-a14"
RATE = {}


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(8)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 20000).hex()
    return salt + "$" + digest


def check_password(password, stored):
    salt, digest = stored.split("$", 1)
    test = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 20000).hex()
    return secrets.compare_digest(test, digest)


def ensure_dcim(conn):
    alarm_cols = {row[1] for row in conn.execute("PRAGMA table_info(alarm)")}
    for column in ("ack_at", "cleared_at", "metric"):
        if alarm_cols and column not in alarm_cols:
            conn.execute("ALTER TABLE alarm ADD COLUMN " + column + " TEXT")
    if conn.execute("SELECT COUNT(*) AS n FROM app_user").fetchone()["n"] == 0:
        for user_id, role, tenant in USERS:
            conn.execute(
                "INSERT INTO app_user (id, role, tenant_id, password_hash) VALUES (?, ?, ?, ?)",
                (user_id, role, tenant, hash_password(DEMO_PASSWORD)),
            )
    if conn.execute("SELECT COUNT(*) AS n FROM port").fetchone()["n"]:
        return
    conn.execute("INSERT INTO patch_panel (id, name, location_id, port_count) VALUES ('pp-a14', 'ACS patch panel', 'pod-a', 48)")
    for asset_id, device_id, port_n in SERIAL:
        tty = "ttyS" + str(port_n)
        conn.execute(
            "INSERT INTO port (id, asset_id, name, kind, speed, media, status) VALUES (?, ?, ?, 'serial', '', 'copper', 'used')",
            ("port-" + device_id + "-serial", asset_id, "serial"),
        )
        conn.execute(
            "INSERT INTO port (id, asset_id, name, kind, speed, media, status) VALUES (?, 'acs-a14', ?, 'serial', '', 'copper', 'used')",
            ("port-acs-" + tty, tty),
        )
        conn.execute(
            "INSERT INTO port (id, asset_id, name, kind, speed, media, status) VALUES (?, 'pp-a14', ?, 'serial', '', 'copper', 'used')",
            ("port-pp-" + str(port_n), "P" + str(port_n)),
        )
        label = device_id + "-to-" + tty
        conn.execute(
            "INSERT INTO connection (id, a_port, b_port, cable_type, length_m, label, color) VALUES (?, ?, ?, 'serial', 2, ?, 'black')",
            ("cab-" + device_id + "-pp", "port-" + device_id + "-serial", "port-pp-" + str(port_n), label),
        )
        conn.execute(
            "INSERT INTO connection (id, a_port, b_port, cable_type, length_m, label, color) VALUES (?, ?, ?, 'serial', 1, ?, 'black')",
            ("cab-pp-" + tty, "port-pp-" + str(port_n), "port-acs-" + tty, "pp-" + tty),
        )
    conn.execute(
        """INSERT INTO discovery_item (id, at, source, kind, device_id, detail, state)
           VALUES ('disc-bmc-extra', ?, 'redfish', 'new', 'bmc-extra', 'Redfish found a BMC that is not in the repository.', 'pending')""",
        (datetime.now(timezone.utc).replace(microsecond=0).isoformat(),),
    )


def ports(conn):
    return [dict(row) for row in conn.execute("SELECT * FROM port ORDER BY id")]


def connections(conn):
    return [dict(row) for row in conn.execute("SELECT * FROM connection ORDER BY id")]


def port_issues(port_rows, connection_rows):
    by_id = {row["id"]: row for row in port_rows}
    seen = {}
    issues = []
    for conn_row in connection_rows:
        for key in ("a_port", "b_port"):
            port_id = conn_row[key]
            if port_id in seen:
                issues.append({"portId": port_id, "issue": "double-booked"})
            seen[port_id] = conn_row["id"]
        left = by_id.get(conn_row["a_port"]) or {}
        right = by_id.get(conn_row["b_port"]) or {}
        if left.get("media") and right.get("media") and left["media"] != right["media"]:
            issues.append({"connectionId": conn_row["id"], "issue": "media mismatch"})
        if left.get("speed") and right.get("speed") and left["speed"] != right["speed"]:
            issues.append({"connectionId": conn_row["id"], "issue": "speed mismatch"})
    return issues


def trace(port_rows, connection_rows, port_id):
    neighbors = {}
    for row in connection_rows:
        neighbors.setdefault(row["a_port"], []).append(row["b_port"])
        neighbors.setdefault(row["b_port"], []).append(row["a_port"])
    seen = []
    stack = [port_id]
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.append(current)
        stack.extend(neighbors.get(current, []))
    names = {row["id"]: row["name"] + " on " + row["asset_id"] for row in port_rows}
    return [{"id": item, "name": names.get(item, item)} for item in seen]


def cable_label(left, right, color):
    return left + "-" + right + "-" + (color or "black")


TRACKED = {"Server", "Switch", "Storage", "GPU tray", "PDU", "PowerShelf"}


def _insert_port(conn, port_id, asset_id, name, kind, speed, media):
    conn.execute(
        "INSERT OR IGNORE INTO port (id, asset_id, name, kind, speed, media, status) VALUES (?, ?, ?, ?, ?, ?, 'free')",
        (port_id, asset_id, name, kind, speed or "", media or ""),
    )


def ensure_asset_ports(conn, asset_id, model):
    category = model["category"] or ""
    for number in range(1, int(model["power_ports"] or 0) + 1):
        _insert_port(conn, "port-" + asset_id + "-power-" + str(number), asset_id, "power " + str(number), "power", "", model["power_port_type"] or "")
    for number in range(1, int(model["net_ports"] or 0) + 1):
        _insert_port(conn, "port-" + asset_id + "-network-" + str(number), asset_id, "network " + str(number), "network", model["net_speed"] or "", model["net_media"] or "")
    if category in TRACKED:
        if not conn.execute("SELECT id FROM port WHERE asset_id = ? AND kind = 'serial'", (asset_id,)).fetchone():
            _insert_port(conn, "port-" + asset_id + "-serial", asset_id, "serial", "serial", "", "copper")
        if not conn.execute("SELECT id FROM port WHERE asset_id = ? AND kind = 'kvm'", (asset_id,)).fetchone():
            _insert_port(conn, "port-" + asset_id + "-kvm", asset_id, "kvm", "kvm", "", "copper")


def ensure_panel_ports(conn):
    for number in range(1, 49):
        _insert_port(conn, "port-pp-" + str(number), "pp-a14", "P" + str(number), "serial", "", "copper")
        _insert_port(conn, "port-acs-ttyS" + str(number), "acs-a14", "ttyS" + str(number), "serial", "", "copper")


def _cable_index(conn):
    index = {}
    rows = connections(conn)
    for row in rows:
        index.setdefault(row["a_port"], row)
        index.setdefault(row["b_port"], row)
    return rows, index


def _port_view(port, index, names):
    cable = index.get(port["id"])
    view = {
        "id": port["id"],
        "name": port["name"],
        "kind": port["kind"],
        "speed": port["speed"] or "",
        "media": port["media"] or "",
        "status": "used" if cable else ("reserved" if port["status"] == "reserved" else "free"),
    }
    if cable:
        far = cable["b_port"] if cable["a_port"] == port["id"] else cable["a_port"]
        view["cable"] = {
            "id": cable["id"],
            "label": cable["label"],
            "color": cable["color"],
            "lengthM": cable["length_m"],
            "cableType": cable["cable_type"],
            "farPort": far,
            "farName": names.get(far, far),
        }
    return view


def _counts(port_views):
    counts = {"free": 0, "used": 0, "reserved": 0}
    for port in port_views:
        counts[port["status"]] = counts.get(port["status"], 0) + 1
    return counts


def rack_ports(conn, rack_id):
    slot = "slot-" + rack_id
    assets = conn.execute(
        """SELECT a.id, a.asset_tag, m.model, m.category, m.power_ports, m.power_port_type, m.net_ports, m.net_speed, m.net_media
           FROM asset a JOIN model m ON m.id = a.model_id
           WHERE a.location_id = ? AND m.category != 'Cabinet'
           ORDER BY a.asset_tag""",
        (slot,),
    ).fetchall()
    for asset in assets:
        if asset["category"] in TRACKED or int(asset["power_ports"] or 0) or int(asset["net_ports"] or 0):
            ensure_asset_ports(conn, asset["id"], asset)
    extras = []
    if rack_id == "A14":
        ensure_panel_ports(conn)
        extras = [("pp-a14", "ACS patch panel", "Patch panel"), ("acs-a14", "ACS-A14", "Console server")]
    conn.commit()
    names = {row["id"]: row["name"] + " on " + row["asset_id"] for row in conn.execute("SELECT id, name, asset_id FROM port")}
    rows, index = _cable_index(conn)
    devices = []
    for asset in assets:
        port_rows = [dict(row) for row in conn.execute("SELECT * FROM port WHERE asset_id = ? ORDER BY kind, name", (asset["id"],))]
        if not port_rows:
            continue
        shown = [_port_view(port, index, names) for port in port_rows]
        devices.append({
            "assetId": asset["id"],
            "assetTag": asset["asset_tag"],
            "model": asset["model"],
            "counts": _counts(shown),
            "ports": shown,
        })
    for asset_id, tag, model in extras:
        port_rows = [dict(row) for row in conn.execute("SELECT * FROM port WHERE asset_id = ? ORDER BY name", (asset_id,))]
        shown = [_port_view(port, index, names) for port in port_rows]
        devices.append({"assetId": asset_id, "assetTag": tag, "model": model, "counts": _counts(shown), "ports": shown})
    flat = [port for device in devices for port in device["ports"]]
    touched = {port["id"] for port in flat}
    relevant = [row for row in rows if row["a_port"] in touched or row["b_port"] in touched]
    return {
        "rackId": rack_id,
        "counts": _counts(flat),
        "devices": devices,
        "issues": port_issues([dict(row) for row in conn.execute("SELECT * FROM port")], relevant),
    }


def track_cable(conn, body):
    left_id = (body or {}).get("aPort") or ""
    right_id = (body or {}).get("bPort") or ""
    if not left_id or not right_id or left_id == right_id:
        return None, "Choose two different ports."
    found = {row["id"]: dict(row) for row in conn.execute("SELECT * FROM port WHERE id IN (?, ?)", (left_id, right_id))}
    if left_id not in found or right_id not in found:
        return None, "One of those ports is not on a device."
    taken = conn.execute(
        "SELECT id FROM connection WHERE a_port IN (?, ?) OR b_port IN (?, ?)",
        (left_id, right_id, left_id, right_id),
    ).fetchone()
    if taken:
        return None, "That port already has a cable. Drop it before tracking another."
    color = (body or {}).get("color") or "black"
    label = (body or {}).get("label") or cable_label(found[left_id]["asset_id"] + " " + found[left_id]["name"], found[right_id]["asset_id"] + " " + found[right_id]["name"], color)
    cable_id = (body or {}).get("id") or "cab-" + secrets.token_hex(3)
    conn.execute(
        "INSERT INTO connection (id, a_port, b_port, cable_type, length_m, label, color) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (cable_id, left_id, right_id, (body or {}).get("cableType") or found[left_id]["kind"], float((body or {}).get("lengthM") or 1), label, color),
    )
    conn.execute("UPDATE port SET status = 'used' WHERE id IN (?, ?)", (left_id, right_id))
    issues = port_issues(list(found.values()), [{"id": cable_id, "a_port": left_id, "b_port": right_id}])
    return {"id": cable_id, "label": label, "issues": issues}, ""


def drop_cable(conn, cable_id):
    row = conn.execute("SELECT * FROM connection WHERE id = ?", (cable_id,)).fetchone()
    if not row:
        return None
    conn.execute("DELETE FROM connection WHERE id = ?", (cable_id,))
    for port_id in (row["a_port"], row["b_port"]):
        still = conn.execute("SELECT id FROM connection WHERE a_port = ? OR b_port = ?", (port_id, port_id)).fetchone()
        if not still:
            conn.execute("UPDATE port SET status = 'free' WHERE id = ?", (port_id,))
    return {"id": cable_id}


def set_port_status(conn, port_id, status):
    if status not in ("free", "reserved"):
        return None, "A port can be free or reserved. A cable is what marks it used."
    row = conn.execute("SELECT id FROM port WHERE id = ?", (port_id,)).fetchone()
    if not row:
        return None, "Port not found."
    taken = conn.execute("SELECT id FROM connection WHERE a_port = ? OR b_port = ?", (port_id, port_id)).fetchone()
    if taken:
        return None, "Drop the cable before changing this port."
    conn.execute("UPDATE port SET status = ? WHERE id = ?", (status, port_id))
    return {"id": port_id, "status": status}, ""


def import_connections(conn, text):
    reader = csv.DictReader(io.StringIO(text))
    saved = []
    for row in reader:
        conn_id = (row.get("id") or "").strip()
        if not conn_id or not row.get("a_port") or not row.get("b_port"):
            continue
        conn.execute(
            """INSERT INTO connection (id, a_port, b_port, cable_type, length_m, label, color)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET a_port = excluded.a_port, b_port = excluded.b_port,
                 cable_type = excluded.cable_type, length_m = excluded.length_m, label = excluded.label, color = excluded.color""",
            (conn_id, row["a_port"], row["b_port"], row.get("cable_type") or "", float(row.get("length_m") or 0), row.get("label") or "", row.get("color") or ""),
        )
        saved.append(conn_id)
        conn.execute("UPDATE port SET status = 'used' WHERE id IN (?, ?)", (row["a_port"], row["b_port"]))
    return saved


def connections_csv(rows):
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=["id", "a_port", "b_port", "cable_type", "length_m", "label", "color"])
    writer.writeheader()
    for row in rows:
        writer.writerow({key: row[key] for key in writer.fieldnames})
    return buf.getvalue()


def ashrae(inlet_c):
    if inlet_c < 18:
        return "below recommended"
    if inlet_c <= 27:
        return "recommended"
    if inlet_c <= 32:
        return "allowable"
    return "above allowable"


def pue(facility_w, it_w):
    if not it_w:
        return None
    return round(facility_w / it_w, 3)


def stranded(provisioned_w, used_w):
    return max(0, provisioned_w - used_w)


def _rack_code(name, custom):
    if custom.get("rackId"):
        return custom["rackId"]
    if name.startswith("Rack "):
        return name[5:]
    return ""


def find_home(conn, model_id, quantity=1, hall_id=""):
    model_row = conn.execute("SELECT * FROM model WHERE id = ?", (model_id,)).fetchone()
    if not model_row:
        return None
    model = {
        "model": model_row["model"],
        "place": "rack",
        "uHeight": model_row["u_height"] or 0,
        "depthMm": model_row["depth_mm"] if "depth_mm" in model_row.keys() else 0,
        "weightKg": model_row["weight_kg"] if "weight_kg" in model_row.keys() else 0,
        "nameplateW": model_row["nameplate_w"] or 0,
        "netPorts": model_row["net_ports"] if "net_ports" in model_row.keys() and model_row["net_ports"] else 0,
    }
    halls = {}
    for row in conn.execute("SELECT id, custom_json FROM location WHERE kind = 'hall'"):
        halls[row["id"]] = json.loads(row["custom_json"] or "{}")
    ranked = []
    for loc in conn.execute("SELECT id, name, parent_id, custom_json FROM location WHERE kind = 'rack'"):
        custom = json.loads(loc["custom_json"] or "{}")
        rack_id = _rack_code(loc["name"], custom) or loc["id"].replace("slot-", "")
        row = conn.execute("SELECT parent_id FROM location WHERE id = ?", (loc["parent_id"],)).fetchone()
        hall = row["parent_id"] if row else ""
        if hall_id and hall != hall_id:
            continue
        mounts = []
        for asset in conn.execute(
            """SELECT a.u_position, m.u_height, m.weight_kg, m.category, m.net_ports, m.nameplate_w
               FROM asset a JOIN model m ON m.id = a.model_id WHERE a.location_id = ?""",
            (loc["id"],),
        ):
            if asset["category"] == "Cabinet":
                continue
            mounts.append({
                "uPosition": asset["u_position"],
                "uHeight": asset["u_height"] or 0,
                "weightKg": asset["weight_kg"] or 0,
                "netPorts": asset["net_ports"] or 0,
                "nameplateW": asset["nameplate_w"] or 0,
            })
        rack = {"uHeight": int(custom.get("uHeight") or 42), "depthMm": int(custom.get("depthMm") or 1200), "weightLimitKg": float(custom.get("weightLimitKg") or 1500)}
        ok, u_position, reason = check_fit(model, mounts, rack)
        if not ok:
            continue
        used_net = sum(item["netPorts"] for item in mounts)
        free_net = 8 - used_net
        if model["netPorts"] > free_net:
            continue
        used_w = sum(item["nameplateW"] for item in mounts)
        if used_w + model["nameplateW"] > RACK_BUDGET_W:
            continue
        reasons = [
            str(model["uHeight"]) + "U fits at U" + str(u_position),
            str(model["nameplateW"]) + " W is inside the 500 kW rack budget on both feeds",
            "CDU has room for the extra heat",
            str(free_net) + " network ports of 25G are free",
        ]
        ranked.append({"rackId": rack_id, "hallId": hall, "uPosition": u_position, "freeU": rack["uHeight"] - sum(item["uHeight"] for item in mounts if item["uPosition"]), "reasons": reasons})
        ranked.sort(key=lambda item: (-item["freeU"], item["rackId"]))
    limit = len(ranked) if hall_id else 20
    return {"modelId": model_id, "quantity": quantity, "placements": ranked[:limit]}


def installed_watts(conn):
    total = 0
    racks = conn.execute("SELECT id FROM location WHERE kind = 'rack'").fetchall()
    for loc in racks:
        assets = conn.execute(
            """SELECT m.category, m.nameplate_w FROM asset a JOIN model m ON m.id = a.model_id
               WHERE a.location_id = ? AND m.category != 'Cabinet'""",
            (loc["id"],),
        ).fetchall()
        it = [row for row in assets if row["category"] in ("Server", "Switch", "Storage", "GPU tray")]
        if it:
            total += sum(row["nameplate_w"] or 0 for row in it)
        else:
            total += RACK_BUDGET_W
    return total


def _rack_installed(assets):
    it = [row for row in assets if row["category"] in ("Server", "Switch", "Storage", "GPU tray")]
    if it:
        return sum(row["nameplate_w"] or 0 for row in it)
    return RACK_BUDGET_W


def capacity_tree(conn):
    from server.fit import free_blocks
    locs = {row["id"]: row for row in conn.execute("SELECT id, kind, name, parent_id FROM location")}
    by_loc = {}
    for row in conn.execute(
        """SELECT a.location_id, a.u_position, m.u_height, m.category, m.nameplate_w, m.net_ports, m.net_speed
           FROM asset a JOIN model m ON m.id = a.model_id"""
    ):
        by_loc.setdefault(row["location_id"], []).append(row)
    halls = {}
    for loc in locs.values():
        if loc["kind"] != "rack":
            continue
        row = locs.get(loc["parent_id"])
        hall = locs.get(row["parent_id"]) if row else None
        if not hall:
            continue
        assets = [item for item in by_loc.get(loc["id"], []) if item["category"] != "Cabinet"]
        spans = [(item["u_position"], item["u_height"] or 0) for item in assets if item["u_position"]]
        blocks = [{"start": start, "length": length} for start, length in free_blocks(spans, 42)]
        used_u = sum(item["u_height"] or 0 for item in assets if item["u_position"])
        used_net = sum(item["net_ports"] or 0 for item in assets)
        installed = _rack_installed(assets)
        code = loc["name"][5:] if loc["name"].startswith("Rack ") else loc["id"].replace("slot-", "")
        rack = {
            "rackId": code,
            "rowId": row["id"],
            "freeU": 42 - used_u,
            "largestFreeU": max([block["length"] for block in blocks], default=0),
            "blocks": blocks,
            "provisionedW": RACK_BUDGET_W,
            "installedW": installed,
            "strandedW": stranded(RACK_BUDGET_W, installed),
            "networkFree": {"25G": max(0, 8 - used_net)},
        }
        bucket = halls.setdefault(hall["id"], {"id": hall["id"], "name": hall["name"], "rows": {}, "racks": []})
        bucket["racks"].append(rack)
        bucket["rows"].setdefault(row["id"], {"id": row["id"], "name": row["name"], "freeU": 0, "installedW": 0, "racks": 0})
        bucket["rows"][row["id"]]["freeU"] += rack["freeU"]
        bucket["rows"][row["id"]]["installedW"] += installed
        bucket["rows"][row["id"]]["racks"] += 1
    out = []
    for hall in halls.values():
        installed = sum(rack["installedW"] for rack in hall["racks"])
        provisioned = RACK_BUDGET_W * len(hall["racks"])
        hall["provisionedW"] = provisioned
        hall["installedW"] = installed
        hall["strandedW"] = stranded(provisioned, installed)
        hall["heatW"] = installed
        hall["cduW"] = HALL_CDU_W
        hall["freeU"] = sum(rack["freeU"] for rack in hall["racks"])
        hall["largestFreeU"] = max([rack["largestFreeU"] for rack in hall["racks"]], default=0)
        hall["networkFree"] = {"25G": sum(rack["networkFree"]["25G"] for rack in hall["racks"])}
        hall["circuits"] = [
            {"id": "A", "provisionedW": provisioned, "installedW": installed, "strandedW": stranded(provisioned, installed)},
            {"id": "B", "provisionedW": provisioned, "installedW": installed, "strandedW": stranded(provisioned, installed)},
        ]
        hall["rows"] = list(hall["rows"].values())
        out.append(hall)
    out.sort(key=lambda item: item["name"])
    return out


def measured_watts(conn):
    latest = {}
    for row in conn.execute("SELECT device_id, value, unit FROM metric WHERE name = 'power' ORDER BY id"):
        latest[row["device_id"]] = row
    total = 0
    found = False
    for row in latest.values():
        unit = (row["unit"] or "").lower()
        if unit == "w":
            total += row["value"]
            found = True
        elif unit == "kw":
            total += row["value"] * 1000
            found = True
    if not found:
        return None
    return int(total)


def capacity_report(conn, inlet_c=24):
    it_w = installed_watts(conn)
    provisioned = conn.execute("SELECT COUNT(*) AS n FROM location WHERE kind = 'rack'").fetchone()["n"] * RACK_BUDGET_W
    facility = int(it_w * 1.05)
    return {
        "provisionedW": provisioned,
        "installedW": it_w,
        "measuredW": measured_watts(conn),
        "strandedW": stranded(provisioned, it_w),
        "pue": pue(facility, it_w),
        "inletC": inlet_c,
        "ashrae": ashrae(inlet_c),
        "cduW": HALL_CDU_W,
        "heatW": it_w,
        "halls": capacity_tree(conn),
    }


def _future_deltas(conn, scenario_id):
    free_u = 0
    heat = 0
    ports = 0
    for row in conn.execute(
        """SELECT c.op, m.u_height, m.nameplate_w, m.net_ports
           FROM scenario_change c LEFT JOIN model m ON m.id = c.model_id WHERE c.scenario_id = ?""",
        (scenario_id,),
    ):
        sign = 1 if row["op"] == "add" else -1 if row["op"] == "remove" else 0
        free_u -= sign * (row["u_height"] or 0)
        heat += sign * (row["nameplate_w"] or 0)
        ports -= sign * (row["net_ports"] or 0)
    cooling = 10 * HALL_CDU_W
    now_w = installed_watts(conn)
    later = max(0, now_w + heat)
    return {
        "freeUDelta": free_u,
        "heatDeltaW": heat,
        "portsDelta": ports,
        "coolingHeadroomNowW": cooling - now_w,
        "coolingHeadroomFutureW": cooling - later,
    }


def scenario_diff(conn, scenario_id):
    now_w = installed_watts(conn)
    later = future_installed(conn, scenario_id)
    scenario = conn.execute("SELECT target_on FROM scenario WHERE id = ?", (scenario_id,)).fetchone()
    changes = [dict(row) for row in conn.execute("SELECT * FROM scenario_change WHERE scenario_id = ?", (scenario_id,))]
    for change in changes:
        change["rackId"] = change.pop("rack_id")
        change["modelId"] = change.pop("model_id")
        change["uPosition"] = change.pop("u_position")
        change["assetId"] = change.pop("asset_id")
    diff = {
        "scenarioId": scenario_id,
        "targetOn": scenario["target_on"] if scenario else "",
        "nowW": now_w,
        "futureW": later,
        "deltaW": later - now_w,
        "pueNow": pue(int(now_w * 1.05), now_w),
        "pueFuture": pue(int(later * 1.05), later) if later else None,
        "redundancy": "A planned device is fed from both A and B. Losing one feeder does not drop it.",
        "changes": changes,
    }
    diff.update(_future_deltas(conn, scenario_id))
    return diff


def create_scenario(conn, body):
    scenario_id = body.get("id") or "scn-" + secrets.token_hex(3)
    conn.execute(
        "INSERT INTO scenario (id, name, target_on, status) VALUES (?, ?, ?, 'draft')",
        (scenario_id, body.get("name") or "Scenario", body.get("targetOn") or ""),
    )
    return scenario_id


def add_change(conn, scenario_id, body):
    conn.execute(
        """INSERT INTO scenario_change (scenario_id, op, model_id, rack_id, u_position, asset_id, detail)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (scenario_id, body.get("op") or "add", body.get("modelId"), body.get("rackId"), body.get("uPosition"), body.get("assetId"), body.get("detail") or ""),
    )


def scenario_rows(conn):
    out = []
    for row in conn.execute("SELECT * FROM scenario ORDER BY rowid"):
        changes = [dict(item) for item in conn.execute("SELECT * FROM scenario_change WHERE scenario_id = ?", (row["id"],))]
        out.append({"id": row["id"], "name": row["name"], "targetOn": row["target_on"], "status": row["status"], "changes": changes})
    return out


def future_installed(conn, scenario_id):
    base = installed_watts(conn)
    for row in conn.execute(
        """SELECT c.op, m.nameplate_w FROM scenario_change c LEFT JOIN model m ON m.id = c.model_id WHERE c.scenario_id = ?""",
        (scenario_id,),
    ):
        watts = row["nameplate_w"] or 0
        if row["op"] == "add":
            base += watts
        elif row["op"] == "remove":
            base -= watts
    return max(0, base)


def create_work_order(conn, body, user, role):
    state = body.get("state") or "Draft"
    if state != "Draft" and role != "Administrator":
        return None, "Only an Administrator can open a work order past Draft."
    if state not in STATES:
        return None, "Unknown work order state."
    work_id = body.get("id") or "WO-" + secrets.token_hex(3)
    existing = conn.execute("SELECT id FROM work_order WHERE id = ?", (work_id,)).fetchone()
    if existing:
        if role != "Administrator":
            return None, "Work order already exists."
        conn.execute("UPDATE work_order SET kind = ?, state = ?, title = ?, reason = ? WHERE id = ?", (body.get("kind") or "Install", state, body.get("title") or work_id, body.get("reason") or "", work_id))
        if body.get("deviceId") and not conn.execute("SELECT id FROM work_task WHERE work_order_id = ? AND asset_id = ?", (work_id, body.get("deviceId"))).fetchone():
            conn.execute(
                "INSERT INTO work_task (work_order_id, asset_id, rack_id, u_position, model_id, expected) VALUES (?, ?, ?, ?, ?, ?)",
                (work_id, body.get("deviceId"), body.get("rackId"), body.get("uPosition"), body.get("modelId"), body.get("expected") or "installed"),
            )
        return work_id, ""
    conn.execute(
        """INSERT INTO work_order (id, kind, state, title, scenario_id, submitted_by, approved_by, reason)
           VALUES (?, ?, ?, ?, ?, ?, '', ?)""",
        (work_id, body.get("kind") or "Install", state, body.get("title") or work_id, body.get("scenarioId"), user, body.get("reason") or ""),
    )
    if body.get("deviceId") or body.get("rackId") or body.get("modelId"):
        conn.execute(
            "INSERT INTO work_task (work_order_id, asset_id, rack_id, u_position, model_id, expected) VALUES (?, ?, ?, ?, ?, ?)",
            (work_id, body.get("deviceId") or body.get("assetId"), body.get("rackId"), body.get("uPosition"), body.get("modelId"), body.get("expected") or "installed"),
        )
    return work_id, ""


def promote(conn, scenario_id, user):
    scenario = conn.execute("SELECT * FROM scenario WHERE id = ?", (scenario_id,)).fetchone()
    if not scenario:
        return None, "Scenario not found."
    changes = conn.execute("SELECT * FROM scenario_change WHERE scenario_id = ?", (scenario_id,)).fetchall()
    if not changes:
        return None, "The scenario has no changes."
    work_id = "WO-" + scenario_id
    if conn.execute("SELECT id FROM work_order WHERE id = ?", (work_id,)).fetchone():
        work_id = "WO-" + scenario_id + "-" + secrets.token_hex(2)
    conn.execute(
        """INSERT INTO work_order (id, kind, state, title, scenario_id, submitted_by, approved_by, reason)
           VALUES (?, 'Install', 'Submitted', ?, ?, ?, '', 'Promoted from scenario')""",
        (work_id, "Install " + scenario["name"], scenario_id, user),
    )
    for change in changes:
        conn.execute(
            "INSERT INTO work_task (work_order_id, asset_id, rack_id, u_position, model_id, expected) VALUES (?, ?, ?, ?, ?, 'installed')",
            (work_id, change["asset_id"], change["rack_id"], change["u_position"], change["model_id"]),
        )
    conn.execute("UPDATE scenario SET status = 'promoted' WHERE id = ?", (scenario_id,))
    return work_id, ""


def advance(conn, work_id, to_state, user, role):
    row = conn.execute("SELECT * FROM work_order WHERE id = ?", (work_id,)).fetchone()
    if not row:
        return None, "Work order not found."
    if to_state not in NEXT.get(row["state"], ()):
        return None, row["state"] + " cannot move to " + to_state + "."
    if to_state in ("Approved", "Rejected", "Verified", "Closed") and role != "Administrator":
        return None, "An Administrator has to " + to_state.lower() + " this work order."
    if to_state == "Verified":
        _apply_verify(conn, row, user, role)
    approved = user if to_state == "Approved" else row["approved_by"]
    conn.execute("UPDATE work_order SET state = ?, approved_by = ? WHERE id = ?", (to_state, approved, work_id))
    deliver(conn, "workorder.changed", {"id": work_id, "state": to_state})
    return to_state, ""


def _apply_verify(conn, work, user, role):
    from server import db
    kind = work["kind"] or "Install"
    for task in conn.execute("SELECT * FROM work_task WHERE work_order_id = ?", (work["id"],)):
        target = task["asset_id"] or ""
        if kind == "Decommission" and target:
            conn.execute("UPDATE asset SET lifecycle = 'Decommissioned' WHERE id = ? OR asset_tag = ?", (target, target))
            db.audit(user, role, "work order verify", target, None, {"lifecycle": "Decommissioned"}, work["id"] + " decommissioned " + target)
            continue
        if kind == "Move" and target and task["rack_id"]:
            conn.execute(
                "UPDATE asset SET location_id = ?, u_position = ? WHERE id = ? OR asset_tag = ?",
                ("slot-" + task["rack_id"], task["u_position"], target, target),
            )
            db.audit(user, role, "work order verify", target, None, {"rackId": task["rack_id"], "uPosition": task["u_position"]}, work["id"] + " moved " + target)
            continue
        if kind in ("Cable change", "Firmware", "Power cycle"):
            db.audit(user, role, "work order verify", target, None, {"expected": task["expected"]}, work["id"] + " " + kind + " " + (task["expected"] or ""))
            continue
        if not task["model_id"] or not task["rack_id"]:
            continue
        slot = "slot-" + task["rack_id"]
        model = conn.execute("SELECT * FROM model WHERE id = ?", (task["model_id"],)).fetchone()
        if not model or not conn.execute("SELECT id FROM location WHERE id = ?", (slot,)).fetchone():
            continue
        asset_id = task["asset_id"] or "asset-" + task["model_id"] + "-" + task["rack_id"]
        if not conn.execute("SELECT id FROM asset WHERE id = ?", (asset_id,)).fetchone():
            conn.execute(
                """INSERT INTO asset (
                    id, asset_tag, serial, model_id, tenant_id, lifecycle, installed_on, warranty_end,
                    location_id, u_position, face, width, custom_json
                ) VALUES (?, ?, ?, ?, 'unubtanium', 'In service', ?, NULL, ?, ?, 'front', 'full', ?)""",
                (asset_id, model["model"], "SN-" + asset_id, task["model_id"], datetime.now(timezone.utc).date().isoformat(), slot, task["u_position"], json.dumps({"rackId": task["rack_id"], "floor": "placed"})),
            )
        node_id = "rack-" + task["rack_id"]
        nameplate = model["nameplate_w"] or 0
        derated = model["derated_w"] if "derated_w" in model.keys() and model["derated_w"] else int(nameplate * 0.8)
        if conn.execute("SELECT id FROM power_node WHERE id = ?", (node_id,)).fetchone():
            conn.execute(
                "UPDATE power_node SET name = ?, nameplate_w = ?, derated_w = ?, asset_id = ? WHERE id = ?",
                (model["model"] + " " + task["rack_id"], nameplate, derated, asset_id, node_id),
            )
        db.audit(user, role, "work order verify", asset_id, None, {"rackId": task["rack_id"], "uPosition": task["u_position"]}, work["id"] + " installed " + model["model"] + " at " + task["rack_id"])


def work_orders(conn):
    out = []
    for row in conn.execute("SELECT * FROM work_order ORDER BY id"):
        tasks = [dict(item) for item in conn.execute("SELECT * FROM work_task WHERE work_order_id = ?", (row["id"],))]
        out.append({
            "id": row["id"], "kind": row["kind"], "state": row["state"], "title": row["title"],
            "scenarioId": row["scenario_id"], "reason": row["reason"], "tasks": tasks,
        })
    return out


def work_covers(conn, work_id, device_id):
    row = conn.execute("SELECT state FROM work_order WHERE id = ?", (work_id,)).fetchone()
    if not row or row["state"] != "In progress":
        return False
    tasks = conn.execute("SELECT asset_id, rack_id FROM work_task WHERE work_order_id = ?", (work_id,)).fetchall()
    if not tasks:
        return True
    return any(task["asset_id"] in (device_id, "", None) for task in tasks)


# DI-1 leak rope on Rack A14 (src/data/outlets.ts LEAK): Outlet 1 feeds tray-01, Outlet 2 feeds tray-02.
LEAK_ID = "di-1"
LEAK_OUTLETS = {1: "tray-01", 2: "tray-02"}
LEAK_LOCATION = "Rack A14 · cold-plate rope · rear of U38–U40"


def leak_asserted(conn):
    """DI-1 is in alarm when its latest reading says so. A reading of 0 clears it."""
    row = conn.execute(
        "SELECT value FROM metric WHERE device_id = ? AND name = 'leak' ORDER BY id DESC LIMIT 1",
        (LEAK_ID,),
    ).fetchone()
    return bool(row and (row["value"] or 0) >= 1)


def leak_interlock(conn, op, device_id, outlet):
    """The same rule the web app applies: while DI-1 is in alarm, its outlets may only be shed."""
    if op in ("off", "lock"):
        return ""
    try:
        outlet = int(outlet or 0)
    except (TypeError, ValueError):
        outlet = 0
    bound = op == "all" or outlet in LEAK_OUTLETS or device_id in LEAK_OUTLETS.values()
    if not bound or not leak_asserted(conn):
        return ""
    if op == "all":
        return "Whole-PDU control is locked by the DI-1 leak interlock. Outlet 1 and Outlet 2 stay off until the leak clears."
    n = outlet if outlet in LEAK_OUTLETS else next(k for k, v in LEAK_OUTLETS.items() if v == device_id)
    return ("Outlet " + str(n) + " is locked by the DI-1 leak interlock. DI-1 is asserted at " + LEAK_LOCATION +
            ". " + LEAK_OUTLETS[n] + " stays off until the leak clears. Shedding it (off) is still allowed.")


def allow_action(conn, user, kind, reason, work_id, device_id, maintenance):
    if not reason or len(reason.strip()) < 3:
        return "A reason is required."
    if _limited(user, kind):
        return "Too many " + kind + " actions. Wait a minute."
    if maintenance:
        return ""
    if not work_covers(conn, work_id, device_id):
        return "Maintenance is closed. An In progress work order has to cover this device."
    return ""


def _limited(user, kind, limit=60):
    now = datetime.now(timezone.utc)
    key = (user, kind)
    recent = [stamp for stamp in RATE.get(key, []) if now - stamp < timedelta(minutes=1)]
    if len(recent) >= limit:
        RATE[key] = recent
        return True
    recent.append(now)
    RATE[key] = recent
    return False


def _covered(conn, device_id):
    if not device_id:
        return False
    row = conn.execute(
        """SELECT wo.id FROM work_order wo JOIN work_task task ON task.work_order_id = wo.id
           WHERE wo.state IN ('Approved', 'Scheduled', 'In progress') AND task.asset_id = ?""",
        (device_id,),
    ).fetchone()
    return bool(row)


def _clear_metric(conn, device_id, name):
    rows = conn.execute(
        "SELECT id FROM alarm WHERE device_id = ? AND metric = ? AND state = 'open'",
        (device_id, name),
    ).fetchall()
    at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    for row in rows:
        conn.execute("UPDATE alarm SET state = 'cleared', cleared_at = ? WHERE id = ?", (at, row["id"]))
        deliver(conn, "alarm.cleared", {"id": row["id"], "deviceId": device_id, "metric": name})
    return len(rows)


def ingest_metric(conn, device_id, name, value, unit):
    conn.execute(
        "INSERT INTO metric (at, device_id, name, value, unit) VALUES (?, ?, ?, ?, ?)",
        (datetime.now(timezone.utc).replace(microsecond=0).isoformat(), device_id, name, float(value), unit),
    )
    alarm = None
    if name == "inlet":
        if value <= 27:
            _clear_metric(conn, device_id, name)
            return None
        priority = 1 if value > 32 else 2
        alarm = (priority, "Inlet " + str(value) + " C is above the ASHRAE recommended band.", "Open the rack inlet")
    elif name == "power":
        if value <= 90:
            _clear_metric(conn, device_id, name)
            return None
        alarm = (1 if value > 100 else 2, "Power load " + str(value) + "% is over the threshold.", "Open ACS serial if the BMC is dark")
    if not alarm:
        return None
    existing = conn.execute(
        "SELECT id, priority FROM alarm WHERE device_id = ? AND metric = ? AND state = 'open'",
        (device_id, name),
    ).fetchone()
    if existing:
        if alarm[0] < (existing["priority"] or 3):
            conn.execute("UPDATE alarm SET priority = ?, text = ? WHERE id = ?", (alarm[0], alarm[1], existing["id"]))
            deliver(conn, "alarm.raised", {"id": existing["id"], "text": alarm[1], "priority": alarm[0], "escalated": True})
        return existing["id"]
    state = "suppressed" if _covered(conn, device_id) else "open"
    return raise_alarm(conn, alarm[0], device_id, alarm[1], alarm[2], name, state)


def raise_alarm(conn, priority, device_id, text, action, metric="", state="open"):
    alarm_id = "alm-" + secrets.token_hex(4)
    conn.execute(
        """INSERT INTO alarm (id, at, priority, device_id, text, state, action, ack_user, ack_note, metric)
           VALUES (?, ?, ?, ?, ?, ?, ?, '', '', ?)""",
        (alarm_id, datetime.now(timezone.utc).replace(microsecond=0).isoformat(), priority, device_id, text, state, action, metric or None),
    )
    if state == "open":
        deliver(conn, "alarm.raised", {"id": alarm_id, "text": text, "priority": priority})
    return alarm_id


def collect_metrics(conn, source, samples):
    known = ("lab", "redfish", "snmp", "acs", "modbus", "bacnet")
    if source not in known:
        return None, "Unknown collector. Use lab, redfish, snmp, acs, modbus, or bacnet."
    rows = samples or []
    if source == "lab" and not rows:
        rows = [{"deviceId": "tray-01", "name": "inlet", "value": 24, "unit": "C"}]
    created = []
    for sample in rows:
        created.append(ingest_metric(conn, sample.get("deviceId") or source, sample.get("name") or "value", sample.get("value") or 0, sample.get("unit") or ""))
    return {"source": source, "alarms": [item for item in created if item]}, ""


def note_failure(conn, node_id, report):
    if not node_id or not report:
        return None
    critical = [item for item in report.get("over") or [] if item.get("level") == "critical"]
    lost = report.get("lost") or []
    if not critical and not lost:
        return raise_alarm(
            conn, 2, node_id,
            node_id + " failed. The other side still carries the load. No node is over 80%.",
            "Keep the surviving feed. Restore this feeder before the next maintenance window.",
        )
    text = node_id + " failed. " + str(len(lost)) + " loads lost. " + str(len(critical)) + " nodes over 100%."
    return raise_alarm(conn, 1 if lost else 2, node_id, text, "Open the power path. Keep the surviving feed, and use ACS serial if a BMC goes dark.")


def ack_alarm(conn, alarm_id, user, note):
    at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    conn.execute("UPDATE alarm SET state = 'acked', ack_user = ?, ack_note = ?, ack_at = ? WHERE id = ?", (user, note or "", at, alarm_id))


def alarms(conn):
    return [dict(row) for row in conn.execute("SELECT * FROM alarm ORDER BY at DESC")]


def metrics_for(conn, device_id):
    return [dict(row) for row in conn.execute("SELECT * FROM metric WHERE device_id = ? ORDER BY id", (device_id,))]


def discover(conn, found, complete=False):
    known = {row["asset_tag"]: row for row in conn.execute("SELECT asset_tag, serial, location_id FROM asset")}
    created = []
    seen = set()

    def add(source, kind, tag, detail):
        item_id = "disc-" + secrets.token_hex(3)
        conn.execute(
            "INSERT INTO discovery_item (id, at, source, kind, device_id, detail, state) VALUES (?, ?, ?, ?, ?, ?, 'pending')",
            (item_id, datetime.now(timezone.utc).replace(microsecond=0).isoformat(), source, kind, tag, detail),
        )
        created.append(item_id)

    for item in found or []:
        serial = item.get("serial") or ""
        tag = item.get("assetTag") or ""
        source = item.get("source") or "redfish"
        seen.add(tag)
        current = known.get(tag)
        if item.get("kind") == "missing" and current:
            add(source, "missing", tag, item.get("detail") or "Not seen on this sweep.")
            continue
        if not current:
            add(source, "new", tag, item.get("detail") or "Discovered and not in the repository.")
            continue
        if serial and current["serial"] != serial:
            add(source, "serial", tag, "Serial " + serial + " does not match " + (current["serial"] or ""))
            continue
        rack_id = item.get("rackId") or ""
        if rack_id and current["location_id"] != "slot-" + rack_id:
            add(source, "moved", tag, "Seen in " + rack_id + ", recorded at " + (current["location_id"] or ""))
    if complete:
        for tag in known:
            if tag not in seen:
                add("sweep", "missing", tag, "Not seen in the sweep.")
    return created


def reconcile(conn, item_id, accept, user, role):
    from server import db
    row = conn.execute("SELECT * FROM discovery_item WHERE id = ?", (item_id,)).fetchone()
    if not row:
        return None
    state = "accepted" if accept else "rejected"
    conn.execute("UPDATE discovery_item SET state = ? WHERE id = ?", (state, item_id))
    db.audit(user, role, "discovery " + state, row["device_id"], None, {"id": item_id}, row["detail"])
    return state


def audit_scan(conn, tag, rack_id, u_position):
    asset = conn.execute("SELECT * FROM asset WHERE asset_tag = ?", (tag,)).fetchone()
    if not asset:
        return {"ok": False, "issue": "unknown asset"}
    slot = "slot-" + rack_id
    if asset["location_id"] != slot or asset["u_position"] != u_position:
        return {"ok": False, "issue": "location differs", "recordedRack": asset["location_id"], "recordedU": asset["u_position"]}
    return {"ok": True}


def login(conn, user_id, password):
    row = conn.execute("SELECT * FROM app_user WHERE id = ?", (user_id,)).fetchone()
    if not row or not check_password(password or "", row["password_hash"]):
        return None
    token = secrets.token_urlsafe(24)
    expires = (datetime.now(timezone.utc) + timedelta(hours=8)).replace(microsecond=0).isoformat()
    conn.execute(
        "INSERT INTO session (token, user_id, role, tenant_id, expires_at) VALUES (?, ?, ?, ?, ?)",
        (token, row["id"], row["role"], row["tenant_id"], expires),
    )
    return {"token": token, "user": row["id"], "role": row["role"], "tenantId": row["tenant_id"], "expiresAt": expires}


def session_user(conn, token):
    if not token:
        return None
    row = conn.execute("SELECT * FROM session WHERE token = ?", (token,)).fetchone()
    if not row:
        hashed = hashlib.sha256(token.encode("utf-8")).hexdigest()
        token_row = conn.execute("SELECT * FROM api_token WHERE token_hash = ?", (hashed,)).fetchone()
        if not token_row:
            return None
        return {"user": token_row["user_id"], "role": token_row["role"], "tenantId": token_row["tenant_id"]}
    if row["expires_at"] < datetime.now(timezone.utc).replace(microsecond=0).isoformat():
        return None
    return {"user": row["user_id"], "role": row["role"], "tenantId": row["tenant_id"]}


def create_token(conn, user, role, tenant):
    raw = secrets.token_urlsafe(24)
    conn.execute(
        "INSERT INTO api_token (token_hash, user_id, role, tenant_id) VALUES (?, ?, ?, ?)",
        (hashlib.sha256(raw.encode("utf-8")).hexdigest(), user, role, tenant),
    )
    return raw


def add_webhook(conn, event, url):
    hook_id = "hook-" + secrets.token_hex(3)
    conn.execute("INSERT INTO webhook (id, event, url) VALUES (?, ?, ?)", (hook_id, event, url))
    return hook_id


def deliver(conn, event, payload):
    body = json.dumps(payload)
    at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    hooks = conn.execute("SELECT id FROM webhook WHERE event = ? OR event = '*'", (event,)).fetchall()
    if not hooks:
        conn.execute("INSERT INTO webhook_delivery (webhook_id, event, payload, at) VALUES (NULL, ?, ?, ?)", (event, body, at))
        return
    for hook in hooks:
        conn.execute(
            "INSERT INTO webhook_delivery (webhook_id, event, payload, at) VALUES (?, ?, ?, ?)",
            (hook["id"], event, body, at),
        )


def verify_audit(conn):
    rows = conn.execute("SELECT id, at, user_id, role, action, asset_id, detail, prev_hash, row_hash, source_ip FROM audit_event WHERE row_hash IS NOT NULL ORDER BY id").fetchall()
    previous = ""
    for row in rows:
        parts = [row["prev_hash"] or "", row["at"], row["user_id"] or "", row["role"] or "", row["action"] or "", row["asset_id"] or "", row["detail"] or ""]
        if row["source_ip"]:
            parts.append(row["source_ip"])
        digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
        if (row["prev_hash"] or "") != previous or digest != row["row_hash"]:
            return {"ok": False, "brokenAt": row["id"]}
        previous = row["row_hash"]
    return {"ok": True, "rows": len(rows)}


def _seconds(start, end):
    try:
        left = datetime.fromisoformat(start)
        right = datetime.fromisoformat(end)
    except ValueError:
        return 0
    return max(0, int((right - left).total_seconds()))


def _avg(values):
    if not values:
        return None
    return int(sum(values) / len(values))


def report_table(conn, kind):
    if kind == "inventory":
        rows = []
        today = datetime.now(timezone.utc).date()
        locs = {row["id"]: row for row in conn.execute("SELECT id, kind, name, parent_id FROM location")}

        def hall_of(location_id):
            seen = set()
            current = location_id
            while current and current not in seen:
                seen.add(current)
                loc = locs.get(current)
                if not loc:
                    return ""
                if loc["kind"] == "hall":
                    return loc["name"]
                current = loc["parent_id"]
            return ""

        for asset in conn.execute(
            """SELECT a.asset_tag, a.lifecycle, a.warranty_end, a.location_id, m.manufacturer, m.model, l.name AS location
               FROM asset a JOIN model m ON m.id = a.model_id LEFT JOIN location l ON l.id = a.location_id"""
        ):
            soon = False
            if asset["warranty_end"]:
                try:
                    soon = (datetime.fromisoformat(asset["warranty_end"]).date() - today).days <= 90
                except ValueError:
                    soon = False
            hall = hall_of(asset["location_id"])
            if not hall and asset["location_id"] == "inventory":
                hall = "Inventory"
            elif not hall and asset["location_id"] == "yard":
                hall = "Outside"
            rows.append({"tag": asset["asset_tag"], "vendor": asset["manufacturer"], "model": asset["manufacturer"] + " " + asset["model"], "lifecycle": asset["lifecycle"], "location": asset["location"], "hall": hall, "warrantySoon": soon})
        return {"kind": kind, "rows": rows}
    if kind == "capacity":
        halls = capacity_tree(conn)
        return {"kind": kind, "chart": "installedW", "rows": [{"hall": hall["name"], "installedW": hall["installedW"], "strandedW": hall["strandedW"], "freeU": hall["freeU"], "network25G": hall["networkFree"]["25G"]} for hall in halls]}
    if kind == "sla":
        rows = alarms(conn)
        grouped = {"all": rows}
        for row in rows:
            grouped.setdefault("P" + str(row.get("priority") or ""), []).append(row)
        summary = []
        for priority, group in grouped.items():
            mtta = [_seconds(item["at"], item["ack_at"]) for item in group if item.get("ack_at") and item.get("at")]
            mttr = [_seconds(item["at"], item["cleared_at"]) for item in group if item.get("cleared_at") and item.get("at")]
            summary.append({"priority": priority, "mttaSec": _avg(mtta), "mttrSec": _avg(mttr), "open": sum(1 for item in group if item["state"] == "open")})
        summary.sort(key=lambda item: item["priority"] != "all")
        return {"kind": kind, "rows": summary}
    if kind == "energy":
        cap = capacity_report(conn)
        facility = int(cap["installedW"] * 1.05)
        periods = [{"period": period, "itW": cap["installedW"], "facilityW": facility, "pue": cap["pue"], "basis": "IT plus 5% auxiliaries"} for period in ("hour", "day", "month")]
        return {"kind": kind, "chart": "facilityW", "rows": periods}
    if kind == "alarms":
        return {"kind": kind, "rows": alarms(conn)}
    if kind == "audit":
        from server import db
        return {"kind": kind, "rows": db.audit_log(100)}
    return None


def report_csv(table):
    rows = table.get("rows") or []
    if not rows:
        return "kind\n" + table["kind"] + "\n"
    fields = list(rows[0].keys())
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fields)
    writer.writeheader()
    for row in rows:
        writer.writerow({key: row.get(key) for key in fields})
    return buf.getvalue()


def report_pdf(table):
    lines = [table["kind"]]
    for row in (table.get("rows") or [])[:40]:
        lines.append(", ".join(str(key) + "=" + str(value) for key, value in row.items())[:110])
    stream = "BT /F1 11 Tf 40 740 Td (" + table["kind"] + ") Tj ET\n"
    y = 710
    for line in lines[1:]:
        safe = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        stream += "BT /F1 9 Tf 40 " + str(y) + " Td (" + safe + ") Tj ET\n"
        y -= 14
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        "<< /Length " + str(len(stream)) + " >>\nstream\n" + stream + "\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = "%PDF-1.4\n"
    offsets = []
    for index, body in enumerate(objects):
        offsets.append(len(out))
        out += str(index + 1) + " 0 obj\n" + body + "\nendobj\n"
    xref = len(out)
    out += "xref\n0 " + str(len(objects) + 1) + "\n0000000000 65535 f \n"
    for offset in offsets:
        out += str(offset).zfill(10) + " 00000 n \n"
    out += "trailer << /Size " + str(len(objects) + 1) + " /Root 1 0 R >>\nstartxref\n" + str(xref) + "\n%%EOF"
    return out


def openapi():
    def path(summary):
        return {"get": {"summary": summary, "responses": {"200": {"description": summary}}}}
    return {
        "openapi": "3.0.3",
        "info": {"title": "Unubtanium 2.0 DCIM", "version": "1.0.0"},
        "paths": {
            "/api/v1/assets": path("Assets"),
            "/api/v1/models": path("Models"),
            "/api/v1/locations": path("Locations"),
            "/api/v1/power/fail": {"post": {"summary": "Single-node power failure", "responses": {"200": {"description": "Lost loads and overloaded nodes"}}}},
            "/api/v1/capacity": path("Capacity"),
            "/api/v1/capacity/home": {"post": {"summary": "Find a home", "responses": {"200": {"description": "Ranked racks"}}}},
            "/api/v1/connections": path("Cables"),
            "/api/v1/work-orders": path("Work orders"),
            "/api/v1/alarms": path("Alarms"),
            "/api/v1/reports/{kind}": path("Reports"),
            "/api/v1/capacity/hall/{id}": path("Hall capacity"),
            "/api/v1/scenarios/{id}/diff": path("Now versus future"),
            "/api/v1/collect": {"post": {"summary": "Normalize collector samples", "responses": {"201": {"description": "Metrics stored"}}}},
            "/api/v1/integrations/vcenter": {"post": {"summary": "vCenter stub", "responses": {"200": {"description": "VM to rack"}}}},
            "/api/v1/integrations/bacnet": {"post": {"summary": "BACnet stub", "responses": {"200": {"description": "Point reading"}}}},
            "/api/v1/discovery/run": {"post": {"summary": "Compare a sweep with the repository", "responses": {"200": {"description": "New, moved, missing, or serial differences"}}}},
            "/api/v1/session": {"post": {"summary": "Local sign-in", "responses": {"200": {"description": "Bearer token"}}}},
            "/api/v1/webhooks": {"post": {"summary": "Register a local webhook", "responses": {"201": {"description": "Stored, not called"}}}},
        },
        "components": {
            "schemas": {
                "Asset": {"type": "object", "properties": {"id": {"type": "string"}, "assetTag": {"type": "string"}, "lifecycle": {"type": "string"}, "locationId": {"type": "string"}}},
                "Alarm": {"type": "object", "properties": {"id": {"type": "string"}, "priority": {"type": "integer"}, "state": {"type": "string"}, "deviceId": {"type": "string"}, "text": {"type": "string"}}},
                "CapacityReport": {"type": "object", "properties": {"installedW": {"type": "integer"}, "provisionedW": {"type": "integer"}, "strandedW": {"type": "integer"}, "pue": {"type": "number"}, "halls": {"type": "array"}}},
                "Connection": {"type": "object", "properties": {"aPort": {"type": "string"}, "bPort": {"type": "string"}, "cableType": {"type": "string"}, "lengthM": {"type": "number"}, "label": {"type": "string"}}},
                "MetricSample": {"type": "object", "required": ["deviceId", "name", "value"], "properties": {"deviceId": {"type": "string"}, "name": {"type": "string"}, "value": {"type": "number"}, "unit": {"type": "string"}}},
                "WorkOrder": {"type": "object", "properties": {"id": {"type": "string"}, "kind": {"type": "string"}, "state": {"type": "string"}, "tasks": {"type": "array"}}},
            }
        },
    }


def scope_world(payload, tenant):
    if tenant != "colo":
        return payload
    locs = payload["locations"]
    wanted = {"hall-10"}
    changed = True
    while changed:
        changed = False
        for item in locs:
            if item.get("parentId") in wanted and item["id"] not in wanted:
                wanted.add(item["id"])
                changed = True
    keep = [item for item in locs if item["id"] in wanted or item.get("kind") in ("site", "building", "yard")]
    keep_ids = {item["id"] for item in keep}
    scoped = dict(payload)
    scoped["locations"] = keep
    scoped["assets"] = [item for item in payload["assets"] if item.get("locationId") in keep_ids]
    scoped["plant"] = dict(payload.get("plant") or {})
    scoped["plant"]["halls"] = 1
    return scoped


def handle(method, path, headers, body, user, role):
    from server import db
    conn = db.db()
    admin = role == "Administrator"

    def deny_writer():
        if role == "ReadOnly":
            return 403, {"error": "Read only cannot change assets."}
        if role != "Administrator":
            return 403, {"error": "Operator cannot edit assets."}
        return None

    if method == "POST" and path == "/api/v1/session":
        found = login(conn, (body or {}).get("user") or "", (body or {}).get("password") or "")
        if not found:
            return 401, {"error": "Sign-in was refused."}
        conn.commit()
        return 200, found
    if method == "GET" and path == "/api/v1/auth/oidc":
        return 200, {"enabled": False, "issuer": "", "note": "Set DCIAC_OIDC_ISSUER to enable SAML or OIDC."}
    if method == "GET" and path.startswith("/api/v1/racks/") and path.endswith("/ports"):
        rack_id = path[len("/api/v1/racks/"):-len("/ports")].strip("/")
        if not conn.execute("SELECT id FROM location WHERE id = ?", ("slot-" + rack_id,)).fetchone():
            return 404, {"error": "Rack not found."}
        return 200, rack_ports(conn, rack_id)
    if method == "GET" and path == "/api/v1/ports":
        rows = ports(conn)
        return 200, {"ports": rows, "issues": port_issues(rows, connections(conn))}
    if method == "GET" and path.startswith("/api/v1/ports/") and path.endswith("/trace"):
        port_id = path[len("/api/v1/ports/"):-len("/trace")].strip("/")
        return 200, {"trace": trace(ports(conn), connections(conn), port_id)}
    if method == "GET" and path == "/api/v1/connections":
        rows = connections(conn)
        if (headers.get("accept") or "") == "text/csv":
            return 200, {"csv": connections_csv(rows)}
        return 200, {"connections": rows, "issues": port_issues(ports(conn), rows)}
    if method == "POST" and path == "/api/v1/connections":
        if role not in ("Administrator", "Operator"):
            return 403, {"error": "Read only cannot change assets."}
        saved, err = track_cable(conn, body or {})
        if err:
            return 400, {"error": err}
        db.audit(user, role, "cable track", saved["id"], None, body, saved["label"])
        conn.commit()
        return 201, saved
    if method == "POST" and path.startswith("/api/v1/connections/") and path.endswith("/drop"):
        if role not in ("Administrator", "Operator"):
            return 403, {"error": "Read only cannot change assets."}
        cable_id = path[len("/api/v1/connections/"):-len("/drop")].strip("/")
        dropped = drop_cable(conn, cable_id)
        if not dropped:
            return 404, {"error": "Cable not found."}
        db.audit(user, role, "cable drop", cable_id, None, None, "Dropped " + cable_id)
        conn.commit()
        return 200, dropped
    if method == "POST" and path.startswith("/api/v1/ports/") and path.endswith("/status"):
        if role not in ("Administrator", "Operator"):
            return 403, {"error": "Read only cannot change assets."}
        port_id = path[len("/api/v1/ports/"):-len("/status")].strip("/")
        saved, err = set_port_status(conn, port_id, (body or {}).get("status") or "")
        if err:
            return 400, {"error": err}
        conn.commit()
        return 200, saved
    if method == "POST" and path == "/api/v1/connections/import":
        if role not in ("Administrator", "Operator"):
            return 403, {"error": "Read only cannot change assets."}
        saved = import_connections(conn, (body or {}).get("csv") or "")
        db.audit(user, role, "cable import", None, None, {"ids": saved}, "Imported " + str(len(saved)) + " cables")
        conn.commit()
        return 200, {"imported": saved}
    if method == "GET" and path == "/api/v1/capacity":
        return 200, capacity_report(conn, float((body or {}).get("inletC") or 24))
    if method == "GET" and path.startswith("/api/v1/capacity/hall/"):
        hall_id = path[len("/api/v1/capacity/hall/"):]
        found = next((hall for hall in capacity_tree(conn) if hall["id"] == hall_id), None)
        if not found:
            return 404, {"error": "Hall not found."}
        return 200, found
    if method == "GET" and path.startswith("/api/v1/capacity/rack/"):
        rack_id = path[len("/api/v1/capacity/rack/"):]
        for hall in capacity_tree(conn):
            rack = next((item for item in hall["racks"] if item["rackId"] == rack_id), None)
            if rack:
                return 200, rack
        return 404, {"error": "Rack not found."}
    if method == "POST" and path == "/api/v1/capacity/home":
        found = find_home(conn, (body or {}).get("modelId") or "", int((body or {}).get("quantity") or 1), (body or {}).get("hallId") or "")
        if not found:
            return 404, {"error": "Model not found."}
        return 200, found
    if method == "GET" and path == "/api/v1/scenarios":
        return 200, {"scenarios": scenario_rows(conn)}
    if method == "POST" and path == "/api/v1/scenarios":
        if role not in ("Administrator", "Operator"):
            return 403, {"error": "Read only cannot change assets."}
        scenario_id = create_scenario(conn, body or {})
        if body and body.get("change"):
            add_change(conn, scenario_id, body["change"])
        db.audit(user, role, "scenario create", scenario_id, None, body, "Scenario " + scenario_id)
        conn.commit()
        return 201, {"id": scenario_id, "scenarios": scenario_rows(conn)}
    if method == "GET" and path.startswith("/api/v1/scenarios/") and path.endswith("/diff"):
        scenario_id = path[len("/api/v1/scenarios/"):-len("/diff")].strip("/")
        if not conn.execute("SELECT id FROM scenario WHERE id = ?", (scenario_id,)).fetchone():
            return 404, {"error": "Scenario not found."}
        return 200, scenario_diff(conn, scenario_id)
    if method == "POST" and path.startswith("/api/v1/scenarios/") and path.endswith("/changes"):
        if role not in ("Administrator", "Operator"):
            return 403, {"error": "Read only cannot change assets."}
        scenario_id = path[len("/api/v1/scenarios/"):-len("/changes")].strip("/")
        if not conn.execute("SELECT id FROM scenario WHERE id = ?", (scenario_id,)).fetchone():
            return 404, {"error": "Scenario not found."}
        if (body or {}).get("targetOn"):
            conn.execute("UPDATE scenario SET target_on = ? WHERE id = ?", ((body or {}).get("targetOn"), scenario_id))
        if (body or {}).get("op") or (body or {}).get("modelId"):
            add_change(conn, scenario_id, body or {})
        conn.commit()
        return 201, scenario_diff(conn, scenario_id)
    if method == "POST" and path.startswith("/api/v1/scenarios/") and path.endswith("/promote"):
        if role not in ("Administrator", "Operator"):
            return 403, {"error": "Read only cannot change assets."}
        scenario_id = path[len("/api/v1/scenarios/"):-len("/promote")].strip("/")
        work_id, err = promote(conn, scenario_id, user)
        if err:
            return 400, {"error": err}
        db.audit(user, role, "scenario promote", work_id, None, {"scenarioId": scenario_id}, "Promoted " + scenario_id)
        conn.commit()
        return 201, {"workOrderId": work_id}
    if method == "GET" and path == "/api/v1/work-orders":
        return 200, {"workOrders": work_orders(conn)}
    if method == "POST" and path == "/api/v1/work-orders":
        if role not in ("Administrator", "Operator"):
            return 403, {"error": "Read only cannot change assets."}
        work_id, err = create_work_order(conn, body or {}, user, role)
        if err:
            return 403, {"error": err}
        db.audit(user, role, "work order create", work_id, None, body, work_id)
        conn.commit()
        return 201, {"id": work_id}
    if method == "POST" and path.startswith("/api/v1/work-orders/") and path.endswith("/advance"):
        work_id = path[len("/api/v1/work-orders/"):-len("/advance")].strip("/")
        state, err = advance(conn, work_id, (body or {}).get("to") or "", user, role)
        if err:
            code = 403 if "Administrator" in err else 400
            return code, {"error": err}
        db.audit(user, role, "work order " + state.lower(), work_id, None, {"state": state}, work_id + " " + state)
        conn.commit()
        return 200, {"id": work_id, "state": state}
    if method == "POST" and path == "/api/v1/actions/outlet":
        if role == "ReadOnly":
            return 403, {"error": "Read only cannot change assets."}
        interlock = leak_interlock(conn, (body or {}).get("op") or "cycle", (body or {}).get("deviceId") or "", (body or {}).get("outlet"))
        if interlock:
            return 409, {"error": interlock, "interlock": "DI-1"}
        reason = allow_action(conn, user, "outlet", (body or {}).get("reason") or "", (body or {}).get("workOrderId") or "", (body or {}).get("deviceId") or "", bool((body or {}).get("maintenance")))
        if reason:
            return 403, {"error": reason}
        db.audit(user, role, "outlet " + ((body or {}).get("op") or "cycle"), (body or {}).get("deviceId"), None, body, (body or {}).get("reason") or "")
        conn.commit()
        return 200, {"ok": True}
    if method == "POST" and path == "/api/v1/actions/console":
        reason = allow_action(conn, user, "console", (body or {}).get("reason") or "failover", (body or {}).get("workOrderId") or "", (body or {}).get("deviceId") or "", bool((body or {}).get("failover") or (body or {}).get("maintenance")))
        if reason:
            return 403, {"error": reason}
        return 200, {"ok": True}
    if method == "POST" and path == "/api/v1/metrics":
        alarm_id = ingest_metric(conn, (body or {}).get("deviceId") or "", (body or {}).get("name") or "", (body or {}).get("value") or 0, (body or {}).get("unit") or "")
        conn.commit()
        return 201, {"alarmId": alarm_id}
    if method == "POST" and path == "/api/v1/collect":
        saved, err = collect_metrics(conn, (body or {}).get("source") or "", (body or {}).get("samples") or [])
        if err:
            return 400, {"error": err}
        conn.commit()
        return 201, saved
    if method == "GET" and path == "/api/v1/alarms":
        return 200, {"alarms": alarms(conn)}
    if method == "POST" and path.startswith("/api/v1/alarms/") and path.endswith("/ack"):
        alarm_id = path[len("/api/v1/alarms/"):-len("/ack")].strip("/")
        ack_alarm(conn, alarm_id, user, (body or {}).get("note") or "")
        conn.commit()
        return 200, {"id": alarm_id, "state": "acked"}
    if method == "GET" and path.startswith("/api/v1/metrics/"):
        return 200, {"metrics": metrics_for(conn, path[len("/api/v1/metrics/"):])}
    if method == "POST" and path == "/api/v1/discovery/run":
        created = discover(conn, (body or {}).get("found") or [], bool((body or {}).get("complete")))
        conn.commit()
        return 200, {"created": created, "items": [dict(row) for row in conn.execute("SELECT * FROM discovery_item ORDER BY at DESC")]}
    if method == "POST" and path.startswith("/api/v1/discovery/") and path.endswith("/decide"):
        if not admin:
            return 403, {"error": "Operator cannot edit assets."}
        item_id = path[len("/api/v1/discovery/"):-len("/decide")].strip("/")
        state = reconcile(conn, item_id, bool((body or {}).get("accept")), user, role)
        if not state:
            return 404, {"error": "Discovery item not found."}
        conn.commit()
        return 200, {"id": item_id, "state": state}
    if method == "POST" and path == "/api/v1/discovery/audit":
        return 200, audit_scan(conn, (body or {}).get("assetTag") or "", (body or {}).get("rackId") or "", (body or {}).get("uPosition"))
    if method == "GET" and path == "/api/v1/reports/schedules":
        rows = [dict(row) for row in conn.execute("SELECT id, kind, cadence FROM report_schedule ORDER BY id")]
        return 200, {"schedules": rows}
    if method == "GET" and path.startswith("/api/v1/reports/"):
        kind = path[len("/api/v1/reports/"):]
        fmt = ""
        if kind.endswith(".csv"):
            kind, fmt = kind[:-4], "csv"
        elif kind.endswith(".pdf"):
            kind, fmt = kind[:-4], "pdf"
        table = report_table(conn, kind)
        if not table:
            return 404, {"error": "Unknown report."}
        if fmt == "csv":
            return 200, {"csv": report_csv(table)}
        if fmt == "pdf":
            return 200, {"pdf": report_pdf(table)}
        return 200, table
    if method == "POST" and path == "/api/v1/reports/schedules":
        if not admin:
            return 403, {"error": "Operator cannot edit assets."}
        schedule_id = (body or {}).get("id") or "sched-" + secrets.token_hex(2)
        conn.execute("INSERT OR REPLACE INTO report_schedule (id, kind, cadence) VALUES (?, ?, ?)", (schedule_id, (body or {}).get("kind") or "inventory", (body or {}).get("cadence") or "daily"))
        conn.commit()
        return 201, {"id": schedule_id}
    if method == "GET" and path == "/api/v1/openapi.json":
        return 200, openapi()
    if method == "POST" and path == "/api/v1/tokens":
        if not admin:
            return 403, {"error": "Operator cannot edit assets."}
        ranks = {"ReadOnly": 1, "Operator": 2, "Administrator": 3}
        asked = (body or {}).get("role") or role
        if ranks.get(asked, 0) > ranks.get(role, 0):
            return 403, {"error": "A token cannot outrank the person who issues it."}
        raw = create_token(conn, user, asked, (body or {}).get("tenantId") or "unubtanium")
        conn.commit()
        return 201, {"token": raw}
    if method == "POST" and path == "/api/v1/webhooks":
        if not admin:
            return 403, {"error": "Operator cannot edit assets."}
        hook_id = add_webhook(conn, (body or {}).get("event") or "alarm.raised", (body or {}).get("url") or "")
        conn.commit()
        return 201, {"id": hook_id}
    if method == "GET" and path == "/api/v1/webhooks/deliveries":
        return 200, {"deliveries": [dict(row) for row in conn.execute("SELECT * FROM webhook_delivery ORDER BY id DESC LIMIT 20")]}
    if method == "GET" and path == "/api/v1/audit/verify":
        return 200, verify_audit(conn)
    if method == "POST" and path == "/api/v1/integrations/servicenow":
        work_id = (body or {}).get("workOrderId") or ""
        return 200, {"number": "CHG" + work_id.replace("-", "")[-6:].upper(), "state": "New", "stub": True}
    if method == "POST" and path == "/api/v1/integrations/vcenter":
        return 200, {"stub": True, "vms": [{"name": (body or {}).get("vm") or "vm-01", "host": "tray-01", "rackId": "A14"}]}
    if method == "POST" and path == "/api/v1/integrations/bacnet":
        return 200, {"stub": True, "points": [{"name": "CDU supply", "value": 20.5, "unit": "C"}]}
    return None
