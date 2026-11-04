import { deviceById } from "./devices";
import { clamp } from "../ui/format";

export function fillPod(podId, rackId, gpus) {
  const pod = PODS.find((p) => p.id === podId);
  const rack = pod.racks.find((r) => r.id === rackId);
  rack.servers = gpus.map((gpu, index) => {
    const id = podId + "-" + rackId + "-" + (index + 1);
    const entity: any = {
      id,
      name: rackId + " · GPU " + (index + 1),
      pod: podId,
      rack: rackId,
      kind: "GPU tray",
      managed: false,
      bmc: "up",
      load: {
        gpu,
        mem: Math.max(16, gpu - 6),
        power: Math.max(16, gpu - 8),
        temp: 52 + gpu * 0.2,
        drift: gpu >= 86 ? 0.12 : gpu >= 75 ? 0.05 : 0.02,
        failover: false,
      },
    };
    entity.seed = Object.assign({}, entity.load);
    neighbors.push(entity);
    return id;
  });
}

export function addInfra(id, name, kind, pod, power, temp, drift, yard?: boolean) {
  const entity: any = {
    id, name, kind, pod, yard: !!yard, managed: false, bmc: "up",
    load: { gpu: 0, mem: 0, power, temp, drift, failover: false },
  };
  entity.seed = Object.assign({}, entity.load);
  infra.push(entity);
}

export function isFacility(entity) {
  if (!entity) return false;
  return ["Cooling", "Busway", "Containment", "Aisle", "Powershelf", "Power module", "Heat rejection", "Core", "Grid", "Pipe"].indexOf(entity.kind) >= 0;
}

export function entityById(id) {
  return deviceById(id) || neighbors.find((n) => n.id === id) || infra.find((item) => item.id === id);
}

export function entityScore(entity) {
  if (!entity || !entity.load) return 0;
  if (isFacility(entity)) return entity.load.power;
  const load = entity.load;
  return load.gpu * 0.5 + load.mem * 0.2 + load.power * 0.2 + load.temp * 0.1;
}

export function heatBand(entity) {
  if (!entity) return "ok";
  if (entity.bmc === "down") return "failover";
  const score = entityScore(entity);
  if (score >= 90) return "critical";
  if (score >= 75) return "near";
  return "ok";
}

export function worstBand(list) {
  const order = ["ok", "near", "critical", "failover"];
  let best = 0;
  list.forEach((entity) => {
    const index = order.indexOf(heatBand(entity));
    if (index > best) best = index;
  });
  return order[best];
}

export function nudge(entity) {
  const load = entity.load;
  if (!load || entity.bmc === "down") return;
  const drift = load.drift || 0;
  const jitter = (Math.random() - 0.5) * 0.45;
  if (isFacility(entity)) {
    load.power = clamp(load.power + drift + jitter, 8, 98);
    load.temp = clamp(load.temp + drift * 0.08, 20, 80);
    return;
  }
  load.gpu = clamp(load.gpu + drift + jitter, 4, 98);
  load.mem = clamp(load.mem + drift * 0.55 + jitter * 0.3, 4, 98);
  load.power = clamp(load.power + drift * 0.7 + jitter * 0.25, 4, 98);
  load.temp = clamp(load.temp + drift * 0.12, 40, 96);
}

export function podById(id) {
  return PODS.find((pod) => pod.id === id);
}

export function rackById(pod, rackId) {
  return pod && pod.racks.find((rack) => rack.id === rackId);
}

export function rackEntities(rack) {
  return (rack.servers || []).map(entityById).filter(Boolean);
}

export function deviceRackId(id) {
  if (id === "sn2201") return "A14-net";
  if (id === "pshelf") return "A14-pwr";
  return "A14";
}

export const LOAD_SEED = {
  "tray-01": { gpu: 84, mem: 79, power: 81, temp: 74, drift: 0.28, failover: true },
  "tray-02": { gpu: 77, mem: 73, power: 75, temp: 70, drift: 0.05, failover: false },
  "tray-03": { gpu: 40, mem: 46, power: 38, temp: 57, drift: 0.02, failover: false, rdpDown: true },
  "tray-04": { gpu: 89, mem: 86, power: 88, temp: 80, drift: 0.2, failover: true },
  "tray-05": { gpu: 58, mem: 55, power: 52, temp: 62, drift: 0.03, failover: false },
  "tray-06": { gpu: 97, mem: 94, power: 96, temp: 90, drift: 0, failover: true, down: true },
  "tray-07": { gpu: 48, mem: 50, power: 44, temp: 59, drift: -0.02, failover: false, watchDeny: true },
  "tray-08": { gpu: 72, mem: 69, power: 70, temp: 66, drift: 0.11, failover: false },
  sn2201: { gpu: 20, mem: 38, power: 33, temp: 51, drift: 0.01, failover: false },
  pshelf: { gpu: 12, mem: 18, power: 61, temp: 48, drift: 0.03, failover: false },
};

export const neighbors = [];

export const infra = [];

export const PODS = [
  {
    id: "pod-a", name: "AI Pod A", letter: "A", x: -470, y: -310, w: 400, h: 214, managed: true,
    racks: [
      { id: "A13", name: "Rack A13", kind: "GPU", row: "row-a-n", x: 16, y: 34, w: 52, d: 44, h: 116, servers: [] },
      { id: "A14", name: "Rack A14", kind: "GPU", row: "row-a-n", x: 78, y: 34, w: 56, d: 44, h: 124, servers: ["tray-01", "tray-02", "tray-03", "tray-04", "tray-05", "tray-06", "tray-07", "tray-08"] },
      { id: "A15", name: "Rack A15", kind: "GPU", row: "row-a-s", x: 16, y: 128, w: 52, d: 44, h: 116, servers: [] },
      { id: "A14-net", name: "Network", kind: "Network", row: "row-a-s", x: 78, y: 130, w: 48, d: 40, h: 80, servers: ["sn2201"] },
      { id: "A14-pwr", name: "DC power shelf", kind: "Power", row: "row-a-s", x: 136, y: 132, w: 72, d: 36, h: 46, servers: ["pshelf"] },
    ],
    boxes: [
      { id: "cdu-a", x: 318, y: 86, w: 68, d: 36, h: 28 },
    ],
    fit: {
      aisles: [
        { id: "cold-a1", tone: "cold", label: "Cold aisle", x: 12, y: 6, w: 290, h: 22 },
        { id: "hot-a", tone: "hot", label: "Hot aisle", x: 12, y: 84, w: 280, h: 32 },
        { id: "cold-a2", tone: "cold", label: "Cold aisle", x: 12, y: 180, w: 290, h: 22 },
      ],
      rows: [
        { id: "row-a-n", name: "North row", y: 34, cold: "cold-a1", hot: "hot-a" },
        { id: "row-a-s", name: "South row", y: 128, cold: "cold-a2", hot: "hot-a" },
      ],
      containment: { id: "hac-a", x: 20, y: 86, w: 250, d: 28, h: 28 },
      busbar: { id: "bus-a", x: 16, y: 94, w: 260, d: 12, h: 8 },
    },
  },
  {
    id: "pod-b", name: "AI Pod B", letter: "B", x: 30, y: -310, w: 380, h: 214, managed: false,
    racks: [
      { id: "B02", name: "Rack B02", kind: "GPU", row: "row-b-n", x: 16, y: 34, w: 52, d: 44, h: 116, servers: [] },
      { id: "B03", name: "Rack B03", kind: "GPU", row: "row-b-n", x: 78, y: 34, w: 52, d: 44, h: 116, servers: [] },
      { id: "B04", name: "Rack B04", kind: "GPU", row: "row-b-s", x: 16, y: 128, w: 52, d: 44, h: 116, servers: [] },
      { id: "B05", name: "Rack B05", kind: "GPU", row: "row-b-s", x: 78, y: 128, w: 52, d: 44, h: 116, servers: [] },
    ],
    boxes: [
      { id: "shelf-b", x: 146, y: 132, w: 68, d: 36, h: 44 },
      { id: "cdu-b", x: 300, y: 86, w: 64, d: 34, h: 28 },
    ],
    fit: {
      aisles: [
        { id: "cold-b1", tone: "cold", label: "Cold aisle", x: 12, y: 6, w: 270, h: 22 },
        { id: "hot-b", tone: "hot", label: "Hot aisle", x: 12, y: 84, w: 260, h: 32 },
        { id: "cold-b2", tone: "cold", label: "Cold aisle", x: 12, y: 180, w: 270, h: 22 },
      ],
      rows: [
        { id: "row-b-n", name: "North row", y: 34, cold: "cold-b1", hot: "hot-b" },
        { id: "row-b-s", name: "South row", y: 128, cold: "cold-b2", hot: "hot-b" },
      ],
      containment: { id: "hac-b", x: 18, y: 86, w: 230, d: 28, h: 28 },
      busbar: { id: "bus-b", x: 16, y: 94, w: 240, d: 12, h: 8 },
    },
  },
  {
    id: "pod-c", name: "AI Pod C", letter: "C", x: -170, y: 10, w: 380, h: 214, managed: false,
    racks: [
      { id: "C05", name: "Rack C05", kind: "GPU", row: "row-c-n", x: 16, y: 34, w: 52, d: 44, h: 116, servers: [] },
      { id: "C06", name: "Rack C06", kind: "GPU", row: "row-c-n", x: 78, y: 34, w: 52, d: 44, h: 116, servers: [] },
      { id: "C07", name: "Rack C07", kind: "GPU", row: "row-c-s", x: 16, y: 128, w: 52, d: 44, h: 116, servers: [] },
      { id: "C08", name: "Rack C08", kind: "GPU", row: "row-c-s", x: 78, y: 128, w: 52, d: 44, h: 116, servers: [] },
    ],
    boxes: [
      { id: "shelf-c", x: 146, y: 132, w: 68, d: 36, h: 44 },
      { id: "cdu-c", x: 300, y: 86, w: 64, d: 34, h: 28 },
    ],
    fit: {
      aisles: [
        { id: "cold-c1", tone: "cold", label: "Cold aisle", x: 12, y: 6, w: 270, h: 22 },
        { id: "hot-c", tone: "hot", label: "Hot aisle", x: 12, y: 84, w: 260, h: 32 },
        { id: "cold-c2", tone: "cold", label: "Cold aisle", x: 12, y: 180, w: 270, h: 22 },
      ],
      rows: [
        { id: "row-c-n", name: "North row", y: 34, cold: "cold-c1", hot: "hot-c" },
        { id: "row-c-s", name: "South row", y: 128, cold: "cold-c2", hot: "hot-c" },
      ],
      containment: { id: "hac-c", x: 18, y: 86, w: 230, d: 28, h: 28 },
      busbar: { id: "bus-c", x: 16, y: 94, w: 240, d: 12, h: 8 },
    },
  },
];

export const YARD = [
  { id: "grid-1", name: "Utility grid", kind: "Grid", x: -530, y: -90, w: 110, d: 78, h: 64, power: 80, temp: 28, klass: "grid-yard" },
  { id: "xfmr-1", name: "MV transformer", kind: "Power module", x: -500, y: -20, w: 84, d: 58, h: 50, power: 62, temp: 40, klass: "xfmr-yard" },
  { id: "pwr-mod", name: "Power module", kind: "Power module", x: -490, y: 70, w: 112, d: 76, h: 60, power: 74, temp: 44, klass: "module-yard" },
  { id: "batt-1", name: "Battery skid", kind: "Power module", x: -360, y: 86, w: 96, d: 52, h: 42, power: 46, temp: 32, klass: "battery-yard" },
  { id: "heat-1", name: "Heat rejection", kind: "Heat rejection", x: 390, y: -120, w: 170, d: 72, h: 46, power: 68, temp: 38, klass: "cooler-yard" },
  { id: "heat-2", name: "Trim cooler", kind: "Heat rejection", x: 410, y: 10, w: 150, d: 60, h: 38, power: 42, temp: 33, klass: "cooler-yard" },
  { id: "hydro-1", name: "Hydro skid", kind: "Cooling", x: 400, y: 130, w: 140, d: 58, h: 36, power: 54, temp: 30, klass: "hydro-yard" },
  { id: "core-1", name: "OneCore", kind: "Core", x: -80, y: -188, w: 160, d: 72, h: 50, power: 36, temp: 28, klass: "core-block" },
];

export const SHELL = { x: -210, y: -48, w: 420, d: 230, h: 76 };

fillPod("pod-a", "A13", [62, 58, 71, 44, 66, 53]);

fillPod("pod-a", "A15", [48, 77, 55, 63, 41, 59]);

fillPod("pod-b", "B02", [88, 83, 61, 44, 71, 57]);

fillPod("pod-b", "B03", [49, 76, 66, 52, 91, 47]);

fillPod("pod-b", "B04", [54, 63, 47, 72, 58, 41]);

fillPod("pod-b", "B05", [67, 52, 74, 45, 60, 81]);

fillPod("pod-c", "C05", [73, 69, 55, 48, 80, 63]);

fillPod("pod-c", "C06", [42, 58, 64, 51, 46, 70]);

fillPod("pod-c", "C07", [59, 66, 43, 71, 54, 48]);

fillPod("pod-c", "C08", [77, 50, 62, 68, 45, 57]);

addInfra("cdu-a", "CDU A", "Cooling", "pod-a", 64, 33, 0.04);

addInfra("bus-a", "Bus bar A", "Busway", "pod-a", 58, 36, 0.03);

addInfra("hac-a", "Hot aisle containment A", "Containment", "pod-a", 40, 38, 0.02);

addInfra("cold-a1", "Cold aisle A", "Aisle", "pod-a", 22, 24, 0.01);

addInfra("hot-a", "Hot aisle A", "Aisle", "pod-a", 72, 48, 0.04);

addInfra("cold-a2", "Cold aisle A return", "Aisle", "pod-a", 26, 25, 0.01);

addInfra("cdu-b", "CDU B", "Cooling", "pod-b", 84, 41, 0.06);

addInfra("bus-b", "Bus bar B", "Busway", "pod-b", 61, 34, 0.03);

addInfra("hac-b", "Hot aisle containment B", "Containment", "pod-b", 48, 40, 0.03);

addInfra("cold-b1", "Cold aisle B", "Aisle", "pod-b", 24, 26, 0.01);

addInfra("hot-b", "Hot aisle B", "Aisle", "pod-b", 70, 46, 0.04);

addInfra("cold-b2", "Cold aisle B return", "Aisle", "pod-b", 28, 27, 0.01);

addInfra("shelf-b", "DC power shelf B", "Powershelf", "pod-b", 66, 42, 0.03);

addInfra("cdu-c", "CDU C", "Cooling", "pod-c", 54, 31, 0.02);

addInfra("bus-c", "Bus bar C", "Busway", "pod-c", 49, 32, 0.02);

addInfra("hac-c", "Hot aisle containment C", "Containment", "pod-c", 38, 36, 0.02);

addInfra("cold-c1", "Cold aisle C", "Aisle", "pod-c", 20, 24, 0.01);

addInfra("hot-c", "Hot aisle C", "Aisle", "pod-c", 64, 44, 0.03);

addInfra("cold-c2", "Cold aisle C return", "Aisle", "pod-c", 24, 25, 0.01);

addInfra("shelf-c", "DC power shelf C", "Powershelf", "pod-c", 58, 40, 0.02);

YARD.forEach((item) => addInfra(item.id, item.name, item.kind, "yard", item.power, item.temp, 0.02, true));

addInfra("pipe-sup", "Supply piping", "Pipe", "yard", 22, 18, 0.01, true);

addInfra("pipe-ret", "Return piping", "Pipe", "yard", 36, 34, 0.01, true);
