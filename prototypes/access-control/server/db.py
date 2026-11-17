"""SQLite asset repository for Unubtanium 2.0.

The Lab simulation does not write here. Telemetry stays in the browser.
"""

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PATH = os.path.join(ROOT, "data", "unubtanium.sqlite")

LIFECYCLES = (
    "Planned",
    "Received",
    "Installed",
    "In service",
    "Decommissioned",
    "Disposed",
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS tenant (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model (
  id TEXT PRIMARY KEY,
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  category TEXT NOT NULL,
  u_height INTEGER,
  nameplate_w INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS location (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES location(id),
  custom_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS asset (
  id TEXT PRIMARY KEY,
  asset_tag TEXT NOT NULL,
  serial TEXT NOT NULL,
  model_id TEXT NOT NULL REFERENCES model(id),
  tenant_id TEXT NOT NULL REFERENCES tenant(id),
  lifecycle TEXT NOT NULL,
  installed_on TEXT,
  warranty_end TEXT,
  location_id TEXT NOT NULL REFERENCES location(id),
  u_position INTEGER,
  face TEXT,
  width TEXT,
  custom_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS audit_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  action TEXT NOT NULL,
  asset_id TEXT,
  before_json TEXT,
  after_json TEXT,
  detail TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS power_node (
  id TEXT PRIMARY KEY,
  asset_id TEXT,
  device_id TEXT,
  rack_id TEXT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  side TEXT NOT NULL,
  role TEXT NOT NULL,
  capacity_w INTEGER NOT NULL,
  nameplate_w INTEGER NOT NULL DEFAULT 0,
  derated_w INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS power_edge (
  id TEXT PRIMARY KEY,
  upstream_id TEXT NOT NULL,
  downstream_id TEXT NOT NULL,
  capacity_w INTEGER NOT NULL,
  capacity_a REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS port (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  speed TEXT,
  media TEXT,
  status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS patch_panel (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location_id TEXT,
  port_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS connection (
  id TEXT PRIMARY KEY,
  a_port TEXT NOT NULL,
  b_port TEXT NOT NULL,
  cable_type TEXT,
  length_m REAL,
  label TEXT,
  color TEXT
);
CREATE TABLE IF NOT EXISTS scenario (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_on TEXT,
  status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scenario_change (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scenario_id TEXT NOT NULL,
  op TEXT NOT NULL,
  model_id TEXT,
  rack_id TEXT,
  u_position INTEGER,
  asset_id TEXT,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS work_order (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  title TEXT NOT NULL,
  scenario_id TEXT,
  submitted_by TEXT,
  approved_by TEXT,
  reason TEXT
);
CREATE TABLE IF NOT EXISTS work_task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id TEXT NOT NULL,
  asset_id TEXT,
  rack_id TEXT,
  u_position INTEGER,
  model_id TEXT,
  expected TEXT
);
CREATE TABLE IF NOT EXISTS metric (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  device_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alarm (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  priority INTEGER NOT NULL,
  device_id TEXT,
  text TEXT NOT NULL,
  state TEXT NOT NULL,
  action TEXT,
  ack_user TEXT,
  ack_note TEXT
);
CREATE TABLE IF NOT EXISTS discovery_item (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  device_id TEXT,
  detail TEXT NOT NULL,
  state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_user (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_token (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  tenant_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_delivery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id TEXT,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS report_schedule (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  cadence TEXT NOT NULL
);
"""

_conn = None
_peer = threading.local()
LOCK = threading.Lock()


def set_peer(ip):
    _peer.ip = ip or ""


def now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def connect(path=None):
    global _conn
    path = path or os.environ.get("DCIAC_DB") or DEFAULT_PATH
    os.makedirs(os.path.dirname(path), exist_ok=True)
    _conn = sqlite3.connect(path, check_same_thread=False)
    _conn.row_factory = sqlite3.Row
    _conn.execute("PRAGMA foreign_keys = ON")
    _conn.executescript(SCHEMA)
    migrate(_conn)
    if _conn.execute("SELECT COUNT(*) AS n FROM asset").fetchone()["n"] == 0:
        from server.seed import seed
        seed(_conn)
    ensure_catalog(_conn)
    from server.power_seed import ensure_power
    ensure_power(_conn)
    from server.dcim import ensure_dcim
    ensure_dcim(_conn)
    from server.campus_scale import scale_campus
    scale_campus(_conn)
    _conn.commit()
    return _conn


def db():
    if _conn is None:
        connect()
    return _conn


def row_location(row):
    return {
        "id": row["id"],
        "kind": row["kind"],
        "name": row["name"],
        "parentId": row["parent_id"],
        "custom": json.loads(row["custom_json"] or "{}"),
    }


def row_asset(row):
    return {
        "id": row["id"],
        "assetTag": row["asset_tag"],
        "serial": row["serial"],
        "modelId": row["model_id"],
        "tenantId": row["tenant_id"],
        "lifecycle": row["lifecycle"],
        "installedOn": row["installed_on"],
        "warrantyEnd": row["warranty_end"],
        "locationId": row["location_id"],
        "uPosition": row["u_position"],
        "face": row["face"],
        "width": row["width"],
        "custom": json.loads(row["custom_json"] or "{}"),
    }


def _cell(row, name, default=None):
    value = row[name] if name in row.keys() else None
    return default if value is None else value


def row_model(row):
    return {
        "id": row["id"],
        "manufacturer": row["manufacturer"],
        "model": row["model"],
        "category": row["category"],
        "uHeight": row["u_height"],
        "nameplateW": row["nameplate_w"],
        "depthMm": _cell(row, "depth_mm", 0),
        "weightKg": _cell(row, "weight_kg", 0),
        "typicalW": _cell(row, "typical_w", 0),
        "deratedW": _cell(row, "derated_w", 0),
        "inputVoltage": _cell(row, "input_voltage", ""),
        "plugType": _cell(row, "plug_type", ""),
        "powerPorts": _cell(row, "power_ports", 0),
        "powerPortType": _cell(row, "power_port_type", ""),
        "powerRedundancy": _cell(row, "power_redundancy", ""),
        "netPorts": _cell(row, "net_ports", 0),
        "netSpeed": _cell(row, "net_speed", ""),
        "netMedia": _cell(row, "net_media", ""),
        "place": _cell(row, "place", ""),
        "redfishType": _cell(row, "redfish_type", ""),
        "note": _cell(row, "note", ""),
    }


MODEL_COLUMNS = (
    ("depth_mm", "INTEGER"),
    ("weight_kg", "REAL"),
    ("typical_w", "INTEGER"),
    ("derated_w", "INTEGER"),
    ("input_voltage", "TEXT"),
    ("plug_type", "TEXT"),
    ("power_ports", "INTEGER"),
    ("power_port_type", "TEXT"),
    ("power_redundancy", "TEXT"),
    ("net_ports", "INTEGER"),
    ("net_speed", "TEXT"),
    ("net_media", "TEXT"),
    ("place", "TEXT"),
    ("redfish_type", "TEXT"),
    ("note", "TEXT"),
)


def migrate(conn):
    present = {row[1] for row in conn.execute("PRAGMA table_info(model)")}
    for name, kind in MODEL_COLUMNS:
        if name not in present:
            conn.execute("ALTER TABLE model ADD COLUMN " + name + " " + kind)
    audit_cols = {row[1] for row in conn.execute("PRAGMA table_info(audit_event)")}
    if "prev_hash" not in audit_cols:
        conn.execute("ALTER TABLE audit_event ADD COLUMN prev_hash TEXT")
        conn.execute("ALTER TABLE audit_event ADD COLUMN row_hash TEXT")
    if "source_ip" not in audit_cols:
        conn.execute("ALTER TABLE audit_event ADD COLUMN source_ip TEXT")


def ensure_inventory(conn):
    from server.inventory_catalog import load_sheet
    names = {row["model"].casefold() for row in conn.execute("SELECT model FROM model")}
    ids = {row["id"] for row in conn.execute("SELECT id FROM model")}
    conn.execute(
        "INSERT OR IGNORE INTO location (id, kind, name, parent_id, custom_json) VALUES ('inventory', 'stock', 'Inventory', 'bldg-1', '{}')"
    )
    for item in load_sheet():
        if item[2].casefold() in names:
            continue
        model_id = item[0]
        if model_id in ids:
            model_id = model_id + "-b"
        conn.execute(
            """INSERT OR IGNORE INTO model (
                id, manufacturer, model, category, u_height, nameplate_w, depth_mm, weight_kg,
                typical_w, derated_w, input_voltage, plug_type, power_ports, power_port_type,
                power_redundancy, net_ports, net_speed, net_media, place, redfish_type, note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (model_id, item[1], item[2], item[3], item[4], item[7], item[5], item[6], item[8], item[9], item[10], item[11], item[12], item[13], item[14], item[15], item[16], item[17], item[18], item[19], item[20]),
        )
        conn.execute(
            """INSERT OR IGNORE INTO asset (
                id, asset_tag, serial, model_id, tenant_id, lifecycle, installed_on, warranty_end,
                location_id, u_position, face, width, custom_json
            ) VALUES (?, ?, ?, ?, 'unubtanium', 'Received', '', '2029-01-15', 'inventory', NULL, 'front', 'full', ?)""",
            ("stock-" + model_id, item[2], "STOCK-" + model_id, model_id, json.dumps({"floor": "stock"})),
        )
        names.add(item[2].casefold())
        ids.add(model_id)


def ensure_catalog(conn):
    from server.catalog import A14_GEAR, LIBRARY
    for item in LIBRARY:
        conn.execute(
            """INSERT OR IGNORE INTO model (
                id, manufacturer, model, category, u_height, nameplate_w, depth_mm, weight_kg,
                typical_w, derated_w, input_voltage, plug_type, power_ports, power_port_type,
                power_redundancy, net_ports, net_speed, net_media, place, redfish_type, note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (item[0], item[1], item[2], item[3], item[4], item[7], item[5], item[6], item[8], item[9], item[10], item[11], item[12], item[13], item[14], item[15], item[16], item[17], item[18], item[19], item[20]),
        )
    ensure_inventory(conn)
    for row in conn.execute("SELECT id, custom_json FROM location WHERE kind = 'rack'"):
        custom = json.loads(row["custom_json"] or "{}")
        custom.setdefault("uHeight", 42)
        custom.setdefault("depthMm", 1200)
        custom.setdefault("weightLimitKg", 1500)
        conn.execute("UPDATE location SET custom_json = ? WHERE id = ?", (json.dumps(custom), row["id"]))
    if conn.execute("SELECT id FROM location WHERE id = 'slot-A14'").fetchone():
        for asset_id, tag, model_id, u_position, _units in A14_GEAR:
            conn.execute(
                """INSERT OR IGNORE INTO asset (
                    id, asset_tag, serial, model_id, tenant_id, lifecycle, installed_on, warranty_end,
                    location_id, u_position, face, width, custom_json
                ) VALUES (?, ?, ?, ?, 'unubtanium', 'In service', '2026-01-15', '2029-01-15', 'slot-A14', ?, 'front', 'full', ?)""",
                (asset_id, tag, "SN-" + asset_id, model_id, u_position, json.dumps({"rackId": "A14", "floor": "installed"})),
            )
        for asset_id, tag, side in (("pdu-A14-a", "rPDU-A", "left"), ("pdu-A14-b", "rPDU-B", "right")):
            conn.execute(
                """INSERT OR IGNORE INTO asset (
                    id, asset_tag, serial, model_id, tenant_id, lifecycle, installed_on, warranty_end,
                    location_id, u_position, face, width, custom_json
                ) VALUES (?, ?, ?, 'vertiv-pdu', 'unubtanium', 'In service', '2026-01-15', '2029-01-15', 'slot-A14', NULL, 'front', 'full', ?)""",
                (asset_id, tag, "SN-" + asset_id, json.dumps({"rackId": "A14", "side": side, "floor": "pdu"})),
            )


def locations():
    return [row_location(row) for row in db().execute("SELECT * FROM location ORDER BY id")]


def assets():
    return [row_asset(row) for row in db().execute("SELECT * FROM asset ORDER BY id")]


def models():
    counts = {row["model_id"]: row["n"] for row in db().execute("SELECT model_id, COUNT(*) AS n FROM asset GROUP BY model_id")}
    items = []
    for row in db().execute("SELECT * FROM model ORDER BY manufacturer, model"):
        item = row_model(row)
        item["usedBy"] = counts.get(row["id"], 0)
        items.append(item)
    return items


def model_by_id(model_id):
    row = db().execute("SELECT * FROM model WHERE id = ?", (model_id,)).fetchone()
    if not row:
        return None
    item = row_model(row)
    item["usedBy"] = db().execute("SELECT COUNT(*) AS n FROM asset WHERE model_id = ?", (model_id,)).fetchone()["n"]
    return item


def asset_by_id(asset_id):
    row = db().execute("SELECT * FROM asset WHERE id = ?", (asset_id,)).fetchone()
    return row_asset(row) if row else None


def plant():
    conn = db()
    halls = conn.execute("SELECT COUNT(*) AS n FROM location WHERE kind = 'hall'").fetchone()["n"]
    racks = conn.execute("SELECT COUNT(*) AS n FROM location WHERE kind = 'rack'").fetchone()["n"]
    cabinet_w = conn.execute(
        "SELECT COALESCE(SUM(m.nameplate_w), 0) AS w FROM asset a JOIN model m ON m.id = a.model_id WHERE m.category = 'Cabinet'"
    ).fetchone()["w"]
    one_cdu = conn.execute("SELECT nameplate_w FROM model WHERE category = 'CDU'").fetchone()
    one_cooler = conn.execute("SELECT nameplate_w FROM model WHERE category = 'Cooler'").fetchone()
    one_feeder = conn.execute("SELECT nameplate_w FROM model WHERE category = 'Feeder'").fetchone()
    coolers = conn.execute(
        "SELECT COUNT(*) AS n FROM asset a JOIN model m ON m.id = a.model_id WHERE m.category = 'Cooler'"
    ).fetchone()["n"]
    feeders = conn.execute(
        "SELECT COUNT(*) AS n FROM asset a JOIN model m ON m.id = a.model_id WHERE m.category = 'Feeder'"
    ).fetchone()["n"]
    cabinet = conn.execute("SELECT nameplate_w FROM model WHERE category = 'Cabinet'").fetchone()
    it_w = cabinet_w or 0
    return {
        "halls": halls,
        "racksPerHall": (racks // halls) if halls else 0,
        "kwPerRack": int((cabinet["nameplate_w"] if cabinet else 0) / 1000),
        "itMw": it_w / 1e6,
        "hallItMw": (it_w / halls / 1e6) if halls else 0,
        "cduMw": (one_cdu["nameplate_w"] if one_cdu else 0) / 1e6,
        "feeders": feeders,
        "feederMw": (one_feeder["nameplate_w"] if one_feeder else 0) / 1e6,
        "coolers": coolers,
        "coolerMw": (one_cooler["nameplate_w"] if one_cooler else 0) / 1e6,
        "coolMw": coolers * ((one_cooler["nameplate_w"] if one_cooler else 0) / 1e6),
    }


def world():
    return {
        "plant": plant(),
        "locations": locations(),
        "assets": assets(),
        "models": models(),
    }


def audit(user, role, action, asset_id, before, after, detail):
    import hashlib
    conn = db()
    at = now()
    previous = conn.execute("SELECT row_hash FROM audit_event WHERE row_hash IS NOT NULL ORDER BY id DESC LIMIT 1").fetchone()
    prev = previous["row_hash"] if previous else ""
    ip = getattr(_peer, "ip", "") or ""
    parts = [prev, at, user or "", role or "", action or "", asset_id or "", detail or ""]
    if ip:
        parts.append(ip)
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    conn.execute(
        """INSERT INTO audit_event (
            at, user_id, role, action, asset_id, before_json, after_json, detail, prev_hash, row_hash, source_ip
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (at, user, role, action, asset_id, json.dumps(before) if before is not None else None, json.dumps(after) if after is not None else None, detail, prev, digest, ip or None),
    )


def audit_log(limit=50):
    rows = db().execute("SELECT * FROM audit_event ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [{
        "id": row["id"],
        "at": row["at"],
        "user": row["user_id"],
        "role": row["role"],
        "action": row["action"],
        "assetId": row["asset_id"],
        "detail": row["detail"],
    } for row in rows]
