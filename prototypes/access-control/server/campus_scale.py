"""Size the running campus to 100 MW and put the inventory sheet on the floor."""

import json
import re

RACK_W = 500000
CDU_W = 12000000
BUS_W = 16000000
MODULE_W = 80000000
FEEDER_W = 150000000
COOLER_W = 20000000

OUTSIDE_WORDS = (
    "generator", "chiller", "ups", "battery", "transfer switch", "sts2",
    "liebert rpp", "liebert fpc", "track busway", "security camera",
    "building management", "clean agent", "fire suppression",
)


def outside(category, model, note):
    text = " ".join((category or "", model or "", note or "")).lower()
    if category == "Facility":
        return True
    return any(word in text for word in OUTSIDE_WORDS)


def kind_for(category, model):
    text = (model or "").lower()
    if category == "Cooling" or "cdu" in text or "leak" in text:
        return "Cooling"
    if category == "Power":
        return "Powershelf" if "shelf" in text or "pdu" in text else "Power module"
    if category == "Network":
        return "Switch"
    if category == "Environmental":
        return "Containment"
    if category == "Storage":
        return "Storage"
    return "Server"


def retune_models(conn):
    updates = (
        ("cabinet-42u", RACK_W),
        ("feeder-32mw", FEEDER_W),
        ("transformer-32mw", FEEDER_W),
        ("power-module-8mw", MODULE_W),
        ("cooler-5mw", COOLER_W),
        ("cdu-4mw", CDU_W),
    )
    for model_id, watts in updates:
        conn.execute("UPDATE model SET nameplate_w = ? WHERE id = ?", (watts, model_id))


def retitle(name):
    name = re.sub(r"\b32 MW\b", "150 MW", name)
    name = re.sub(r"\b120 MW\b", "150 MW", name)
    name = re.sub(r"\b8 MW\b", "80 MW", name)
    name = re.sub(r"\b60 MW\b", "80 MW", name)
    name = re.sub(r"\b5 MW\b", "20 MW", name)
    return name


def retune_labels(conn):
    for row in conn.execute("SELECT id, custom_json FROM asset WHERE location_id = 'yard'"):
        custom = json.loads(row["custom_json"] or "{}")
        name = custom.get("name") or ""
        titled = retitle(name)
        if titled == name:
            continue
        custom["name"] = titled
        conn.execute("UPDATE asset SET custom_json = ? WHERE id = ?", (json.dumps(custom, separators=(",", ":")), row["id"]))


def retune_power(conn):
    current = conn.execute("SELECT capacity_w FROM power_node WHERE id = 'grid-1'").fetchone()
    if not current or current["capacity_w"] == FEEDER_W:
        return
    conn.execute(
        "UPDATE power_node SET capacity_w = ? WHERE id IN ('grid-1', 'grid-2', 'xfmr-1', 'xfmr-2')",
        (FEEDER_W,),
    )
    conn.execute(
        "UPDATE power_node SET capacity_w = ? WHERE id IN ('pwr-mod', 'pwr-2', 'pwr-3', 'pwr-4')",
        (MODULE_W,),
    )
    conn.execute("UPDATE power_node SET capacity_w = ? WHERE id LIKE 'bus-%'", (BUS_W,))
    conn.execute(
        "UPDATE power_node SET capacity_w = ?, nameplate_w = ?, derated_w = ? WHERE id LIKE 'rack-%'",
        (RACK_W, RACK_W, 400000),
    )
    conn.execute("UPDATE power_edge SET capacity_w = ? WHERE id IN ('e-fa-xa', 'e-fb-xb')", (FEEDER_W,))
    conn.execute(
        "UPDATE power_edge SET capacity_w = ? WHERE id IN ('e-xa-ma', 'e-xa-mc', 'e-xb-mb', 'e-xb-md')",
        (MODULE_W,),
    )
    conn.execute("UPDATE power_edge SET capacity_w = ? WHERE id LIKE 'e-pwr-%'", (BUS_W,))
    conn.execute("UPDATE power_edge SET capacity_w = ? WHERE id LIKE 'e-bus-rack-%'", (RACK_W,))


def yard_spot(index):
    col = index % 8
    row = index // 8
    return -620 + col * 145, 240 + row * 72, 128, 44, 36


def hall_spot(slot):
    return 20 + slot * 148, 332, 132, 36, 36


def place_inventory(conn):
    rows = conn.execute(
        """SELECT a.id, a.asset_tag, m.model, m.category, m.note
           FROM asset a JOIN model m ON m.id = a.model_id
           WHERE a.location_id = 'inventory' ORDER BY m.category, m.model"""
    ).fetchall()
    if not rows:
        return
    halls = []
    for row in conn.execute("SELECT id, custom_json FROM location WHERE kind = 'hall'"):
        halls.append((json.loads(row["custom_json"] or "{}").get("index") or 0, row["id"]))
    halls = [hall_id for _, hall_id in sorted(halls)]
    yard_n = 0
    hall_n = 0
    for row in rows:
        name = row["model"]
        if outside(row["category"], row["model"], row["note"]):
            x, y, w, d, h = yard_spot(yard_n)
            yard_n += 1
            custom = {
                "floor": "yard", "name": name, "kind": kind_for(row["category"], row["model"]),
                "x": x, "y": y, "w": w, "d": d, "h": h, "power": 42, "temp": 34,
                "klass": "cooler-yard" if row["category"] == "Cooling" else "module-yard",
            }
            location = "yard"
        else:
            slot = hall_n // max(len(halls), 1)
            hall = halls[hall_n % len(halls)] if halls else "pod-a"
            hall_n += 1
            x, y, w, d, h = hall_spot(slot)
            custom = {
                "floor": "box", "name": name, "kind": kind_for(row["category"], row["model"]),
                "x": x, "y": y, "w": w, "d": d, "h": h,
            }
            location = hall
        conn.execute(
            "UPDATE asset SET location_id = ?, lifecycle = 'In service', custom_json = ? WHERE id = ?",
            (location, json.dumps(custom, separators=(",", ":")), row["id"]),
        )


def scale_campus(conn):
    retune_models(conn)
    retune_labels(conn)
    retune_power(conn)
    place_inventory(conn)
