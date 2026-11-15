"""Device-library models. Place is yard, floor, or rack. Plant models stay out of the drag list."""

# id, manufacturer, model, category, u, depth_mm, weight_kg, nameplate_w, typical_w, derated_w,
# voltage, plug, power_ports, power_type, redundancy, net_ports, net_speed, net_media, place, redfish, note
LIBRARY = [
    ("vertiv-rack", "Unubtanium 2.0", "VR Rack 42U", "Enclosure", 42, 1200, 180, 0, 0, 0, "415 V", "IEC 60309", 2, "feed", "2N", 0, "", "", "floor", "Chassis", "Two power feeds into an empty 42U enclosure."),
    ("vertiv-busbar", "Unubtanium 2.0", "PowerBar busway", "Busway", 0, 180, 40, 0, 0, 0, "415 V", "bus", 0, "", "2N", 0, "", "", "floor", "PowerDistribution", "Overhead track busway. Runs above the hot aisle."),
    ("vertiv-hac", "Unubtanium 2.0", "Hot aisle containment", "Containment", 0, 1200, 25, 0, 0, 0, "—", "", 0, "", "", 0, "", "", "floor", "", "Hood over the hot aisle. Cold aisles stay open."),
    ("vertiv-powermod", "Unubtanium 2.0", "Power module", "PowerModule", 0, 2200, 2500, 1500000, 900000, 1200000, "MV", "bus", 4, "breaker", "N+1", 2, "1G", "copper", "yard", "PowerDistribution", "Sits outside the building, with the transformer and battery skid."),
    ("vertiv-heat", "Unubtanium 2.0", "Heat rejection", "Heat rejection", 0, 2400, 1800, 40000, 24000, 32000, "480 V", "IEC 60309", 2, "feed", "N+1", 1, "1G", "copper", "yard", "CoolingUnit", "Chiller or dry cooler in the yard."),
    ("vertiv-shelf", "Unubtanium 2.0", "DC power shelf", "PowerShelf", 2, 750, 28, 80000, 48000, 64000, "50 VDC", "bus", 4, "bus", "N+1", 2, "1G", "copper", "rack", "PowerDistribution", "50 V DC shelf for the rack. ORv3-style."),
    ("vertiv-ups", "Unubtanium 2.0", "Liebert EXL UPS", "UPS", 0, 900, 700, 500000, 250000, 400000, "415 V", "bus", 4, "breaker", "N+1", 2, "1G", "copper", "floor", "PowerDistribution", "Floor UPS. Four output breakers and a network card."),
    ("vertiv-crac", "Unubtanium 2.0", "Liebert DSE CRAC", "CRAC", 0, 900, 450, 18000, 9000, 14000, "480 V", "IEC 60309", 1, "feed", "N", 1, "1G", "copper", "floor", "CoolingUnit", "150 kW cooling capacity. Faceplate power is the fan and control load."),
    ("vertiv-pdu", "Unubtanium 2.0", "Geist rPDU", "PDU", 0, 80, 8, 0, 0, 0, "230 V", "IEC 60309", 24, "C13", "N+1", 2, "1G", "copper", "rack", "PowerDistribution", "Zero-U monitored PDU. 24 power outlets, 2 network ports."),
    ("hp-dl380", "HP", "ProLiant DL380", "Server", 2, 750, 25, 800, 450, 640, "230 V", "C14", 2, "C14", "N+1", 4, "25G", "SFP", "rack", "ComputerSystem", "2U rack server. Two power supplies and four network ports."),
    ("hp-dl360", "HP", "ProLiant DL360", "Server", 1, 750, 16, 500, 280, 400, "230 V", "C14", 2, "C14", "N+1", 4, "25G", "SFP", "rack", "ComputerSystem", "1U rack server."),
    ("hp-cx8325", "HP", "Aruba CX 8325", "Switch", 1, 510, 10, 400, 220, 320, "230 V", "C14", 2, "C14", "N+1", 48, "100G", "QSFP", "rack", "ComputerSystem", "1U switch. Two power supplies and 48 network ports."),
    ("dell-r760", "Dell", "PowerEdge R760", "Server", 2, 800, 28, 900, 500, 720, "230 V", "C14", 2, "C14", "N+1", 4, "25G", "SFP", "rack", "ComputerSystem", "2U rack server."),
    ("dell-r660", "Dell", "PowerEdge R660", "Server", 1, 780, 18, 700, 380, 560, "230 V", "C14", 2, "C14", "N+1", 4, "25G", "SFP", "rack", "ComputerSystem", "1U rack server."),
    ("dell-s5248", "Dell", "PowerSwitch S5248", "Switch", 1, 460, 9, 350, 180, 280, "230 V", "C14", 2, "C14", "N+1", 48, "25G", "SFP", "rack", "ComputerSystem", "1U switch."),
    ("ibm-s1022", "IBM", "Power S1022", "Server", 2, 770, 32, 1400, 800, 1100, "230 V", "C14", 2, "C14", "N+1", 4, "25G", "SFP", "rack", "ComputerSystem", "2U Power server."),
    ("ibm-fs5300", "IBM", "FlashSystem 5300", "Storage", 1, 850, 22, 800, 450, 640, "230 V", "C14", 2, "C14", "N+1", 8, "32G", "fibre", "rack", "Storage", "1U storage. Two power supplies and eight network ports."),
    ("ibm-rack", "IBM", "Enterprise Rack 42U", "Enclosure", 42, 1092, 170, 0, 0, 0, "415 V", "IEC 60309", 2, "feed", "2N", 0, "", "", "floor", "Chassis", "Empty 42U enclosure with two power feeds."),
    ("gpu-tray", "Unubtanium", "GPU tray", "GPU tray", 2, 800, 35, 12000, 8000, 10000, "50 VDC", "bus", 1, "bus", "N", 1, "100G", "QSFP", "", "ComputerSystem", "Installed GPU tray. Telemetry stays in the Lab."),
    ("sn2201", "Unubtanium", "SN2201", "Switch", 1, 500, 8, 400, 200, 300, "50 VDC", "bus", 2, "bus", "N+1", 16, "100G", "QSFP", "", "ComputerSystem", "Rack A14 switch."),
]

COLUMNS = (
    "id", "manufacturer", "model", "category", "u_height", "depth_mm", "weight_kg", "nameplate_w",
    "typical_w", "derated_w", "input_voltage", "plug_type", "power_ports", "power_port_type",
    "power_redundancy", "net_ports", "net_speed", "net_media", "place", "redfish_type", "note",
)

A14_GEAR = [
    ("dev-tray-01", "tray-01", "gpu-tray", 40, 2),
    ("dev-tray-02", "tray-02", "gpu-tray", 38, 2),
    ("dev-tray-03", "tray-03", "gpu-tray", 36, 2),
    ("dev-tray-04", "tray-04", "gpu-tray", 34, 2),
    ("dev-tray-05", "tray-05", "gpu-tray", 32, 2),
    ("dev-tray-06", "tray-06", "gpu-tray", 30, 2),
    ("dev-tray-07", "tray-07", "gpu-tray", 28, 2),
    ("dev-tray-08", "tray-08", "gpu-tray", 26, 2),
    ("dev-sn2201", "sn2201", "sn2201", 22, 1),
    ("dev-pshelf", "pshelf", "dc-shelf", 6, 4),
]
