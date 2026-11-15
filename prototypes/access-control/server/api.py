"""HTTP API for the asset repository. Roles are the demo identities until real auth."""

import json

from server import db
from server.elevation import check_move, payload as elevation_payload, rack_code, shape, slot_of
from server.power_seed import failure as power_failure, lookup as power_lookup
from server.fit import check_fit

WRITERS = {"Administrator"}
KNOWN_ROLES = {"Administrator", "Operator", "ReadOnly"}
MUTABLE = ("assetTag", "serial", "lifecycle", "tenantId", "installedOn", "warrantyEnd", "uPosition", "face", "width", "custom")
COLUMNS = {
    "assetTag": "asset_tag",
    "serial": "serial",
    "lifecycle": "lifecycle",
    "tenantId": "tenant_id",
    "installedOn": "installed_on",
    "warrantyEnd": "warranty_end",
    "uPosition": "u_position",
    "face": "face",
    "width": "width",
}


def identity(headers):
    user = headers.get("x-dciac-user") or headers.get("X-Dciac-User") or ""
    role = headers.get("x-dciac-role") or headers.get("X-Dciac-Role") or ""
    if user.strip() and role.strip():
        return user.strip(), role.strip()
    auth = headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        from server.dcim import session_user
        found = session_user(db.db(), auth.split(" ", 1)[1].strip())
        if found:
            return found["user"], found["role"]
    return user.strip(), role.strip()


def require_writer(headers):
    user, role = identity(headers)
    if not user or role not in KNOWN_ROLES:
        return None, (401, {"error": "Sign in is required to change an asset."})
    if role not in WRITERS:
        if role == "ReadOnly":
            message = "Read only cannot change assets."
        else:
            message = "Operator cannot edit assets."
        return None, (403, {"error": message})
    return (user, role), None


def create_asset(headers, body):
    who, denied = require_writer(headers)
    if denied:
        return denied
    missing = [key for key in ("id", "assetTag", "serial", "modelId", "locationId") if not body.get(key)]
    if missing:
        return 400, {"error": "Missing " + ", ".join(missing) + "."}
    lifecycle = body.get("lifecycle") or "Planned"
    if lifecycle not in db.LIFECYCLES:
        return 400, {"error": "Unknown lifecycle."}
    if db.asset_by_id(body["id"]):
        return 409, {"error": "Asset already exists."}
    model = db.db().execute("SELECT id FROM model WHERE id = ?", (body["modelId"],)).fetchone()
    location = db.db().execute("SELECT id FROM location WHERE id = ?", (body["locationId"],)).fetchone()
    if not model or not location:
        return 400, {"error": "Model or location does not exist."}
    custom = body.get("custom") if isinstance(body.get("custom"), dict) else {}
    db.db().execute(
        """INSERT INTO asset (
            id, asset_tag, serial, model_id, tenant_id, lifecycle, installed_on, warranty_end,
            location_id, u_position, face, width, custom_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            body["id"], body["assetTag"], body["serial"], body["modelId"], body.get("tenantId") or "unubtanium",
            lifecycle, body.get("installedOn"), body.get("warrantyEnd"), body["locationId"],
            body.get("uPosition"), body.get("face") or "front", body.get("width") or "full", json.dumps(custom),
        ),
    )
    created = db.asset_by_id(body["id"])
    user, role = who
    db.audit(user, role, "asset create", created["id"], None, created, "Created " + created["assetTag"])
    db.db().commit()
    return 201, created


def patch_asset(headers, asset_id, body):
    who, denied = require_writer(headers)
    if denied:
        return denied
    current = db.asset_by_id(asset_id)
    if not current:
        return 404, {"error": "Asset not found."}
    if not isinstance(body, dict) or not body:
        return 400, {"error": "Nothing to change."}
    unknown = [key for key in body if key not in MUTABLE]
    if unknown:
        return 400, {"error": "Cannot change " + ", ".join(unknown) + "."}
    if "lifecycle" in body and body["lifecycle"] not in db.LIFECYCLES:
        return 400, {"error": "Unknown lifecycle."}
    custom = dict(current["custom"])
    if "custom" in body:
        if not isinstance(body["custom"], dict):
            return 400, {"error": "custom must be an object."}
        custom.update(body["custom"])
    nxt = dict(current)
    for key in COLUMNS:
        if key in body:
            nxt[key] = body[key]
    nxt["custom"] = custom
    db.db().execute(
        """UPDATE asset SET asset_tag = ?, serial = ?, lifecycle = ?, tenant_id = ?, installed_on = ?,
           warranty_end = ?, u_position = ?, face = ?, width = ?, custom_json = ? WHERE id = ?""",
        (
            nxt["assetTag"], nxt["serial"], nxt["lifecycle"], nxt["tenantId"], nxt["installedOn"],
            nxt["warrantyEnd"], nxt["uPosition"], nxt["face"], nxt["width"], json.dumps(custom), asset_id,
        ),
    )
    saved = db.asset_by_id(asset_id)
    user, role = who
    db.audit(user, role, "asset update", asset_id, current, saved, saved["assetTag"] + " updated")
    db.db().commit()
    return 200, saved


MODEL_FIELDS = {
    "manufacturer": "manufacturer",
    "model": "model",
    "category": "category",
    "uHeight": "u_height",
    "nameplateW": "nameplate_w",
    "depthMm": "depth_mm",
    "weightKg": "weight_kg",
    "typicalW": "typical_w",
    "deratedW": "derated_w",
    "inputVoltage": "input_voltage",
    "plugType": "plug_type",
    "powerPorts": "power_ports",
    "powerPortType": "power_port_type",
    "powerRedundancy": "power_redundancy",
    "netPorts": "net_ports",
    "netSpeed": "net_speed",
    "netMedia": "net_media",
    "place": "place",
    "redfishType": "redfish_type",
    "note": "note",
}


def save_model(model_id, body, existing=None):
    current = existing or {}
    merged = dict(current)
    merged.update({key: body[key] for key in MODEL_FIELDS if key in body})
    merged["id"] = model_id
    if merged.get("nameplateW") is None:
        merged["nameplateW"] = 0
    if not merged.get("manufacturer") or not merged.get("model") or not merged.get("category"):
        return None, (400, {"error": "Manufacturer, model, and category are required."})
    values = [merged.get(key) if merged.get(key) != "" else None for key in (
        "manufacturer", "model", "category", "uHeight", "nameplateW", "depthMm", "weightKg", "typicalW", "deratedW",
        "inputVoltage", "plugType", "powerPorts", "powerPortType", "powerRedundancy", "netPorts", "netSpeed", "netMedia",
        "place", "redfishType", "note",
    )]
    db.db().execute(
        """INSERT INTO model (
            id, manufacturer, model, category, u_height, nameplate_w, depth_mm, weight_kg, typical_w, derated_w,
            input_voltage, plug_type, power_ports, power_port_type, power_redundancy, net_ports, net_speed, net_media,
            place, redfish_type, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            manufacturer = excluded.manufacturer, model = excluded.model, category = excluded.category,
            u_height = excluded.u_height, nameplate_w = excluded.nameplate_w, depth_mm = excluded.depth_mm,
            weight_kg = excluded.weight_kg, typical_w = excluded.typical_w, derated_w = excluded.derated_w,
            input_voltage = excluded.input_voltage, plug_type = excluded.plug_type, power_ports = excluded.power_ports,
            power_port_type = excluded.power_port_type, power_redundancy = excluded.power_redundancy,
            net_ports = excluded.net_ports, net_speed = excluded.net_speed, net_media = excluded.net_media,
            place = excluded.place, redfish_type = excluded.redfish_type, note = excluded.note""",
        [model_id] + values,
    )
    return db.model_by_id(model_id), None


def create_model(headers, body):
    who, denied = require_writer(headers)
    if denied:
        return denied
    model_id = (body.get("id") or "").strip()
    if not model_id:
        return 400, {"error": "Model id is required."}
    if db.model_by_id(model_id):
        return 409, {"error": "Model already exists."}
    saved, err = save_model(model_id, body)
    if err:
        return err
    user, role = who
    db.audit(user, role, "model create", model_id, None, saved, "Model " + saved["model"])
    db.db().commit()
    return 201, saved


def patch_model(headers, model_id, body):
    who, denied = require_writer(headers)
    if denied:
        return denied
    current = db.model_by_id(model_id)
    if not current:
        return 404, {"error": "Model not found."}
    saved, err = save_model(model_id, body, current)
    if err:
        return err
    user, role = who
    db.audit(user, role, "model update", model_id, current, saved, "Model " + saved["model"] + " updated")
    db.db().commit()
    return 200, saved


def clone_model(headers, model_id):
    who, denied = require_writer(headers)
    if denied:
        return denied
    current = db.model_by_id(model_id)
    if not current:
        return 404, {"error": "Model not found."}
    new_id = model_id + "-copy"
    n = 2
    while db.model_by_id(new_id):
        new_id = model_id + "-copy-" + str(n)
        n += 1
    body = dict(current)
    body["model"] = current["model"] + " copy"
    body["id"] = new_id
    saved, err = save_model(new_id, body)
    if err:
        return err
    user, role = who
    db.audit(user, role, "model clone", new_id, current, saved, "Cloned from " + model_id)
    db.db().commit()
    return 201, saved


def import_models(headers, body):
    import csv
    import io
    who, denied = require_writer(headers)
    if denied:
        return denied
    text = body.get("csv") if isinstance(body, dict) else ""
    if not text:
        return 400, {"error": "CSV text is required."}
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "id" not in reader.fieldnames:
        return 400, {"error": "CSV needs an id column."}
    saved = []
    for row in reader:
        model_id = (row.get("id") or "").strip()
        if not model_id:
            continue
        payload = {}
        for key in MODEL_FIELDS:
            if key in row and row[key] != "":
                payload[key] = row[key]
        for numeric in ("uHeight", "nameplateW", "depthMm", "typicalW", "deratedW", "powerPorts", "netPorts"):
            if numeric in payload:
                payload[numeric] = int(float(payload[numeric]))
        if "weightKg" in payload:
            payload["weightKg"] = float(payload["weightKg"])
        existing = db.model_by_id(model_id)
        item, err = save_model(model_id, payload, existing)
        if err:
            return err
        saved.append(item["id"])
    user, role = who
    db.audit(user, role, "model import", None, None, {"ids": saved}, "Imported " + str(len(saved)) + " models")
    db.db().commit()
    return 200, {"imported": saved, "models": db.models()}


def resolve_rack(model, body):
    requested = body.get("locationId") or ""
    if (model.get("place") or "") != "rack":
        location = db.db().execute("SELECT * FROM location WHERE id = ?", (requested,)).fetchone()
        if not location:
            return None, None, (400, {"error": "Location does not exist."})
        kind = location["kind"]
        if model.get("place") == "yard" and kind != "yard":
            return None, None, (400, {"error": "This model sits in the yard."})
        if model.get("place") == "floor" and kind != "hall":
            return None, None, (400, {"error": "This model sits on a hall floor."})
        return db.row_location(location), requested, None
    if requested.startswith("plan-"):
        hall = body.get("hallId") or "pod-a"
        if not db.db().execute("SELECT id FROM location WHERE id = ?", (hall,)).fetchone():
            return None, None, (400, {"error": "Hall does not exist."})
        return {"id": hall, "kind": "hall", "custom": {"uHeight": 42, "depthMm": 1200, "weightLimitKg": 1500}}, requested, None
    slot = requested if requested.startswith("slot-") else "slot-" + requested
    location = db.db().execute("SELECT * FROM location WHERE id = ?", (slot,)).fetchone()
    if not location or location["kind"] != "rack":
        return None, None, (400, {"error": "Drop rack gear onto a rack."})
    return db.row_location(location), slot, None


def occupied(model, location, host):
    items = []
    for asset in db.assets():
        same_slot = asset["locationId"] == location["id"] and not host.startswith("plan-")
        same_plan = host.startswith("plan-") and asset["custom"].get("host") == host
        if not same_slot and not same_plan:
            continue
        linked = db.model_by_id(asset["modelId"]) or {}
        items.append({
            "uPosition": asset["uPosition"],
            "uHeight": linked.get("uHeight") or 0,
            "weightKg": linked.get("weightKg") or 0,
        })
    return items


def place_model(headers, body):
    who, denied = require_writer(headers)
    if denied:
        return denied
    model = db.model_by_id(body.get("modelId") or "")
    if not model:
        return 404, {"error": "Model not found."}
    if not model.get("place"):
        return 400, {"error": "This model is not placed from the library."}
    location, host, err = resolve_rack(model, body)
    if err:
        return err
    rack = {
        "uHeight": int(location["custom"].get("uHeight") or 42),
        "depthMm": int(location["custom"].get("depthMm") or 1200),
        "weightLimitKg": float(location["custom"].get("weightLimitKg") or 1500),
    }
    ok, u_position, reason = check_fit(model, occupied(model, location, host), rack)
    if not ok:
        return 409, {"error": reason}
    asset_id = "asset-" + model["id"] + "-" + str(db.db().execute("SELECT COUNT(*) AS n FROM asset").fetchone()["n"] + 1)
    custom = {"floor": "placed", "host": host, "x": body.get("x") or 0, "y": body.get("y") or 0, "place": model["place"]}
    db.db().execute(
        """INSERT INTO asset (
            id, asset_tag, serial, model_id, tenant_id, lifecycle, installed_on, warranty_end,
            location_id, u_position, face, width, custom_json
        ) VALUES (?, ?, ?, ?, 'unubtanium', 'Planned', NULL, NULL, ?, ?, 'front', 'full', ?)""",
        (asset_id, body.get("assetTag") or model["model"], "SN-" + asset_id, model["id"], location["id"], u_position, json.dumps(custom)),
    )
    created = db.asset_by_id(asset_id)
    user, role = who
    detail = model["model"] + " placed"
    if u_position:
        detail += " at U" + str(u_position)
    db.audit(user, role, "asset create", asset_id, None, created, detail)
    db.db().commit()
    return 201, {"asset": created, "model": db.model_by_id(model["id"]), "uPosition": u_position}


def move_mounted(headers, body):
    who, denied = require_writer(headers)
    if denied:
        return denied
    asset = db.asset_by_id(body.get("assetId") or "")
    if not asset:
        return 404, {"error": "Asset not found."}
    model = db.model_by_id(asset["modelId"]) or {}
    slot = slot_of(body.get("rackId") or "")
    row = db.db().execute("SELECT * FROM location WHERE id = ?", (slot,)).fetchone()
    if not row or row["kind"] != "rack":
        return 400, {"error": "Drop the device onto a rack."}
    location = db.row_location(row)
    face = body.get("face") or asset.get("face") or "front"
    if face not in ("front", "rear"):
        return 400, {"error": "Face must be front or rear."}
    height = int(model.get("uHeight") or 0)
    custom = dict(asset.get("custom") or {})
    side = body.get("side") or custom.get("side") or ""
    u_position = asset.get("uPosition")
    if height:
        if body.get("uPosition") in (None, ""):
            return 400, {"error": "Choose a U position."}
        u_position = int(body.get("uPosition"))
    else:
        u_position = None
        if body.get("side"):
            side = body.get("side")
    draft = dict(asset)
    draft["uPosition"] = u_position
    draft["face"] = face
    draft["custom"] = dict(custom)
    draft["custom"]["side"] = side
    candidate = shape(draft, model)
    models = {item["id"]: item for item in db.models()}
    others = []
    for item in db.assets():
        if item["locationId"] != slot or item["id"] == asset["id"]:
            continue
        linked = models.get(item["modelId"]) or {}
        if linked.get("category") == "Cabinet":
            continue
        others.append(shape(item, linked))
    limits = location.get("custom") or {}
    reason = check_move(candidate, others, {
        "uHeight": int(limits.get("uHeight") or 42),
        "depthMm": int(limits.get("depthMm") or 1200),
        "weightLimitKg": float(limits.get("weightLimitKg") or 1500),
    })
    if reason:
        return 409, {"error": reason}
    code = rack_code(location)
    custom["rackId"] = code
    if side:
        custom["side"] = side
    db.db().execute(
        "UPDATE asset SET location_id = ?, u_position = ?, face = ?, custom_json = ? WHERE id = ?",
        (slot, u_position, face, json.dumps(custom), asset["id"]),
    )
    saved = db.asset_by_id(asset["id"])
    user, role = who
    where = code + (" U" + str(u_position) if u_position else " rail")
    db.audit(user, role, "asset move", asset["id"], asset, saved, saved["assetTag"] + " moved to " + where + " " + face)
    db.db().commit()
    return 201, {"asset": saved, "elevation": elevation_payload(code)}


def power_node(node_id):
    found = power_lookup(db.db(), node_id)
    if not found:
        return 404, {"error": "No power path for that device."}
    return 200, found


def power_fail(body):
    node_id = (body or {}).get("nodeId") or ""
    measured = body.get("measured") if isinstance(body.get("measured"), dict) else {}
    factors = body.get("factors") if isinstance(body.get("factors"), dict) else {}
    report = power_failure(db.db(), node_id, (body or {}).get("mode") or "nameplate", measured, factors)
    if report is None:
        return 404, {"error": "That power node is not in the chain."}
    from server.dcim import note_failure
    alarm_id = note_failure(db.db(), node_id, report)
    if alarm_id:
        report["alarmId"] = alarm_id
        db.audit("system", "Administrator", "power alarm", node_id, None, {"alarmId": alarm_id}, node_id + " failure")
    db.db().commit()
    return 200, report


def dispatch(method, path, headers, raw):
    with db.LOCK:
        return respond(method, path, headers, raw)


def respond(method, path, headers, raw):
    if path.startswith("/DCIAC/"):
        path = path[len("/DCIAC"):] or "/"
    if not path.startswith("/api/"):
        return None
    headers = {str(k).lower(): v for k, v in (headers or {}).items()}
    body = {}
    if raw:
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return 400, {"error": "Body must be JSON."}
    if method == "GET" and path == "/api/v1/world":
        from server.dcim import scope_world
        return 200, scope_world(db.world(), headers.get("x-dciac-tenant") or "")
    if method == "GET" and path == "/api/v1/assets":
        return 200, {"assets": db.assets()}
    if method == "GET" and path == "/api/v1/locations":
        return 200, {"locations": db.locations()}
    if method == "GET" and path == "/api/v1/models":
        return 200, {"models": db.models()}
    if method == "POST" and path == "/api/v1/models":
        return create_model(headers, body)
    if method == "POST" and path == "/api/v1/models/import":
        return import_models(headers, body)
    if method == "POST" and path.startswith("/api/v1/models/") and path.endswith("/clone"):
        return clone_model(headers, path[len("/api/v1/models/"):-len("/clone")])
    if method == "PATCH" and path.startswith("/api/v1/models/"):
        return patch_model(headers, path[len("/api/v1/models/"):], body)
    if method == "POST" and path == "/api/v1/placements":
        return place_model(headers, body)
    if method == "GET" and path.startswith("/api/v1/racks/") and path.endswith("/elevation"):
        rack_id = path[len("/api/v1/racks/"):-len("/elevation")].strip("/")
        found = elevation_payload(rack_id)
        if not found:
            return 404, {"error": "Rack not found."}
        return 200, found
    if method == "POST" and path == "/api/v1/moves":
        return move_mounted(headers, body)
    if method == "GET" and path.startswith("/api/v1/power/nodes/"):
        return power_node(path[len("/api/v1/power/nodes/"):])
    if method == "POST" and path == "/api/v1/power/fail":
        return power_fail(body)
    if method == "GET" and path == "/api/v1/audit":
        return 200, {"audit": db.audit_log()}
    if method == "POST" and path == "/api/v1/assets":
        return create_asset(headers, body)
    if method == "PATCH" and path.startswith("/api/v1/assets/"):
        return patch_asset(headers, path[len("/api/v1/assets/"):], body)
    from server.dcim import handle
    user, role = identity(headers)
    found = handle(method, path, headers, body, user, role)
    if found:
        return found
    return 404, {"error": "No such API route."}
