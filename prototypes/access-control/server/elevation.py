"""Rack elevation: U collision and the space, weight, power, and port budget."""

from server.fit import free_blocks, occupied_map

IT = {"Server", "Switch", "Storage", "GPU tray"}


def ranges_hit(a, b):
    if not a.get("uHeight") or not b.get("uHeight"):
        return False
    if not a.get("uPosition") or not b.get("uPosition"):
        return False
    return a["uPosition"] < b["uPosition"] + b["uHeight"] and b["uPosition"] < a["uPosition"] + a["uHeight"]


def blocks(a, b):
    if (a.get("face") or "front") != (b.get("face") or "front"):
        return False
    if not ranges_hit(a, b):
        return False
    if a.get("width") == "half" and b.get("width") == "half" and a.get("side") and b.get("side") and a["side"] != b["side"]:
        return False
    return True


def collision(candidate, others):
    for other in others:
        if other.get("id") == candidate.get("id"):
            continue
        if blocks(candidate, other):
            return other
    return None


def budget(mounts, rack):
    units = int(rack["uHeight"])
    spans = [(item["uPosition"], item["uHeight"]) for item in mounts if item.get("uPosition") and item.get("uHeight")]
    taken = occupied_map(spans, units)
    used = sum(1 for u in range(1, units + 1) if taken[u])
    blocks_free = free_blocks(spans, units)
    it = [item for item in mounts if item.get("category") in IT]
    switches = [item for item in it if item.get("category") == "Switch"]
    others = [item for item in it if item.get("category") != "Switch"]
    pdus = [item for item in mounts if item.get("category") == "PDU"]
    power_total = sum(int(item.get("powerPorts") or 0) for item in pdus)
    power_used = sum(int(item.get("powerPorts") or 0) for item in it)
    net_total = sum(int(item.get("netPorts") or 0) for item in switches)
    net_used = sum(int(item.get("netPorts") or 0) for item in others)
    return {
        "uHeight": units,
        "usedU": used,
        "freeU": units - used,
        "largestFreeU": max((length for _start, length in blocks_free), default=0),
        "weightKg": round(sum(float(item.get("weightKg") or 0) for item in mounts), 1),
        "weightLimitKg": float(rack["weightLimitKg"]),
        "budgetW": int(rack.get("budgetW") or 0),
        "nameplateW": sum(int(item.get("nameplateW") or 0) for item in it),
        "typicalW": sum(int(item.get("typicalW") or 0) for item in it),
        "deratedW": sum(int(item.get("deratedW") or 0) for item in it),
        "powerPortsUsed": power_used,
        "powerPortsTotal": power_total,
        "powerPortsFree": max(0, power_total - power_used),
        "netPortsUsed": net_used,
        "netPortsTotal": net_total,
        "netPortsFree": max(0, net_total - net_used),
    }


def check_move(candidate, others, rack):
    if candidate.get("category") == "Cabinet":
        return "The rack enclosure stays where it is."
    height = int(candidate.get("uHeight") or 0)
    if height:
        u = candidate.get("uPosition")
        if not u:
            return "Choose a U position."
        u = int(u)
        if u < 1 or u + height - 1 > int(rack["uHeight"]):
            return candidate["model"] + " needs " + str(height) + "U and does not fit at U" + str(u) + "."
        hit = collision(candidate, others)
        if hit:
            return "Overlaps " + hit["assetTag"] + " at U" + str(hit["uPosition"]) + "."
    depth = int(candidate.get("depthMm") or 0)
    if depth and depth > int(rack["depthMm"]):
        return "Depth " + str(depth) + " mm exceeds the rack depth of " + str(rack["depthMm"]) + " mm."
    weight = sum(float(item.get("weightKg") or 0) for item in others if item.get("id") != candidate.get("id"))
    weight += float(candidate.get("weightKg") or 0)
    if weight > float(rack["weightLimitKg"]):
        return "Weight " + format(weight, ".0f") + " kg exceeds the rack limit of " + format(float(rack["weightLimitKg"]), ".0f") + " kg."
    return ""


def slot_of(rack_id):
    text = str(rack_id or "").strip()
    if text.startswith("slot-"):
        return text
    return "slot-" + text


def rack_code(location):
    name = location.get("name") or ""
    if name.startswith("Rack "):
        return name[5:]
    return location["id"].replace("slot-", "")


def shape(asset, model):
    custom = asset.get("custom") or {}
    return {
        "id": asset["id"],
        "assetTag": asset.get("assetTag") or "",
        "serial": asset.get("serial") or "",
        "modelId": asset.get("modelId") or "",
        "model": model.get("model") or "",
        "manufacturer": model.get("manufacturer") or "",
        "category": model.get("category") or "",
        "lifecycle": asset.get("lifecycle") or "",
        "uPosition": asset.get("uPosition"),
        "uHeight": int(model.get("uHeight") or 0),
        "face": asset.get("face") or "front",
        "width": asset.get("width") or "full",
        "side": custom.get("side") or "",
        "weightKg": float(model.get("weightKg") or 0),
        "nameplateW": int(model.get("nameplateW") or 0),
        "typicalW": int(model.get("typicalW") or 0),
        "deratedW": int(model.get("deratedW") or 0),
        "powerPorts": int(model.get("powerPorts") or 0),
        "netPorts": int(model.get("netPorts") or 0),
        "depthMm": int(model.get("depthMm") or 0),
    }


def payload(rack_id):
    from server import db
    locs = {item["id"]: item for item in db.locations()}
    slot = slot_of(rack_id)
    location = locs.get(slot)
    if not location or location["kind"] != "rack":
        return None
    models = {item["id"]: item for item in db.models()}
    here = [asset for asset in db.assets() if asset["locationId"] == slot]
    budget_w = 0
    mounts = []
    for asset in here:
        model = models.get(asset["modelId"]) or {}
        if model.get("category") == "Cabinet":
            budget_w = int(model.get("nameplateW") or budget_w)
            continue
        mounts.append(shape(asset, model))
    mounts.sort(key=lambda item: (-(item["uPosition"] or 0), item["assetTag"]))
    row = locs.get(location.get("parentId") or "")
    hall = row.get("parentId") if row else ""
    row_ids = {item["id"] for item in locs.values() if item.get("parentId") == hall and item.get("kind") == "row"}
    siblings = []
    for item in locs.values():
        if item.get("kind") == "rack" and item.get("parentId") in row_ids:
            siblings.append({"id": item["id"], "rackId": rack_code(item), "name": item["name"]})
    siblings.sort(key=lambda item: item["rackId"])
    custom = location.get("custom") or {}
    rack = {
        "uHeight": int(custom.get("uHeight") or 42),
        "depthMm": int(custom.get("depthMm") or 1200),
        "weightLimitKg": float(custom.get("weightLimitKg") or 1500),
        "budgetW": budget_w,
    }
    return {
        "rackId": rack_code(location),
        "locationId": slot,
        "name": location["name"],
        "hallId": hall,
        "rack": rack,
        "mounts": mounts,
        "budget": budget(mounts, rack),
        "siblings": siblings,
    }
