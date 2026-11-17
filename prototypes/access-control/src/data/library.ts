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

const BOX = {
  "vertiv-rack": [56, 48, 124],
  "vertiv-busbar": [220, 14, 96],
  "vertiv-hac": [220, 40, 72],
  "vertiv-powermod": [120, 78, 64],
  "vertiv-heat": [180, 70, 48],
  "vertiv-shelf": [68, 36, 44],
  "vertiv-ups": [88, 64, 118],
  "vertiv-crac": [96, 58, 110],
  "vertiv-pdu": [18, 14, 90],
  "hp-dl380": [48, 28, 16],
  "hp-dl360": [48, 26, 10],
  "hp-cx8325": [48, 22, 10],
  "dell-r760": [50, 30, 16],
  "dell-r660": [50, 28, 10],
  "dell-s5248": [48, 20, 10],
  "ibm-s1022": [50, 30, 18],
  "ibm-fs5300": [50, 32, 10],
  "ibm-rack": [56, 46, 124],
};

export const LIBRARY = [];
export const MODELS = [];

export function voltsOf(text) {
  const match = String(text || "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

export function ampsOf(watts, voltage) {
  const volts = voltsOf(voltage);
  if (!watts || !volts || volts > 1000) return 0;
  return Math.round((watts / volts) * 10) / 10;
}

function boxFor(model) {
  if (BOX[model.id]) return BOX[model.id];
  if (model.place === "yard") return [120, 78, 64];
  if (model.place === "floor") return [88, 64, 110];
  if ((model.uHeight || 0) <= 1) return [48, 26, 10];
  return [48, 28, 16];
}

export function modelToSpec(model) {
  const watts = model.nameplateW || 0;
  const volts = model.inputVoltage || "—";
  const units = model.uHeight || 0;
  const depth = model.depthMm || 600;
  const item = spec(
    model.id, model.manufacturer, model.model, model.category, model.place || "",
    units, watts, ampsOf(watts, volts), volts, model.powerPorts || 0, model.netPorts || 0,
    [600, depth, units ? units * 44 : 200], boxFor(model), model.note || "",
  );
  item.usedBy = model.usedBy || 0;
  item.weightKg = model.weightKg || 0;
  return item;
}

export function applyModels(models) {
  MODELS.splice(0, MODELS.length, ...(models || []));
  const placeable = MODELS
    .filter((model) => model.place === "yard" || model.place === "floor" || model.place === "rack")
    .map(modelToSpec);
  LIBRARY.splice(0, LIBRARY.length, ...placeable);
}
