"""Seed the campus that used to be hard-coded in the floor model."""

import json

TENANT = "unubtanium"
INSTALLED = "2026-01-15"
WARRANTY = "2029-01-15"

MODELS = [
    ("cabinet-42u", "Unubtanium", "42U AI rack", "Cabinet", 42, 500000),
    ("feeder-32mw", "Unubtanium", "Utility feeder", "Feeder", None, 150000000),
    ("transformer-32mw", "Unubtanium", "MV transformer", "Transformer", None, 150000000),
    ("power-module-8mw", "Unubtanium", "Power module", "PowerModule", None, 80000000),
    ("battery-skid", "Unubtanium", "Battery skid", "Battery", None, 0),
    ("cooler-5mw", "Unubtanium", "Heat rejection", "Cooler", None, 20000000),
    ("pump-skid", "Unubtanium", "Pump skid", "PumpSkid", None, 0),
    ("onecore", "Unubtanium", "OneCore", "Core", None, 0),
    ("cdu-4mw", "Unubtanium", "CDU", "CDU", None, 12000000),
    ("dc-shelf", "Unubtanium", "DC power shelf", "PowerShelf", 4, 80000),
    ("busway", "Unubtanium", "Overhead busway", "Busway", None, 0),
    ("containment", "Unubtanium", "Hot aisle containment", "Containment", None, 0),
    ("aisle", "Unubtanium", "Aisle", "Aisle", None, 0),
    ("ups", "Unubtanium", "UPS", "UPS", None, 500000),
    ("crac", "Unubtanium", "CRAH", "CRAC", None, 18000),
]


def dumps(value):
    return json.dumps(value, separators=(",", ":"))


def add_location(conn, loc_id, kind, name, parent, custom):
    conn.execute(
        "INSERT INTO location (id, kind, name, parent_id, custom_json) VALUES (?, ?, ?, ?, ?)",
        (loc_id, kind, name, parent, dumps(custom or {})),
    )


def add_asset(conn, asset_id, tag, model_id, location_id, custom, u_position=None, face="front", width="full"):
    conn.execute(
        """INSERT INTO asset (
            id, asset_tag, serial, model_id, tenant_id, lifecycle, installed_on, warranty_end,
            location_id, u_position, face, width, custom_json
        ) VALUES (?, ?, ?, ?, ?, 'In service', ?, ?, ?, ?, ?, ?, ?)""",
        (asset_id, tag, "SN-" + asset_id, model_id, TENANT, INSTALLED, WARRANTY, location_id, u_position, face, width, dumps(custom)),
    )


def hall_key(index):
    return "a" if index == 0 else str(index + 1)


def rack_id(index, n):
    number = str(n).zfill(2)
    if index == 0:
        return "A" + number
    return "H" + str(index + 1) + "-" + number


def seed(conn):
    conn.execute("INSERT INTO tenant (id, name) VALUES (?, ?)", (TENANT, "Unubtanium"))
    conn.executemany(
        "INSERT INTO model (id, manufacturer, model, category, u_height, nameplate_w) VALUES (?, ?, ?, ?, ?, ?)",
        MODELS,
    )
    add_location(conn, "site-1", "site", "Unubtanium campus", None, {})
    add_location(conn, "bldg-1", "building", "Data hall building", "site-1", {})
    add_location(conn, "yard", "yard", "Yard", "bldg-1", {})
    for index in range(10):
        seed_hall(conn, index)
    seed_yard(conn)
    conn.commit()


def seed_hall(conn, index):
    n = index + 1
    key = hall_key(index)
    hall_id = "pod-a" if index == 0 else "hall-" + str(n)
    col = index % 5
    row = index // 5
    add_location(conn, hall_id, "hall", "Hall " + str(n), "bldg-1", {
        "index": index,
        "letter": str(n),
        "managed": index == 0,
        "key": key,
        "x": -470, "y": -190, "w": 940, "h": 380,
        "site": {"x": -280 + col * 156, "y": -170 + row * 190, "w": 118, "d": 78, "h": 36},
    })
    cold_n = "cold-" + key + "1"
    hot = "hot-" + key
    cold_s = "cold-" + key + "2"
    row_n = "row-" + key + "-n"
    row_s = "row-" + key + "-s"
    add_location(conn, row_n, "row", "North row", hall_id, {"y": 62, "cold": cold_n, "hot": hot})
    add_location(conn, row_s, "row", "South row", hall_id, {"y": 214, "cold": cold_s, "hot": hot})
    for number in range(1, 21):
        rid = rack_id(index, number)
        north = number <= 10
        coln = (number - 1) % 10
        slot = "slot-" + rid
        parent = row_n if north else row_s
        add_location(conn, slot, "rack", "Rack " + rid, parent, {})
        servers = ["tray-01", "tray-02", "tray-03", "tray-04", "tray-05", "tray-06", "tray-07", "tray-08", "sn2201", "pshelf"] if rid == "A14" else []
        add_asset(conn, "cab-" + rid, rid, "cabinet-42u", slot, {
            "floor": "rack",
            "rackId": rid,
            "name": "Rack " + rid,
            "n": number,
            "row": parent,
            "x": 24 + coln * 76,
            "y": 62 if north else 214,
            "w": 58, "d": 46, "h": 124 if rid == "A14" else 112,
            "kind": "GPU",
            "servers": servers,
        })
    add_asset(conn, "cdu-" + key, "CDU " + key, "cdu-4mw", hall_id, {
        "floor": "box", "x": 820, "y": 120, "w": 88, "d": 52, "h": 40, "kind": "Cooling",
    })
    add_asset(conn, "shelf-" + key, "DC shelf " + key, "dc-shelf", hall_id, {
        "floor": "box", "x": 820, "y": 200, "w": 76, "d": 40, "h": 44, "kind": "Powershelf",
    })
    add_asset(conn, "bus-" + key, "Bus " + key, "busway", hall_id, {
        "floor": "busbar", "x": 20, "y": 156, "w": 760, "d": 14, "h": 8,
    })
    add_asset(conn, "hac-" + key, "Containment " + key, "containment", hall_id, {
        "floor": "containment", "x": 20, "y": 146, "w": 760, "d": 32, "h": 28,
    })
    add_asset(conn, cold_n, "Cold aisle " + key, "aisle", hall_id, {
        "floor": "aisle", "tone": "cold", "label": "Cold aisle", "x": 16, "y": 16, "w": 780, "h": 30,
    })
    add_asset(conn, hot, "Hot aisle " + key, "aisle", hall_id, {
        "floor": "aisle", "tone": "hot", "label": "Hot aisle", "x": 16, "y": 140, "w": 780, "h": 42,
    })
    add_asset(conn, cold_s, "Cold aisle return " + key, "aisle", hall_id, {
        "floor": "aisle", "tone": "cold", "label": "Cold aisle", "x": 16, "y": 292, "w": 780, "h": 30,
    })


YARD = [
    ("grid-1", "Feeder A · 150 MW", "feeder-32mw", "Grid", -610, -250, 96, 64, 58, 46, 28, "grid-yard"),
    ("grid-2", "Feeder B · 150 MW", "feeder-32mw", "Grid", -490, -250, 96, 64, 58, 44, 28, "grid-yard"),
    ("xfmr-1", "Transformer A · 150 MW", "transformer-32mw", "Power module", -610, -150, 90, 58, 50, 50, 40, "xfmr-yard"),
    ("xfmr-2", "Transformer B · 150 MW", "transformer-32mw", "Power module", -490, -150, 90, 58, 50, 48, 40, "xfmr-yard"),
    ("pwr-mod", "Power module A · 80 MW", "power-module-8mw", "Power module", -610, -50, 96, 60, 52, 58, 44, "module-yard"),
    ("pwr-2", "Power module B · 80 MW", "power-module-8mw", "Power module", -490, -50, 96, 60, 52, 56, 43, "module-yard"),
    ("pwr-3", "Power module C · 80 MW", "power-module-8mw", "Power module", -610, 40, 96, 60, 52, 54, 42, "module-yard"),
    ("pwr-4", "Power module D · 80 MW", "power-module-8mw", "Power module", -490, 40, 96, 60, 52, 52, 42, "module-yard"),
    ("batt-1", "Battery A", "battery-skid", "Power module", -610, 140, 90, 48, 40, 36, 32, "battery-yard"),
    ("batt-2", "Battery B", "battery-skid", "Power module", -490, 140, 90, 48, 40, 34, 32, "battery-yard"),
    ("heat-1", "Cooler 1 · 20 MW", "cooler-5mw", "Heat rejection", 500, -220, 110, 52, 40, 60, 36, "cooler-yard"),
    ("heat-2", "Cooler 2 · 20 MW", "cooler-5mw", "Heat rejection", 500, -140, 110, 52, 40, 58, 36, "cooler-yard"),
    ("heat-3", "Cooler 3 · 20 MW", "cooler-5mw", "Heat rejection", 500, -60, 110, 52, 40, 57, 35, "cooler-yard"),
    ("heat-4", "Cooler 4 · 20 MW", "cooler-5mw", "Heat rejection", 500, 20, 110, 52, 40, 55, 35, "cooler-yard"),
    ("heat-5", "Cooler 5 · 20 MW", "cooler-5mw", "Heat rejection", 500, 100, 110, 52, 40, 54, 34, "cooler-yard"),
    ("heat-6", "Cooler 6 · 20 MW", "cooler-5mw", "Heat rejection", 500, 180, 110, 52, 40, 40, 32, "cooler-yard"),
    ("hydro-1", "Pump skid A", "pump-skid", "Cooling", 390, 40, 90, 48, 34, 52, 30, "hydro-yard"),
    ("hydro-2", "Pump skid B", "pump-skid", "Cooling", 390, 120, 90, 48, 34, 28, 28, "hydro-yard"),
    ("core-1", "OneCore", "onecore", "Core", -40, -300, 140, 56, 44, 34, 28, "core-block"),
]


def seed_yard(conn):
    for item in YARD:
        asset_id, name, model_id, kind, x, y, w, d, h, power, temp, klass = item
        add_asset(conn, asset_id, name, model_id, "yard", {
            "floor": "yard",
            "name": name,
            "kind": kind,
            "x": x, "y": y, "w": w, "d": d, "h": h,
            "power": power, "temp": temp, "klass": klass,
        })
