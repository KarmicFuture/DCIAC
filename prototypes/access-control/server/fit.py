"""Rack fit: contiguous U, depth, and weight. Pure functions for the placement API."""


def occupied_map(spans, rack_u):
    taken = [False] * (rack_u + 1)
    for start, units in spans:
        if not start or not units:
            continue
        for u in range(int(start), int(start) + int(units)):
            if 1 <= u <= rack_u:
                taken[u] = True
    return taken


def free_blocks(spans, rack_u):
    taken = occupied_map(spans, rack_u)
    blocks = []
    run = 0
    run_start = 1
    for u in range(1, rack_u + 1):
        if not taken[u]:
            if run == 0:
                run_start = u
            run += 1
        elif run:
            blocks.append((run_start, run))
            run = 0
    if run:
        blocks.append((run_start, run))
    return blocks


def first_fit(units, spans, rack_u):
    if units <= 0:
        return None
    for start, length in free_blocks(spans, rack_u):
        if length >= units:
            return start
    return None


def check_fit(model, occupied, rack):
    """occupied items are dicts with uPosition, uHeight, weightKg. rack has uHeight, depthMm, weightLimitKg."""
    if (model.get("place") or "") != "rack":
        return True, None, ""
    units = int(model.get("uHeight") or 0)
    spans = [(item.get("uPosition"), item.get("uHeight") or 0) for item in occupied if item.get("uPosition")]
    start = None
    if units:
        start = first_fit(units, spans, int(rack["uHeight"]))
        if start is None:
            return False, None, model["model"] + " needs " + str(units) + "U contiguous. This rack has no free block that tall."
    weight = sum(float(item.get("weightKg") or 0) for item in occupied) + float(model.get("weightKg") or 0)
    limit = float(rack["weightLimitKg"])
    if weight > limit:
        return False, None, "Weight " + format(weight, ".0f") + " kg exceeds the rack limit of " + format(limit, ".0f") + " kg."
    depth = int(model.get("depthMm") or 0)
    if depth and depth > int(rack["depthMm"]):
        return False, None, "Depth " + str(depth) + " mm exceeds the rack depth of " + str(rack["depthMm"]) + " mm."
    return True, start, ""
