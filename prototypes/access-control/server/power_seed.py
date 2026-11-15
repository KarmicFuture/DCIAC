"""Seed the feeder-to-PSU graph from the campus assets. Runs once."""

import json

from server.power import analyze, upward

A14 = (
    ("tray-01", "GPU tray 01", 1, 12000, 10000),
    ("tray-02", "GPU tray 02", 2, 12000, 10000),
    ("tray-03", "GPU tray 03", 3, 12000, 10000),
    ("sn2201", "SN2201", 4, 400, 300),
    ("tray-04", "GPU tray 04", 7, 12000, 10000),
    ("tray-05", "GPU tray 05", 8, 12000, 10000),
    ("tray-06", "GPU tray 06", 9, 12000, 10000),
    ("tray-07", "GPU tray 07", 10, 12000, 10000),
    ("tray-08", "GPU tray 08", 11, 12000, 10000),
)

YARD = (
    ("grid-1", "Feeder A", "feeder", "A", "source", 32000000),
    ("grid-2", "Feeder B", "feeder", "B", "source", 32000000),
    ("xfmr-1", "Transformer A", "transformer", "A", "distribution", 32000000),
    ("xfmr-2", "Transformer B", "transformer", "B", "distribution", 32000000),
    ("pwr-mod", "Power module A", "module", "A", "distribution", 8000000),
    ("pwr-2", "Power module B", "module", "B", "distribution", 8000000),
    ("pwr-3", "Power module C", "module", "A", "distribution", 8000000),
    ("pwr-4", "Power module D", "module", "B", "distribution", 8000000),
)


def amps(watts, volts, phases):
    if not volts:
        return 0
    if phases == 3:
        return round(watts / (1.732 * volts), 1)
    return round(watts / float(volts), 1)


def add_node(conn, node_id, name, kind, side, role, capacity, nameplate=0, derated=0, asset_id=None, device_id=None, rack_id=None):
    conn.execute(
        """INSERT INTO power_node (
            id, asset_id, device_id, rack_id, kind, name, side, role, capacity_w, nameplate_w, derated_w
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (node_id, asset_id, device_id, rack_id, kind, name, side, role, int(capacity), int(nameplate), int(derated)),
    )


def add_edge(conn, edge_id, upstream, downstream, watts, volts, phases):
    conn.execute(
        "INSERT INTO power_edge (id, upstream_id, downstream_id, capacity_w, capacity_a) VALUES (?, ?, ?, ?, ?)",
        (edge_id, upstream, downstream, int(watts), amps(watts, volts, phases)),
    )


def hall_key(rack_id):
    if rack_id.startswith("A"):
        return "a"
    return rack_id.split("-")[0][1:]


def module_pair(key):
    number = 1 if key == "a" else int(key)
    if number <= 5:
        return ("pwr-mod", "pwr-2")
    return ("pwr-3", "pwr-4")


def ensure_power(conn):
    if conn.execute("SELECT COUNT(*) AS n FROM power_node").fetchone()["n"]:
        return
    for node_id, name, kind, side, role, capacity in YARD:
        add_node(conn, node_id, name, kind, side, role, capacity, asset_id=node_id)
    add_edge(conn, "e-fa-xa", "grid-1", "xfmr-1", 32000000, 13800, 3)
    add_edge(conn, "e-fb-xb", "grid-2", "xfmr-2", 32000000, 13800, 3)
    add_edge(conn, "e-xa-ma", "xfmr-1", "pwr-mod", 8000000, 13800, 3)
    add_edge(conn, "e-xa-mc", "xfmr-1", "pwr-3", 8000000, 13800, 3)
    add_edge(conn, "e-xb-mb", "xfmr-2", "pwr-2", 8000000, 13800, 3)
    add_edge(conn, "e-xb-md", "xfmr-2", "pwr-4", 8000000, 13800, 3)
    for index in range(10):
        key = "a" if index == 0 else str(index + 1)
        bus = "bus-" + key
        add_node(conn, bus, "Hall " + str(index + 1) + " busway", "bus", "both", "distribution", 4000000, asset_id=bus, rack_id=key)
        left, right = module_pair(key)
        add_edge(conn, "e-" + left + "-" + bus, left, bus, 8000000, 415, 3)
        add_edge(conn, "e-" + right + "-" + bus, right, bus, 8000000, 415, 3)
    for row in conn.execute(
        """SELECT a.id, a.custom_json FROM asset a
           JOIN model m ON m.id = a.model_id WHERE m.category = 'Cabinet'"""
    ):
        custom = json.loads(row["custom_json"] or "{}")
        rack = custom.get("rackId") or ""
        if not rack or rack == "A14":
            continue
        node = "rack-" + rack
        add_node(conn, node, "Rack " + rack, "rack", "both", "load", 120000, 120000, 96000, asset_id=row["id"], rack_id=rack)
        add_edge(conn, "e-bus-" + node, "bus-" + hall_key(rack), node, 120000, 415, 3)
    add_node(conn, "pdu-A14-a", "rPDU A", "rpdu", "A", "distribution", 120000, asset_id="pdu-A14-a", rack_id="A14")
    add_node(conn, "pdu-A14-b", "rPDU B", "rpdu", "B", "distribution", 120000, asset_id="pdu-A14-b", rack_id="A14")
    add_edge(conn, "e-bus-rpdu-a", "bus-a", "pdu-A14-a", 120000, 50, 1)
    add_edge(conn, "e-bus-rpdu-b", "bus-a", "pdu-A14-b", 120000, 50, 1)
    for device_id, name, outlet, nameplate, derated in A14:
        for side, label in (("a", "A"), ("b", "B")):
            half_n = nameplate // 2
            half_d = derated // 2
            outlet_id = "outlet-" + side + "-" + str(outlet)
            psu_id = "psu-" + device_id + "-" + side
            add_node(conn, outlet_id, "Outlet " + str(outlet), "outlet", label, "distribution", half_n, asset_id="pdu-A14-" + side, device_id=device_id, rack_id="A14")
            add_node(conn, psu_id, name + " PSU " + label, "psu", label, "load", half_n, half_n, half_d, device_id=device_id, rack_id="A14")
            add_edge(conn, "e-" + outlet_id, "pdu-A14-" + side, outlet_id, half_n, 50, 1)
            add_edge(conn, "e-" + psu_id, outlet_id, psu_id, half_n, 50, 1)


def row_node(row):
    return {
        "id": row["id"],
        "assetId": row["asset_id"],
        "deviceId": row["device_id"] or "",
        "rackId": row["rack_id"] or "",
        "kind": row["kind"],
        "name": row["name"],
        "side": row["side"],
        "role": row["role"],
        "capacityW": row["capacity_w"],
        "nameplateW": row["nameplate_w"],
        "deratedW": row["derated_w"],
    }


def row_edge(row):
    return {
        "id": row["id"],
        "upstreamId": row["upstream_id"],
        "downstreamId": row["downstream_id"],
        "capacityW": row["capacity_w"],
        "capacityA": row["capacity_a"],
    }


def load_graph(conn):
    nodes = [row_node(row) for row in conn.execute("SELECT * FROM power_node")]
    edges = [row_edge(row) for row in conn.execute("SELECT * FROM power_edge")]
    return nodes, edges


def public_node(node):
    return {
        "id": node["id"],
        "name": node["name"],
        "kind": node["kind"],
        "side": node["side"],
        "role": node["role"],
        "capacityW": node["capacityW"],
        "nameplateW": node["nameplateW"],
        "deratedW": node["deratedW"],
        "deviceId": node.get("deviceId") or "",
        "rackId": node.get("rackId") or "",
    }


def public_edge(edge):
    if not edge:
        return None
    return {"capacityW": edge["capacityW"], "capacityA": edge["capacityA"]}


def hops_public(hops):
    return [{"node": public_node(item["node"]), "edge": public_edge(item["edge"])} for item in hops]


def lookup(conn, node_id):
    nodes, edges = load_graph(conn)
    by_id = {node["id"]: node for node in nodes}
    chosen = []
    if node_id in by_id:
        chosen = [by_id[node_id]]
    else:
        chosen = [node for node in nodes if node.get("deviceId") == node_id or node.get("rackId") == node_id and node.get("role") == "load"]
        if not chosen:
            chosen = [node for node in nodes if node.get("rackId") == node_id and node.get("kind") == "bus"]
    if not chosen:
        return None
    loads = [node for node in chosen if node["role"] == "load"]
    if len(loads) > 4:
        return {"id": node_id, "title": "Rack " + node_id, "paths": [], "deviceCount": len({node.get("deviceId") for node in loads}), "feeds": ["grid-1", "grid-2"]}
    paths = []
    seeds = loads or chosen[:1]
    for node in seeds:
        if node["side"] == "both":
            sides = ("A", "B")
        else:
            sides = (node["side"],)
        for side in sides:
            paths.append({"side": side, "start": node["id"], "hops": hops_public(upward(node["id"], nodes, edges, side))})
        if node["role"] == "load" and len(seeds) > 4:
            break
    title = chosen[0]["name"]
    if len(seeds) > 1 and seeds[0].get("deviceId"):
        title = seeds[0]["deviceId"]
    return {"id": node_id, "title": title, "paths": paths, "feeds": ["grid-1", "grid-2"]}


def failure(conn, node_id, mode, measured, factors=None):
    nodes, edges = load_graph(conn)
    if node_id and not any(node["id"] == node_id for node in nodes):
        return None
    if mode not in ("nameplate", "derated", "measured"):
        mode = "nameplate"
    report = analyze(nodes, edges, node_id, mode, measured or {}, factors or {})
    report.pop("carried", None)
    return report
