"""Power-chain roll-up and single-node failure.

Edges point from upstream to downstream. A load splits across its live upstream
edges. A source that cannot be reached carries nothing.
"""


def demand_of(node, mode, measured, factors):
    if node.get("role") != "load":
        return 0
    if mode == "measured" and factors and node.get("deviceId") in factors:
        return float(node.get("nameplateW") or 0) * float(factors[node["deviceId"]])
    if mode == "measured" and node["id"] in (measured or {}):
        return float(measured[node["id"]])
    if mode in ("derated", "measured"):
        return float(node.get("deratedW") or node.get("nameplateW") or 0)
    return float(node.get("nameplateW") or 0)


def index_edges(edges):
    by_up = {}
    by_down = {}
    for edge in edges:
        by_up.setdefault(edge["downstreamId"], []).append(edge)
        by_down.setdefault(edge["upstreamId"], []).append(edge)
    return by_up, by_down


def reaches_source(nodes, by_up, failed):
    memo = {}

    def walk(node_id, seen):
        if node_id in failed or node_id not in nodes:
            return False
        if node_id in memo:
            return memo[node_id]
        if node_id in seen:
            return False
        if nodes[node_id].get("role") == "source":
            memo[node_id] = True
            return True
        seen.add(node_id)
        ok = False
        for edge in by_up.get(node_id, []):
            if walk(edge["upstreamId"], seen):
                ok = True
                break
        seen.discard(node_id)
        memo[node_id] = ok
        return ok

    return {node_id: walk(node_id, set()) for node_id in nodes}


def analyze(nodes, edges, failed_id="", mode="nameplate", measured=None, factors=None):
    by_id = {node["id"]: node for node in nodes}
    failed = {failed_id} if failed_id else set()
    by_up, by_down = index_edges(edges)
    live = reaches_source(by_id, by_up, failed)
    memo = {}

    def flow(node_id):
        if node_id in memo:
            return memo[node_id]
        if not live.get(node_id):
            memo[node_id] = 0
            return 0
        total = demand_of(by_id[node_id], mode, measured, factors)
        for edge in by_down.get(node_id, []):
            child = edge["downstreamId"]
            ups = [item for item in by_up.get(child, []) if live.get(item["upstreamId"])]
            if not any(item["id"] == edge["id"] for item in ups):
                continue
            total += flow(child) / len(ups)
        memo[node_id] = total
        return total

    lost = []
    over = []
    carried = {}
    for node in nodes:
        watts = flow(node["id"])
        carried[node["id"]] = watts
        if node.get("role") == "load" and demand_of(node, mode, measured, factors) > 0 and not live.get(node["id"]):
            lost.append({"id": node["id"], "name": node["name"], "deviceId": node.get("deviceId") or "", "rackId": node.get("rackId") or ""})
        cap = float(node.get("capacityW") or 0)
        if node.get("role") == "load" or cap <= 0 or not live.get(node["id"]):
            continue
        percent = 100.0 * watts / cap
        # A tap sized to its device sits at its rating. That is the design load, not an overload.
        if node.get("kind") == "outlet" and percent <= 100:
            continue
        if percent >= 80:
            over.append({
                "id": node["id"],
                "name": node["name"],
                "kind": node.get("kind") or "",
                "carriedW": round(watts, 1),
                "capacityW": cap,
                "percent": round(percent, 1),
                "level": "critical" if percent >= 100 else "warning",
            })
    over.sort(key=lambda item: -item["percent"])
    lost.sort(key=lambda item: item["name"])
    return {"mode": mode, "failed": failed_id, "lost": lost, "over": over, "carried": carried}


def upward(start, nodes, edges, side):
    by_id = {node["id"]: node for node in nodes}
    by_up, _by_down = index_edges(edges)
    chain = []
    current = start
    seen = set()
    while current and current not in seen and current in by_id:
        seen.add(current)
        chain.append(current)
        ups = by_up.get(current, [])
        if not ups:
            break
        exact = [edge for edge in ups if by_id.get(edge["upstreamId"], {}).get("side") == side]
        either = [edge for edge in ups if by_id.get(edge["upstreamId"], {}).get("side") in (side, "both")]
        current = (exact or either or ups)[0]["upstreamId"]
    chain.reverse()
    hops = []
    for index, node_id in enumerate(chain):
        edge = None
        if index:
            for item in edges:
                if item["upstreamId"] == chain[index - 1] and item["downstreamId"] == node_id:
                    edge = item
                    break
        hops.append({"node": by_id[node_id], "edge": edge})
    return hops
