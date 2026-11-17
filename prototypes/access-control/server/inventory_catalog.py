"""Devices from the AI data center inventory sheet. They are stock, not installed load."""

import csv
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SHEET = os.path.join(HERE, "inventory.csv")

MAKERS = (
    "Johnson Controls", "Palo Alto", "VAST Data", "Supermicro", "Opengear", "Microchip",
    "Caterpillar", "Schneider", "Meinberg", "CoolIT", "Motivair", "NVIDIA", "Hanwha",
    "Starline", "Raritan", "Siemens", "Thales", "NetApp", "Juniper", "Arista", "Cisco",
    "Vertiv", "Eaton", "Cummins", "Trane", "Axis", "Dell", "HPE", "DDN", "WEKA", "OCP", "Pure",
)


def slug(text):
    chars = []
    for ch in text.lower():
        if ch.isalnum():
            chars.append(ch)
        elif chars and chars[-1] != "-":
            chars.append("-")
    return "".join(chars).strip("-")[:52]


def split_product(text):
    cleaned = text.strip()
    for maker in MAKERS:
        if cleaned.lower().startswith(maker.lower()):
            rest = cleaned[len(maker):].strip(" /-")
            return maker, rest or maker
    return "", cleaned


def products(cell, device):
    found = []
    maker = ""
    used = set()
    for part in [item.strip() for item in cell.split(",") if item.strip()]:
        brand, model = split_product(part)
        if not brand:
            brand = maker or "Various"
        else:
            maker = brand
        label = model if model and model.casefold() != brand.casefold() else device
        if label.casefold() in used:
            label = brand + " " + device
        used.add(label.casefold())
        found.append((brand, label))
    return found


def watts_of(text):
    raw = (text or "").strip()
    folded = raw.lower()
    if not raw or raw in ("N/A", "Varies", "Low"):
        return 0, 0
    if folded.startswith("distributes") or "mw scale" in folded or "hundreds" in folded or "100s" in folded or "removes" in folded:
        return 0, 0
    nums = [float(item) for item in re.findall(r"\d+(?:\.\d+)?", raw)]
    if not nums:
        return 0, 0
    scale = 1000 if "kw" in folded else 1
    low, high = min(nums), max(nums)
    return int(round(high * scale)), int(round(low * scale))


def place_of(size):
    text = (size or "").strip()
    folded = text.lower()
    if "pcie" in folded or "pluggable" in folded:
        return 0, ""
    if folded.startswith("full"):
        return 0, "floor"
    if folded == "outdoor":
        return 0, "yard"
    if "rack door" in folded or "sensor" in folded:
        return 0, "rack"
    if "overhead" in folded or "aisle" in folded or "ceiling" in folded or "wall" in folded or "panel" in folded or "in-row" in folded or "floor" in folded:
        return 0, "floor"
    if folded == "shelf":
        return 2, "rack"
    if "42" in text:
        return 42, "floor"
    nums = [int(float(item)) for item in re.findall(r"\d+", text)]
    if not nums:
        return 0, "floor"
    if text.upper().startswith("0U"):
        return 0, "rack"
    return max(nums), "rack"


def redfish_of(category):
    if category == "Compute":
        return "ComputerSystem"
    if category == "Storage":
        return "Storage"
    if category == "Network":
        return "ComputerSystem"
    if category == "Power":
        return "PowerDistribution"
    if category == "Cooling":
        return "CoolingUnit"
    return ""


def depth_of(place, units):
    if place == "yard":
        return 2400
    if place == "floor":
        return 1200
    if place == "rack" and units:
        return 800
    return 0


def load_sheet(path=None):
    """Model rows: id, manufacturer, model, category, u, depth, weight, nameplate, typical, derated, voltage, plug, power ports, power type, redundancy, net ports, speed, media, place, redfish, note."""
    rows = []
    seen = set()
    with open(path or SHEET, newline="", encoding="utf-8") as handle:
        for raw in csv.DictReader(handle):
            record = {(key or "").lstrip("\ufeff").strip(): value for key, value in raw.items()}
            category = (record.get("Category") or "").strip()
            device = (record.get("Device Type") or "").strip()
            role = (record.get("Role in AI Data Center") or "").strip()
            mgmt = (record.get("Mgmt Interface") or "").strip()
            note_extra = (record.get("Notes") or "").strip()
            units, place = place_of(record.get("Typical Size") or "")
            nameplate, typical = watts_of(record.get("Typical Power (approx.)") or "")
            voltage = "48 V" if "48v" in device.lower() or "48V" in device else ("230 V" if place == "rack" and nameplate else "—")
            note = " ".join(part for part in (device + ".", role, mgmt and ("Management: " + mgmt), note_extra, (record.get("Typical Power (approx.)") or "").strip()) if part)
            for manufacturer, model in products(record.get("Example Models") or device, device):
                key = (manufacturer.casefold(), model.casefold())
                if key in seen:
                    continue
                seen.add(key)
                rows.append((
                    "inv-" + slug(manufacturer + "-" + model),
                    manufacturer,
                    model,
                    category or device,
                    units,
                    depth_of(place, units),
                    0,
                    nameplate,
                    typical,
                    nameplate,
                    voltage,
                    "",
                    2 if place == "rack" and units else 0,
                    "",
                    "",
                    0,
                    "",
                    "",
                    place,
                    redfish_of(category),
                    note[:400],
                ))
    return rows
