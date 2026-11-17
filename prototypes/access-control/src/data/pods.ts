import { deviceById } from "./devices";
import { simRandom } from "../state";
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
  const jitter = (simRandom() - 0.5) * 0.45;
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
  return "A14";
}

export const PLANT = {
  halls: 10,
  racksPerHall: 20,
  kwPerRack: 120,
  itMw: 100,
  hallItMw: 10,
  cduMw: 12,
  feeders: 2,
  feederMw: 150,
  coolers: 6,
  coolerMw: 20,
  coolMw: 120,
};

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

export const PODS = [];

export const YARD = [];

function gpuLoads(hall, rack, warm) {
  const base = warm ? 80 : 46;
  const span = warm ? 5 : 14;
  return [0, 1, 2, 3].map((i) => base + ((hall * 5 + rack * 3 + i * 7) % span));
}

export function seedHallTelemetry() {
  neighbors.length = 0;
  infra.length = 0;
  PODS.forEach((hall, hallIndex) => {
    hall.racks.forEach((rack, rackIndex) => {
      if (rack.id === "A14") return;
      const warm = rackIndex === 6;
      fillPod(hall.id, rack.id, gpuLoads(hallIndex, rackIndex, warm));
    });
    const key = hall.managed ? "a" : String(hallIndex + 1);
    addInfra("cdu-" + key, hall.name + " CDU · " + PLANT.cduMw + " MW", "Cooling", hall.id, 60, 34, 0.02);
    addInfra("shelf-" + key, hall.name + " DC shelf", "Powershelf", hall.id, 58, 40, 0.02);
    addInfra("bus-" + key, hall.name + " bus bar", "Busway", hall.id, 55, 36, 0.02);
    addInfra("hac-" + key, hall.name + " hot aisle", "Containment", hall.id, 42, 38, 0.01);
    addInfra("cold-" + key + "1", hall.name + " cold aisle", "Aisle", hall.id, 22, 24, 0.01);
    addInfra("hot-" + key, hall.name + " hot aisle", "Aisle", hall.id, 64, 46, 0.02);
    addInfra("cold-" + key + "2", hall.name + " cold aisle return", "Aisle", hall.id, 24, 25, 0.01);
    (hall.boxes || []).forEach((box) => {
      if (infra.some((item) => item.id === box.id)) return;
      addInfra(box.id, box.name || "Hall equipment", box.kind || "Cooling", hall.id, 34, 30, 0.01);
    });
  });
  YARD.forEach((item) => addInfra(item.id, item.name, item.kind, "yard", item.power, item.temp, 0.02, true));
  addInfra("pipe-sup", "Supply piping", "Pipe", "yard", 22, 18, 0.01, true);
  addInfra("pipe-ret", "Return piping", "Pipe", "yard", 36, 34, 0.01, true);
}
