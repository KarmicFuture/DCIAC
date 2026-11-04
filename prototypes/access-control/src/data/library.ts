import { PODS, rackEntities } from "./pods";
import { state } from "../state";

export function spec(id, maker, name, kind, place, u, watts, amps, volts, powerPorts, netPorts, mm, box, note) {
  return {
    id: id,
    maker: maker,
    name: name,
    kind: kind,
    place: place,
    u: u,
    uCapacity: place === "floor" && u ? u : 0,
    watts: watts,
    amps: amps,
    volts: volts,
    powerPorts: powerPorts,
    netPorts: netPorts,
    mm: mm,
    box: { w: box[0], d: box[1], h: box[2] },
    note: note,
    powerLabel: watts >= 1000 ? (watts / 1000).toFixed(watts >= 10000 ? 0 : 1) + " kW" : watts + " W",
    ampLabel: amps + " A",
  };
}

export function catalogById(id) {
  return LIBRARY.find((item) => item.id === id);
}

export function placementById(id) {
  return state.plan.placements.find((item) => item.id === id);
}

export function findRack(id) {
  let found = null;
  PODS.forEach((pod) => {
    pod.racks.forEach((rack) => {
      if (rack.id === id) found = rack;
    });
  });
  return found;
}

export function hostCapacity(hostId) {
  const placed = placementById(hostId);
  if (placed) return catalogById(placed.catalogId).uCapacity || 0;
  return findRack(hostId) ? 42 : 0;
}

export function usedU(hostId) {
  const rack = findRack(hostId);
  let used = 0;
  if (rack) {
    rackEntities(rack).forEach((entity) => {
      if (entity.kind === "Switch") used += 1;
      else if (entity.kind === "Power shelf") used += 4;
      else if (entity.kind !== "Cooling" && entity.kind !== "Busway") used += 2;
    });
  }
  state.plan.placements.forEach((item) => {
    if (item.place === "rack" && item.host === hostId) used += catalogById(item.catalogId).u || 0;
  });
  return used;
}

export function freeU(hostId) {
  return hostCapacity(hostId) - usedU(hostId);
}

export const LIBRARY = [
  spec("vertiv-rack", "Vertiv", "VR Rack 42U", "Enclosure", "floor", 42, 0, 0, "415 V", 2, 0, [600, 1200, 1998], [56, 48, 124], "Two power feeds into an empty 42U enclosure."),
  spec("vertiv-busbar", "Vertiv", "PowerBar busway", "Busway", "floor", 0, 0, 400, "415 V", 0, 0, [2400, 180, 220], [220, 14, 96], "Overhead track busway. Runs above the hot aisle."),
  spec("vertiv-hac", "Vertiv", "Hot aisle containment", "Containment", "floor", 0, 0, 0, "—", 0, 0, [2400, 1200, 2200], [220, 40, 72], "Hood over the hot aisle. Cold aisles stay open."),
  spec("vertiv-powermod", "Vertiv", "Power module", "Power module", "yard", 0, 1500000, 1800, "MV", 4, 2, [3000, 2200, 3200], [120, 78, 64], "Sits outside the building, with the transformer and battery skid."),
  spec("vertiv-heat", "Vertiv", "Heat rejection", "Heat rejection", "yard", 0, 40000, 80, "480 V", 2, 1, [6000, 2400, 2800], [180, 70, 48], "Chiller or dry cooler in the yard. Rejects the hall heat outside the shell."),
  spec("vertiv-shelf", "Vertiv", "DC power shelf", "Powershelf", "rack", 2, 80000, 1600, "50 VDC", 4, 2, [530, 750, 88], [68, 36, 44], "50 V DC shelf for the rack. ORv3-style, fed from the overhead bus bar."),
  spec("vertiv-ups", "Vertiv", "Liebert EXL UPS", "UPS", "floor", 0, 500000, 696, "415 V", 4, 2, [1400, 900, 2000], [88, 64, 118], "Floor UPS. Four output breakers and a network card."),
  spec("vertiv-crac", "Vertiv", "Liebert DSE CRAC", "Cooling", "floor", 0, 18000, 22, "480 V", 1, 1, [1800, 900, 2000], [96, 58, 110], "150 kW cooling capacity. Faceplate power is the fan and control load."),
  spec("vertiv-pdu", "Vertiv", "Geist rPDU", "PDU", "rack", 0, 0, 32, "230 V", 24, 2, [56, 80, 1730], [18, 14, 90], "Zero-U monitored PDU. 24 power outlets, 2 network ports. Rated current is the faceplate value."),
  spec("hp-dl380", "HP", "ProLiant DL380", "Server", "rack", 2, 800, 3.5, "230 V", 2, 4, [448, 750, 87], [48, 28, 16], "2U rack server. Two power supplies and four network ports."),
  spec("hp-dl360", "HP", "ProLiant DL360", "Server", "rack", 1, 500, 2.2, "230 V", 2, 4, [434, 750, 43], [48, 26, 10], "1U rack server."),
  spec("hp-cx8325", "HP", "Aruba CX 8325", "Switch", "rack", 1, 400, 1.8, "230 V", 2, 48, [442, 510, 44], [48, 22, 10], "1U switch. Two power supplies and 48 network ports."),
  spec("dell-r760", "Dell", "PowerEdge R760", "Server", "rack", 2, 900, 3.9, "230 V", 2, 4, [482, 800, 87], [50, 30, 16], "2U rack server."),
  spec("dell-r660", "Dell", "PowerEdge R660", "Server", "rack", 1, 700, 3.1, "230 V", 2, 4, [482, 780, 43], [50, 28, 10], "1U rack server."),
  spec("dell-s5248", "Dell", "PowerSwitch S5248", "Switch", "rack", 1, 350, 1.5, "230 V", 2, 48, [434, 460, 44], [48, 20, 10], "1U switch."),
  spec("ibm-s1022", "IBM", "Power S1022", "Server", "rack", 2, 1400, 6.1, "230 V", 2, 4, [482, 770, 87], [50, 30, 18], "2U Power server."),
  spec("ibm-fs5300", "IBM", "FlashSystem 5300", "Storage", "rack", 1, 800, 3.5, "230 V", 2, 8, [483, 850, 44], [50, 32, 10], "1U storage. Two power supplies and eight network ports."),
  spec("ibm-rack", "IBM", "Enterprise Rack 42U", "Enclosure", "floor", 42, 0, 0, "415 V", 2, 0, [605, 1092, 2015], [56, 46, 124], "Empty 42U enclosure with two power feeds."),
];
